import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  docTypeValues,
  visibilityValues,
  type WebhookEventType,
} from "@/db/schema";
import { describeModelAccess } from "@/lib/ai/model-access";
import { getAgentTelemetrySummary } from "@/lib/ai/telemetry";
import { auth, mcpResource } from "@/lib/auth";
import { listConnections } from "@/lib/connections";
import { getApprovalStatus } from "@/lib/document-share";
import {
  appendDeveloperWorkLedger,
  createDocument,
  deleteDocument,
  ensureDeveloperWorkLedger,
  getDocument,
  getProjectArchitecture,
  listDocuments,
  updateDocument,
} from "@/lib/documents";
import { DomainError, ValidationError } from "@/lib/errors";
import {
  pruneStaleWorktrees,
  runFleetHealthAudit,
} from "@/lib/fleet/maintenance";
import { listMarketplaceSkills } from "@/lib/marketplace";
import { testNotificationChannel } from "@/lib/notifications/bridge";
import {
  addProjectMember,
  createProject,
  listOrganizations,
  listProjectMembers,
  listProjects,
  removeProjectMember,
} from "@/lib/projects";
import { limitResponse } from "@/lib/rate-limit";
import { listRequirements } from "@/lib/requirements";
import { getEffectiveRoleRoutes } from "@/lib/role-routing";
import {
  distillLearningFromCritique,
  getSkill,
  listLearnedRules,
  listSkills,
  type Scope,
} from "@/lib/skills";
import { getProjectStatus } from "@/lib/status";
import {
  claimNextSpecialistTask,
  getSwarmPipeline,
  handoffTaskToSpecialist,
  listTaskHandoffs,
} from "@/lib/swarm";
import {
  assignTask,
  claimNextTask,
  claimTask,
  createTasks,
  deleteTask,
  getTask,
  getTaskExecutionBundle,
  listMembers,
  listTasks,
  releaseTask,
  retractSubmission,
  submitTask,
  updateTask,
} from "@/lib/tasks";
import { getProjectTelemetry } from "@/lib/telemetry";
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookDeliveries,
  listWebhookSubscriptions,
} from "@/lib/webhooks";
import {
  provisionTaskWorktree,
  pruneTaskWorktree,
  synthesizeTaskPullRequest,
  verifyTaskBranchState,
} from "@/lib/worktree";

const INSTRUCTIONS = `Project OS holds your organization's projects, documents (PRDs, ERD, LLD) and Skills: the company's own rules for how work is done (guide) and how it is reviewed (review). Institutional learnings and gotchas are continuously distilled from human critique to prevent repeating past mistakes.
When starting or resuming a project: call get_project_status first.
Before starting any work: call list_skills for the project (or org), then get_skill for every skill relevant to the task, and follow them. Project skills override org skills with the same name.
Working on tasks: claim with claim_next_task using a stable agent name (e.g. "dev-1"). Call get_task_execution_bundle (or get_task) to receive full context, matched skills, distilled gotchas, and git isolation instructions. Run tests and every relevant "review" skill, then submit_task with honest evidence. If get_task shows a review_note, the task was sent back: fix exactly that. Only a human can approve.`;

const text = (data: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
    },
  ],
});

/** Known domain errors become tool errors the agent can read; anything else is a real 500. */
const safe =
  <A>(fn: (args: A) => Promise<unknown>) =>
  async (args: A) => {
    try {
      return text(await fn(args));
    } catch (e) {
      if (e instanceof DomainError)
        return { ...text(e.message), isError: true };
      throw e;
    }
  };

const scopeInput = {
  org_id: z
    .string()
    .optional()
    .describe("Organization id (org-level skills only)"),
  project_id: z
    .string()
    .optional()
    .describe("Project id (effective skills: org + project overrides)"),
};
const toScope = ({
  org_id,
  project_id,
}: {
  org_id?: string;
  project_id?: string;
}): Scope => {
  if (project_id) return { projectId: project_id };
  if (org_id) return { orgId: org_id };
  throw new ValidationError("Pass project_id or org_id");
};

// Stateless: a fresh server per request, bound to the verified caller.
const handlerFor = (userId: string) =>
  createMcpHandler(() => {
    const server = new McpServer(
      { name: "project-os", version: "0.5.0" },
      { instructions: INSTRUCTIONS },
    );

    server.registerTool(
      "list_organizations",
      { description: "List organizations you belong to, with your role." },
      safe(() => listOrganizations(userId)),
    );
    server.registerTool(
      "list_projects",
      { description: "List projects in every organization you belong to." },
      safe(() => listProjects(userId)),
    );
    server.registerTool(
      "list_skills",
      {
        description:
          "List the Skills that apply to a project (org skills overlaid by project skills) or to an organization. Returns name, description, kind (guide = how to do work, review = how to evaluate it) and scope. Call before starting work.",
        inputSchema: z.object({
          ...scopeInput,
          kind: z.enum(["guide", "review"]).optional(),
        }),
      },
      safe((a) => listSkills(userId, toScope(a), a.kind)),
    );
    server.registerTool(
      "get_skill",
      {
        description:
          "Get the full SKILL.md instructions for one skill by name. Follow them for the current task.",
        inputSchema: z.object({ ...scopeInput, name: z.string() }),
      },
      safe(async (a) => (await getSkill(userId, toScope(a), a.name)).source),
    );
    server.registerTool(
      "list_learned_rules",
      {
        description:
          "List continuous learning rules and project gotchas distilled from human critiques and reviews.",
        inputSchema: z.object({
          project_id: z.string().describe("Project UUID or name"),
          skill_name: z
            .string()
            .optional()
            .describe("Filter by skill name (e.g. 'code-review')"),
        }),
      },
      safe((a) => listLearnedRules(userId, a.project_id, a.skill_name)),
    );
    server.registerTool(
      "learn_from_feedback",
      {
        description:
          "Distill a learning, gotcha, or review finding into a project's institutional memory. Automatically enriches project skills and warns future agents against repeating this mistake.",
        inputSchema: z.object({
          project_id: z.string().describe("Project UUID or name"),
          rule: z.string().describe("Actionable rule or gotcha to remember"),
          skill_name: z
            .string()
            .optional()
            .describe("Target skill e.g. 'code-review'"),
          task_id: z
            .string()
            .optional()
            .describe("Source task UUID or key if applicable"),
        }),
      },
      safe((a) =>
        distillLearningFromCritique(userId, {
          projectId: a.project_id,
          rule: a.rule,
          skillName: a.skill_name,
          sourceTaskId: a.task_id,
          source: "manual",
        }),
      ),
    );

    server.registerTool(
      "create_project",
      {
        description:
          "Create a new project in an organization (get org_id from list_organizations). Returns the project with its id.",
        inputSchema: z.object({
          org_id: z.string(),
          name: z.string().min(1).max(120),
          description: z.string().max(2000).optional(),
        }),
      },
      safe((a) =>
        createProject(userId, a.org_id, {
          name: a.name,
          description: a.description,
        }),
      ),
    );

    server.registerTool(
      "add_project_member",
      {
        description:
          "Assign a developer, tester, devops engineer, or specialized agent to a project. Automatically provisions their daily work & KT ledger (developer/{name}/work).",
        inputSchema: z.object({
          project_id: z.string(),
          user_id: z.string(),
          role: z
            .string()
            .optional()
            .describe("A role slug from the org's roles (default: developer)"),
        }),
      },
      safe((a) =>
        addProjectMember(
          userId,
          a.project_id,
          a.user_id,
          a.role ?? "developer",
        ),
      ),
    );

    server.registerTool(
      "list_project_members",
      {
        description:
          "List all developers, testers, and agents assigned to a specific project with their roles and assignment timestamps.",
        inputSchema: z.object({
          project_id: z.string(),
        }),
      },
      safe((a) => listProjectMembers(userId, a.project_id)),
    );
    server.registerTool(
      "remove_project_member",
      {
        description: "Remove a developer, tester, or agent from a project.",
        inputSchema: z.object({
          project_id: z.string(),
          user_id: z.string(),
        }),
      },
      safe((a) => removeProjectMember(userId, a.project_id, a.user_id)),
    );

    server.registerTool(
      "get_my_work_ledger",
      {
        description:
          "Fetch your auto-provisioned developer work & knowledge transfer (KT) ledger for this project (developer/{name}/work). Includes daily startup checklist and KT notes.",
        inputSchema: z.object({
          project_id: z.string(),
        }),
      },
      safe(async (a) => {
        const ledger = await ensureDeveloperWorkLedger(a.project_id, userId);
        if (!ledger)
          throw new DomainError("Could not resolve developer work ledger");
        return getDocument(userId, ledger.id);
      }),
    );

    server.registerTool(
      "append_my_work_ledger",
      {
        description:
          "Append a daily startup briefing, ticket progress update, or KT handoff notes to your developer work ledger.",
        inputSchema: z.object({
          project_id: z.string(),
          status: z.string().optional(),
          focus_area: z.string().optional(),
          architectural_notes: z.string().optional(),
          kt_handoff: z.string().optional(),
          raw_text: z.string().optional(),
        }),
      },
      safe((a) =>
        appendDeveloperWorkLedger(userId, a.project_id, {
          status: a.status,
          focusArea: a.focus_area,
          architecturalNotes: a.architectural_notes,
          ktHandoff: a.kt_handoff,
          rawText: a.raw_text,
        }),
      ),
    );

    server.registerTool(
      "get_project_status",
      {
        description:
          "Where the project stands right now: progress, tasks waiting for human review, blocked tasks, stale claims, sent-back tasks, next claimable tasks, recent document changes and decisions. Call this FIRST when starting or resuming work on a project.",
        inputSchema: z.object({
          project_id: z
            .string()
            .describe("Project UUID or project name (e.g. 'foodthatyoueat')"),
        }),
      },
      safe((a) => getProjectStatus(userId, a.project_id)),
    );
    server.registerTool(
      "get_project_telemetry",
      {
        description:
          "Executive health matrix & telemetry: Architecture Readiness Score (0-100% across PRD, HLD, LLD, ERD, Brief), Agent Autonomy Index (% first-pass approvals vs rework), Dependency Bottlenecks heatmap, and Architectural Drift alerts.",
        inputSchema: z.object({
          project_id: z
            .string()
            .describe("Project UUID or project name (e.g. 'foodthatyoueat')"),
        }),
      },
      safe((a) => getProjectTelemetry(userId, a.project_id)),
    );
    server.registerTool(
      "get_project_health_matrix",
      {
        description:
          "Executive health matrix & telemetry: Architecture Readiness Score (0-100%), Agent Autonomy Index (% first-pass approvals), Dependency Bottlenecks heatmap, and Architectural Drift alerts.",
        inputSchema: z.object({
          project_id: z
            .string()
            .describe("Project UUID or project name (e.g. 'foodthatyoueat')"),
        }),
      },
      safe((a) => getProjectTelemetry(userId, a.project_id)),
    );
    server.registerTool(
      "get_project_architecture",
      {
        description:
          "Get the project's complete architectural deck (Client Brief, PRD, HLD, LLD, Database ERD) in one shot. Call this before implementing features to ensure code aligns with system design, contracts, and schema.",
        inputSchema: z.object({
          project_id: z
            .string()
            .describe("Project UUID or project name (e.g. 'foodthatyoueat')"),
        }),
      },
      safe((a) => getProjectArchitecture(userId, a.project_id)),
    );
    server.registerTool(
      "list_documents",
      {
        description:
          "List a project's documents (PRDs and Architecture docs first) with their current version, docType, and visibility.",
        inputSchema: z.object({
          project_id: z
            .string()
            .describe("Project UUID or project name (e.g. 'foodthatyoueat')"),
          doc_type: z
            .enum(docTypeValues)
            .optional()
            .describe(
              "Filter by architecture type: 'brief' | 'prd' | 'hld' | 'lld' | 'erd' | 'work_ledger' | 'general'",
            ),
        }),
      },
      safe((a) =>
        listDocuments(
          userId,
          a.project_id,
          a.doc_type ? { docType: a.doc_type } : undefined,
        ),
      ),
    );
    server.registerTool(
      "get_document",
      {
        description:
          "Read a document's markdown content. Latest version by default; pass version to read history. Note the returned version: you need it as base_version to update.",
        inputSchema: z.object({
          document_id: z.string(),
          version: z.number().int().positive().optional(),
        }),
      },
      safe((a) => getDocument(userId, a.document_id, a.version)),
    );
    server.registerTool(
      "create_document",
      {
        description:
          "Create a project document or daily work ledger. For kind 'prd', format the PRD exactly as specified; for 'erd', supply Mermaid ERD syntax; for 'work_ledger', record daily ticket KT and file changes.",
        inputSchema: z.object({
          project_id: z.string(),
          title: z.string(),
          kind: z.enum(["prd", "doc"]).optional(),
          doc_type: z
            .enum(docTypeValues)
            .optional()
            .describe(
              "Type: 'brief' | 'prd' | 'hld' | 'lld' | 'erd' | 'work_ledger' | 'general'",
            ),
          visibility: z
            .enum(visibilityValues)
            .optional()
            .describe("'draft' (author only) or 'published' (project team)"),
          content: z.string().describe("Markdown or Mermaid syntax"),
          note: z
            .string()
            .optional()
            .describe("Why / source, e.g. 'from client call 12 Sep'"),
        }),
      },
      safe((a) =>
        createDocument(userId, a.project_id, {
          title: a.title,
          kind: a.kind,
          docType: a.doc_type,
          visibility: a.visibility,
          content: a.content,
          note: a.note,
        }),
      ),
    );
    server.registerTool(
      "update_document",
      {
        description:
          "Save a new version of a document (full markdown content, not a diff). base_version must be the version you last read; if it changed meanwhile you get a conflict: re-read, merge, retry.",
        inputSchema: z.object({
          document_id: z.string(),
          content: z.string().describe("Full markdown"),
          base_version: z.number().int().positive(),
          note: z.string().optional().describe("What changed and why"),
          title: z.string().optional(),
        }),
      },
      safe((a) =>
        updateDocument(userId, a.document_id, {
          content: a.content,
          baseVersion: a.base_version,
          note: a.note,
          title: a.title,
        }),
      ),
    );
    server.registerTool(
      "delete_document",
      {
        description:
          "Permanently delete a document and all its versions, share links, and recorded client decisions. Cannot be undone.",
        inputSchema: z.object({ document_id: z.string() }),
      },
      safe((a) => deleteDocument(userId, a.document_id)),
    );
    server.registerTool(
      "get_approval_status",
      {
        description:
          "Check whether a client has approved this document, and at what version. Use this before relying on a PRD as 'approved' — stale means the document changed since the client's latest decision.",
        inputSchema: z.object({ document_id: z.string() }),
      },
      safe((a) => getApprovalStatus(userId, a.document_id)),
    );

    // ---- tasks (approve/reject deliberately absent: only humans, in the web app) ----
    const agent = z
      .string()
      .describe(
        'Stable name for THIS agent session, e.g. "dev-1". Use the same name to claim, submit and release.',
      );
    server.registerTool(
      "list_members",
      {
        description:
          "List organization members (id, name, email, role) for assigning tasks.",
        inputSchema: z.object({ org_id: z.string() }),
      },
      safe((a) => listMembers(userId, a.org_id)),
    );
    server.registerTool(
      "list_requirements",
      {
        description:
          "List a PRD's requirements (R-1, R-2…, one per Acceptance Criteria bullet) with the tasks that deliver each and its derived state (no_task, not_started, in_progress, in_review, done). Use it to find requirements that still have no work.",
        inputSchema: z.object({ prd_document_id: z.string() }),
      },
      safe((a) => listRequirements(userId, a.prd_document_id)),
    );
    server.registerTool(
      "list_connections",
      {
        description:
          "List the org's connected external tools (Slack, GitHub, custom MCP servers) — e.g. to check whether Slack notifications are configured. Never returns secret values, only a 4-character hint.",
        inputSchema: z.object({ org_id: z.string() }),
      },
      safe((a) => listConnections(userId, a.org_id)),
    );
    server.registerTool(
      "get_role_routes",
      {
        description:
          "Which skill handles each task role (product, developer, qa, devops) — exactly the routing the server applies when it attaches an agent to a task. Returns { configured, routes: [{ role, skillName }] }: configured=true means the org set this up on its Org Flow canvas; false means the org hasn't, and these are the built-in defaults currently in effect.",
        inputSchema: z.object({ org_id: z.string() }),
      },
      safe((a) => getEffectiveRoleRoutes(userId, a.org_id)),
    );
    server.registerTool(
      "list_marketplace_skills",
      {
        description:
          "Browse skills published by other orgs to the marketplace, searchable by name/kind/pitch. Read-only — adopting one into your own org is a human action in the web app.",
        inputSchema: z.object({
          query: z
            .string()
            .optional()
            .describe("Search by name, kind, or pitch"),
        }),
      },
      safe((a) => listMarketplaceSkills(a.query)),
    );

    server.registerTool(
      "create_tasks",
      {
        description:
          'Create tasks in a project in one batch. Each task can be tied to a PRD document and the requirement keys it delivers (e.g. prd_document_id + ["R-1","R-3"] from list_requirements) and can enforce an output_contract for specialist agents.',
        inputSchema: z.object({
          project_id: z.string(),
          tasks: z.array(
            z.object({
              ref: z
                .string()
                .optional()
                .describe("Local name other items can depend on"),
              title: z.string(),
              description: z
                .string()
                .optional()
                .describe(
                  "Markdown: requirement, context, acceptance criteria, evidence, out of scope",
                ),
              role: z.enum(["developer", "devops", "qa", "product"]),
              assignee_id: z.string().optional(),
              prd_document_id: z
                .string()
                .optional()
                .describe("The PRD document this task is built under"),
              requirement_keys: z
                .array(z.string())
                .optional()
                .describe(
                  "Requirement keys of that PRD this task delivers, e.g. ['R-1']",
                ),
              output_contract: z
                .record(z.string(), z.unknown())
                .optional()
                .describe(
                  "Typed contract of required files, coverage, test report",
                ),
              depends_on: z.array(z.string()).optional(),
            }),
          ),
        }),
      },
      safe((a) =>
        createTasks(
          userId,
          a.project_id,
          a.tasks.map((t) => ({
            ...t,
            assigneeId: t.assignee_id,
            prdDocumentId: t.prd_document_id,
            requirementKeys: t.requirement_keys,
            outputContract: t.output_contract,
            dependsOn: t.depends_on,
          })),
        ),
      ),
    );
    server.registerTool(
      "assign_task",
      {
        description:
          "Assign, reassign or unassign a task. Pass assignee_id from list_members, or null to unassign (allowing any team member to claim it). Admin only.",
        inputSchema: z.object({
          task_id: z.string(),
          assignee_id: z
            .string()
            .nullable()
            .describe("User ID to assign to, or null to unassign"),
        }),
      },
      safe((a) => assignTask(userId, a.task_id, a.assignee_id)),
    );
    server.registerTool(
      "update_task",
      {
        description:
          "Update an existing task's title, description, role, assignee, PRD or requirement links. Admin only.",
        inputSchema: z.object({
          task_id: z.string(),
          title: z.string().min(1).max(200).optional(),
          description: z.string().max(50_000).optional(),
          role: z.enum(["developer", "devops", "qa", "product"]).optional(),
          assignee_id: z
            .string()
            .nullable()
            .optional()
            .describe("User ID or null to unassign"),
          prd_document_id: z
            .string()
            .nullable()
            .optional()
            .describe(
              "PRD to build under, or null to detach (clears requirement links)",
            ),
          requirement_keys: z
            .array(z.string())
            .optional()
            .describe(
              "Replace the task's requirement links with these keys of its PRD",
            ),
        }),
      },
      safe((a) =>
        updateTask(userId, a.task_id, {
          prdDocumentId: a.prd_document_id,
          requirementKeys: a.requirement_keys,
          title: a.title,
          description: a.description,
          role: a.role,
          assigneeId: a.assignee_id,
        }),
      ),
    );
    server.registerTool(
      "delete_task",
      {
        description: "Delete a task from a project. Admin only.",
        inputSchema: z.object({ task_id: z.string() }),
      },
      safe((a) => deleteTask(userId, a.task_id)),
    );
    server.registerTool(
      "list_tasks",
      {
        description:
          "List a project's tasks with status, role, assignee, claiming agent and blocked_by keys.",
        inputSchema: z.object({
          project_id: z
            .string()
            .describe("Project UUID or project name (e.g. 'foodthatyoueat')"),
          status: z
            .enum(["todo", "in_progress", "in_review", "done"])
            .optional(),
          mine: z
            .boolean()
            .optional()
            .describe("Only tasks assigned to or claimed by you"),
        }),
      },
      safe((a) =>
        listTasks(userId, a.project_id, { status: a.status, mine: a.mine }),
      ),
    );
    server.registerTool(
      "get_task",
      {
        description:
          "Full task context: description, dependencies, previous submissions, review notes, project documents, gitIsolation metadata, matchedSkills, and learnedRules.",
        inputSchema: z.object({
          task_id: z
            .string()
            .describe("Task UUID or display key like 'T-1' or 'T1'"),
        }),
      },
      safe((a) => getTask(userId, a.task_id)),
    );
    server.registerTool(
      "get_task_execution_bundle",
      {
        description:
          "Complete execution bundle for specialist agents: task specification, output contract, git isolation instructions, matched role and domain skills with markdown guidelines, distilled project gotchas, and relevant architecture documents (ERD, LLD, PRD).",
        inputSchema: z.object({
          task_id: z
            .string()
            .describe("Task UUID or display key like 'T-1' or 'T1'"),
        }),
      },
      safe((a) => getTaskExecutionBundle(userId, a.task_id)),
    );
    server.registerTool(
      "claim_next_task",
      {
        description:
          "Atomically claim your next available task (todo, not blocked, unassigned or assigned to you). Parallel agents never get the same task. Returns task with gitIsolation metadata. CRITICAL: Create and work inside the suggested branch or worktree to prevent colliding with parallel agents on the same repo.",
        inputSchema: z.object({
          project_id: z
            .string()
            .describe("Project UUID or project name (e.g. 'foodthatyoueat')"),
          agent,
          role: z.enum(["developer", "devops", "qa", "product"]).optional(),
        }),
      },
      safe(
        async (a) =>
          (await claimNextTask(userId, a.project_id, a.agent, a.role)) ??
          "No task available right now.",
      ),
    );
    server.registerTool(
      "claim_task",
      {
        description:
          "Claim a specific task by id. Fails with the reason if it's taken, blocked or assigned to someone else. Returns task with gitIsolation commands for parallel agent safety.",
        inputSchema: z.object({ task_id: z.string(), agent }),
      },
      safe((a) => claimTask(userId, a.task_id, a.agent)),
    );
    server.registerTool(
      "submit_task",
      {
        description:
          'Submit finished work for human review with evidence. Run the tests and every relevant "review" skill first. Report results honestly: failed tests or reviews must be reported as they are. The task moves to in_review; you cannot mark it done yourself.',
        inputSchema: z.object({
          task_id: z.string(),
          agent,
          summary: z.string(),
          files_changed: z.array(z.string()),
          tests: z.array(
            z.object({
              command: z.string(),
              exit_code: z.number().int(),
              summary: z.string(),
            }),
          ),
          reviews: z
            .array(
              z.object({
                skill: z.string(),
                status: z.enum(["PASS", "NEEDS_WORK", "FAIL"]),
                summary: z.string(),
              }),
            )
            .optional(),
          branch: z.string().optional(),
          commit_sha: z.string().optional(),
        }),
      },
      safe((a) =>
        submitTask(userId, a.task_id, a.agent, {
          summary: a.summary,
          filesChanged: a.files_changed,
          tests: a.tests.map((t) => ({
            command: t.command,
            exitCode: t.exit_code,
            summary: t.summary,
          })),
          reviews: a.reviews,
          branch: a.branch,
          commitSha: a.commit_sha,
        }),
      ),
    );
    server.registerTool(
      "release_task",
      {
        description:
          "Give up a task you claimed (back to todo) when you're stuck or it's out of your scope.",
        inputSchema: z.object({ task_id: z.string(), agent }),
      },
      safe((a) => releaseTask(userId, a.task_id, a.agent)),
    );
    server.registerTool(
      "retract_submission",
      {
        description:
          "Take back work you submitted for review, before a human has decided it (wrong commit, missing file). The task returns to in_progress under you; resubmit when ready. Not possible once a human has approved or sent it back.",
        inputSchema: z.object({ task_id: z.string(), agent }),
      },
      safe((a) => retractSubmission(userId, a.task_id, a.agent)),
    );
    server.registerTool(
      "claim_next_specialist_task",
      {
        description:
          "Atomically claim the next unblocked task for your specialist role (developer, qa, devops, product) in the swarm pipeline. Returns null if all eligible tasks are claimed or blocked.",
        inputSchema: z.object({
          project_id: z.string().describe("Project UUID or project name"),
          agent,
          role: z
            .enum(["developer", "qa", "devops", "product"])
            .optional()
            .describe(
              "Filter by specialist role. If omitted, claims any unblocked task.",
            ),
        }),
      },
      safe((a) =>
        claimNextSpecialistTask(userId, a.project_id, a.agent, a.role),
      ),
    );
    server.registerTool(
      "handoff_task_to_specialist",
      {
        description:
          "Handoff task to the next specialist in the swarm pipeline (e.g. Builder -> QA -> DevOps Reviewer -> Human Approval) with execution artifacts and verification evidence.",
        inputSchema: z.object({
          task_id: z.string().describe("The task UUID"),
          agent,
          to_role: z
            .enum(["developer", "qa", "devops", "product"])
            .describe("Target specialist role"),
          stage: z
            .enum(["build", "test", "review", "approval"])
            .describe("Swarm pipeline stage"),
          note: z
            .string()
            .optional()
            .default("")
            .describe("Handoff brief or review notes for the recipient"),
          to_agent: z
            .string()
            .optional()
            .describe(
              "Specific agent name if known, or leave empty for role auto-claim",
            ),
          artifacts: z
            .object({
              commit_sha: z.string().optional(),
              branch: z.string().optional(),
              worktree: z.string().optional(),
              test_results: z
                .array(
                  z.object({
                    command: z.string(),
                    exit_code: z.number().int(),
                    summary: z.string(),
                  }),
                )
                .optional(),
              review_findings: z
                .array(
                  z.object({
                    severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
                    file_line: z.string().optional(),
                    problem: z.string(),
                    impact: z.string().optional(),
                    fix: z.string().optional(),
                  }),
                )
                .optional(),
              files_changed: z.array(z.string()).optional(),
              notes: z.string().optional(),
            })
            .optional(),
        }),
      },
      safe((a) =>
        handoffTaskToSpecialist(userId, a.task_id, {
          fromAgent: a.agent,
          toRole: a.to_role,
          toAgent: a.to_agent,
          stage: a.stage,
          note: a.note,
          artifacts: a.artifacts
            ? {
                commitSha: a.artifacts.commit_sha,
                branch: a.artifacts.branch,
                worktree: a.artifacts.worktree,
                testResults: a.artifacts.test_results?.map((t) => ({
                  command: t.command,
                  exitCode: t.exit_code,
                  summary: t.summary,
                })),
                reviewFindings: a.artifacts.review_findings?.map((f) => ({
                  severity: f.severity,
                  fileLine: f.file_line,
                  problem: f.problem,
                  impact: f.impact,
                  fix: f.fix,
                })),
                filesChanged: a.artifacts.files_changed,
                notes: a.artifacts.notes,
              }
            : undefined,
        }),
      ),
    );
    server.registerTool(
      "get_swarm_pipeline_status",
      {
        description:
          "Inspect the multi-agent swarm pipeline status for a project: stage distributions (build, test, review, approval), active specialist agents, and recent handoffs.",
        inputSchema: z.object({
          project_id: z.string().describe("Project UUID or project name"),
        }),
      },
      safe((a) => getSwarmPipeline(userId, a.project_id)),
    );
    server.registerTool(
      "list_task_handoffs",
      {
        description:
          "List the complete chronological chain of specialist handoffs, audit notes, and verification artifacts for a task.",
        inputSchema: z.object({
          task_id: z.string().describe("The task UUID"),
        }),
      },
      safe((a) => listTaskHandoffs(userId, a.task_id)),
    );
    server.registerTool(
      "provision_task_worktree",
      {
        description:
          "Provision an isolated git worktree and branch for task execution. Returns shell commands and instructions to prevent file collisions with parallel agents.",
        inputSchema: z.object({
          task_id: z.string().describe("The task UUID"),
          base_ref: z
            .string()
            .optional()
            .default("main")
            .describe("Base git branch (defaults to 'main')"),
        }),
      },
      safe((a) =>
        provisionTaskWorktree(userId, a.task_id, {
          baseRef: a.base_ref,
        }),
      ),
    );
    server.registerTool(
      "verify_task_branch_state",
      {
        description:
          "Verify the working copy and commit readiness of a task branch or worktree before submission.",
        inputSchema: z.object({
          task_id: z.string().describe("The task UUID"),
        }),
      },
      safe((a) => verifyTaskBranchState(userId, a.task_id)),
    );
    server.registerTool(
      "prune_task_worktree",
      {
        description:
          "Safely prune a task worktree sandbox from the Project OS registry after completion or cleanup.",
        inputSchema: z.object({
          task_id: z.string().describe("The task UUID"),
          force: z.boolean().optional().describe("Force cleanup if unmerged"),
        }),
      },
      safe((a) => pruneTaskWorktree(userId, a.task_id, { force: a.force })),
    );
    server.registerTool(
      "synthesize_task_pull_request",
      {
        description:
          "Synthesize a rich Pull Request bundle with architecture compliance, automated test evidence, persona review sign-offs, and KT handoff summary. Opens PR on GitHub if repository and GITHUB_TOKEN are configured.",
        inputSchema: z.object({
          task_id: z.string().describe("The task UUID"),
          base_ref: z
            .string()
            .optional()
            .describe("Target base branch for PR (e.g. 'main')"),
          draft: z
            .boolean()
            .optional()
            .default(false)
            .describe("Whether to create as draft PR"),
        }),
      },
      safe((a) =>
        synthesizeTaskPullRequest(userId, a.task_id, {
          baseRef: a.base_ref,
          draft: a.draft,
        }),
      ),
    );
    server.registerTool(
      "register_webhook",
      {
        description:
          "Register an outgoing webhook endpoint for real-time CI/CD event notifications with HMAC-SHA256 signature.",
        inputSchema: z.object({
          project_id: z.string().describe("The project UUID"),
          name: z.string().describe("Descriptive name of the webhook endpoint"),
          url: z.string().url().describe("Target HTTP(S) callback URL"),
          events: z
            .array(z.string())
            .describe(
              "Event types to subscribe to (e.g. ['task.created', 'task.approved', 'pr.synthesized'])",
            ),
          secret: z
            .string()
            .optional()
            .describe(
              "HMAC-SHA256 signing secret (generated automatically if omitted)",
            ),
        }),
      },
      safe((a) =>
        createWebhookSubscription(userId, {
          projectId: a.project_id,
          name: a.name,
          url: a.url,
          events: a.events as WebhookEventType[],
          secret: a.secret,
        }),
      ),
    );
    server.registerTool(
      "list_webhooks",
      {
        description:
          "List all active webhook subscriptions registered for a project.",
        inputSchema: z.object({
          project_id: z.string().describe("The project UUID"),
        }),
      },
      safe((a) =>
        listWebhookSubscriptions(userId, {
          projectId: a.project_id,
        }),
      ),
    );
    server.registerTool(
      "delete_webhook",
      {
        description: "Delete an existing webhook subscription by ID.",
        inputSchema: z.object({
          subscription_id: z.string().describe("The webhook subscription UUID"),
        }),
      },
      safe((a) => deleteWebhookSubscription(userId, a.subscription_id)),
    );
    server.registerTool(
      "list_webhook_deliveries",
      {
        description:
          "List recent webhook delivery attempts and audit logs for a subscription.",
        inputSchema: z.object({
          subscription_id: z.string().describe("The webhook subscription UUID"),
          limit: z
            .number()
            .optional()
            .describe("Max deliveries to return (default 20)"),
        }),
      },
      safe((a) => listWebhookDeliveries(userId, a.subscription_id, a.limit)),
    );
    server.registerTool(
      "get_agent_token_telemetry",
      {
        description:
          "Retrieve project-level AI token consumption metrics, spend calculations, model breakdown, and recent agent execution timeline.",
        inputSchema: z.object({
          project_id: z.string().describe("The project UUID"),
        }),
      },
      safe((a) => getAgentTelemetrySummary(userId, a.project_id)),
    );
    server.registerTool(
      "list_models",
      {
        description:
          "The models a workspace can actually use right now: which providers are connected (its own key or Captap's), the platform models with prices and whether the plan includes them, the default model, and this month's platform spend against the allowance.",
        inputSchema: z.object({ org_id: z.string() }),
      },
      safe((a) => describeModelAccess(userId, a.org_id)),
    );
    server.registerTool(
      "test_notification_channel",
      {
        description:
          "Send a diagnostic connectivity test alert to a Slack or Discord webhook endpoint.",
        inputSchema: z.object({
          channel_type: z
            .enum(["slack", "discord"])
            .describe("Target webhook channel type"),
          webhook_url: z.string().url().describe("The incoming webhook URL"),
        }),
      },
      safe((a) => testNotificationChannel(a.channel_type, a.webhook_url)),
    );
    server.registerTool(
      "run_fleet_health_audit",
      {
        description:
          "Perform a comprehensive fleet health audit across worktrees, agent spend burn rates, dependency bottlenecks, and architecture readiness.",
        inputSchema: z.object({
          project_id: z.string().describe("The project UUID"),
        }),
      },
      safe((a) => runFleetHealthAudit(userId, a.project_id)),
    );
    server.registerTool(
      "prune_stale_worktrees",
      {
        description:
          "Prune abandoned and completed task git worktree sandboxes to reclaim developer workstation disk space.",
        inputSchema: z.object({
          project_id: z.string().describe("The project UUID"),
          dry_run: z
            .boolean()
            .optional()
            .describe("Preview what would be pruned without deleting files"),
        }),
      },
      safe((a) =>
        pruneStaleWorktrees(userId, a.project_id, { dryRun: a.dry_run }),
      ),
    );
    return server;
  });

const handle = requireMcpAuth(
  auth,
  async (req, claims) => {
    if (!claims.sub)
      return new Response("Token has no subject", { status: 401 });
    const limited = await limitResponse("mcp", claims.sub);
    if (limited) return limited;
    return handlerFor(claims.sub).fetch(req);
  },
  { resource: mcpResource },
);

export { handle as GET, handle as POST, handle as DELETE };
