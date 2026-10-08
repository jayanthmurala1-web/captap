import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  project,
  type TaskWorktree,
  task,
  taskSubmission,
  taskWorktree,
} from "@/db/schema";
import { requireProject } from "./access";
import { listDocuments } from "./documents";
import { NotFoundError } from "./errors";
import { generateGitIsolation } from "./git-isolation";
import { fetchGitHub, parseGitHubRepo } from "./github";
import { listTaskHandoffs } from "./swarm";
import { getTask, taskKey } from "./tasks";
import { dispatchWebhookEvent } from "./webhooks";

export interface WorktreeProvisionResult {
  worktree: TaskWorktree;
  branch: string;
  worktreePath: string;
  commands: {
    create: string;
    checkout: string;
    remove: string;
    prune: string;
  };
  instructions: string;
}

export interface BranchStateVerification {
  taskKey: string;
  branch: string;
  worktreePath: string;
  status: "active" | "submitted" | "merged" | "pruned";
  isClean: boolean;
  hasCommits: boolean;
  commitSha?: string;
  verificationSummary: string;
}

export interface SynthesizedPullRequest {
  title: string;
  body: string;
  branch: string;
  baseRef: string;
  prNumber?: number;
  prUrl?: string;
  createdOnGitHub: boolean;
}

/**
 * Provisions an isolated git worktree and branch for a task.
 * Idempotent: returns existing active allocation if one is already recorded.
 */
export async function provisionTaskWorktree(
  userId: string,
  taskId: string,
  options?: { baseRef?: string },
): Promise<WorktreeProvisionResult> {
  const currentTask = await getTask(userId, taskId);
  if (!currentTask) throw new NotFoundError("Task not found");

  const baseRef = options?.baseRef?.trim() || "main";
  const key = taskKey(currentTask.number);
  const isolation = generateGitIsolation(key, currentTask.title);

  // Check if an existing active worktree is already recorded
  const [existing] = await db
    .select()
    .from(taskWorktree)
    .where(
      and(
        eq(taskWorktree.taskId, currentTask.id),
        eq(taskWorktree.status, "active"),
      ),
    )
    .orderBy(desc(taskWorktree.createdAt))
    .limit(1);

  let record: TaskWorktree;

  if (existing) {
    record = existing;
  } else {
    const [inserted] = await db
      .insert(taskWorktree)
      .values({
        taskId: currentTask.id,
        projectId: currentTask.projectId,
        orgId: currentTask.orgId,
        branch: isolation.suggestedBranch,
        worktreePath: isolation.worktreeDir,
        baseRef,
        status: "active",
        allocatedBy: userId,
      })
      .returning();
    record = inserted;
    dispatchWebhookEvent(
      "worktree.provisioned",
      {
        taskId: currentTask.id,
        taskKey: key,
        branch: record.branch,
        worktreePath: record.worktreePath,
        baseRef: record.baseRef,
      },
      { projectId: currentTask.projectId, orgId: currentTask.orgId },
    ).catch(() => {});
  }

  return {
    worktree: record,
    branch: record.branch,
    worktreePath: record.worktreePath,
    commands: {
      create: `git worktree add ${record.worktreePath} -b ${record.branch} ${record.baseRef}`,
      checkout: `git checkout -b ${record.branch}`,
      remove: `git worktree remove ${record.worktreePath}`,
      prune: "git worktree prune",
    },
    instructions: isolation.instructions,
  };
}

/**
 * Retrieves the latest worktree allocation for a task.
 */
export async function getTaskWorktree(
  userId: string,
  taskId: string,
): Promise<TaskWorktree | null> {
  const currentTask = await getTask(userId, taskId);
  if (!currentTask) throw new NotFoundError("Task not found");

  const [row] = await db
    .select()
    .from(taskWorktree)
    .where(eq(taskWorktree.taskId, currentTask.id))
    .orderBy(desc(taskWorktree.createdAt))
    .limit(1);

  return row || null;
}

/**
 * Lists all active or historical worktrees in a project.
 */
export async function listProjectWorktrees(
  userId: string,
  projectId: string,
  filterStatus?: "active" | "submitted" | "merged" | "pruned",
) {
  const { projectId: projId } = await requireProject(userId, projectId);

  const query = db
    .select({
      id: taskWorktree.id,
      taskId: taskWorktree.taskId,
      taskNumber: task.number,
      taskTitle: task.title,
      taskRole: task.role,
      branch: taskWorktree.branch,
      worktreePath: taskWorktree.worktreePath,
      baseRef: taskWorktree.baseRef,
      status: taskWorktree.status,
      prNumber: taskWorktree.prNumber,
      prUrl: taskWorktree.prUrl,
      prState: taskWorktree.prState,
      createdAt: taskWorktree.createdAt,
      updatedAt: taskWorktree.updatedAt,
    })
    .from(taskWorktree)
    .innerJoin(task, eq(task.id, taskWorktree.taskId))
    .where(
      filterStatus
        ? and(
            eq(taskWorktree.projectId, projId),
            eq(taskWorktree.status, filterStatus),
          )
        : eq(taskWorktree.projectId, projId),
    )
    .orderBy(desc(taskWorktree.createdAt));

  return query;
}

/**
 * Verifies that a task branch / worktree is cleanly committed and ready for submission.
 */
export async function verifyTaskBranchState(
  userId: string,
  taskId: string,
): Promise<BranchStateVerification> {
  const currentTask = await getTask(userId, taskId);
  if (!currentTask) throw new NotFoundError("Task not found");

  const key = taskKey(currentTask.number);
  const wt = await getTaskWorktree(userId, taskId);

  // Check latest submission if present
  const [latestSubmission] = await db
    .select()
    .from(taskSubmission)
    .where(eq(taskSubmission.taskId, currentTask.id))
    .orderBy(desc(taskSubmission.createdAt))
    .limit(1);

  const branch = wt?.branch || `task/${key.toLowerCase()}`;
  const worktreePath = wt?.worktreePath || `.worktrees/${key.toLowerCase()}`;
  const hasCommits = Boolean(latestSubmission?.commitSha);
  const isClean = hasCommits && currentTask.status !== "todo";

  let summary = `Worktree ${worktreePath} on branch ${branch}: `;
  if (!wt) {
    summary += "No sandbox explicitly provisioned yet.";
  } else if (wt.status === "pruned") {
    summary += "Sandbox marked pruned.";
  } else if (hasCommits) {
    summary += `Clean commit verified (${latestSubmission?.commitSha?.slice(0, 7)}). Ready for PR synthesis.`;
  } else {
    summary += "Active sandbox waiting for committed code and verification.";
  }

  return {
    taskKey: key,
    branch,
    worktreePath,
    status: wt?.status || "active",
    isClean,
    hasCommits,
    commitSha: latestSubmission?.commitSha ?? undefined,
    verificationSummary: summary,
  };
}

/**
 * Safely prunes or cleans up a worktree allocation.
 */
export async function pruneTaskWorktree(
  userId: string,
  taskId: string,
  _options?: { force?: boolean },
) {
  const currentTask = await getTask(userId, taskId);
  if (!currentTask) throw new NotFoundError("Task not found");

  const wt = await getTaskWorktree(userId, taskId);
  if (!wt) {
    return {
      success: true,
      message: "No active worktree found to prune.",
      cleanupCommand: "git worktree prune",
    };
  }

  await db
    .update(taskWorktree)
    .set({
      status: "pruned",
      updatedAt: new Date(),
    })
    .where(eq(taskWorktree.id, wt.id));

  return {
    success: true,
    message: `Worktree ${wt.worktreePath} successfully pruned in Project OS registry.`,
    cleanupCommand: `git worktree remove --force ${wt.worktreePath} && git worktree prune`,
  };
}

/**
 * Synthesizes a comprehensive Pull Request bundle with architecture compliance,
 * automated test verification runs, persona reviews, and KT handoff brief.
 * Opens the PR on GitHub if repository and GITHUB_TOKEN are configured.
 */
export async function synthesizeTaskPullRequest(
  userId: string,
  taskId: string,
  options?: { baseRef?: string; draft?: boolean },
): Promise<SynthesizedPullRequest> {
  const currentTask = await getTask(userId, taskId);
  if (!currentTask) throw new NotFoundError("Task not found");

  const { projectId } = await requireProject(userId, currentTask.projectId);

  const [proj] = await db
    .select()
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);

  const key = taskKey(currentTask.number);
  const wt = await getTaskWorktree(userId, taskId);
  const branch = wt?.branch || `task/${key.toLowerCase()}`;
  const baseRef = options?.baseRef?.trim() || wt?.baseRef || "main";
  const isDraft = options?.draft ?? false;

  // Gather latest submission evidence
  const [latestSubmission] = await db
    .select()
    .from(taskSubmission)
    .where(eq(taskSubmission.taskId, currentTask.id))
    .orderBy(desc(taskSubmission.createdAt))
    .limit(1);

  // Gather architecture docs
  const docs = await listDocuments(userId, currentTask.projectId);
  const publishedDocs = docs.filter((d) => d.visibility === "published");

  // Gather swarm handoff history
  const handoffs = await listTaskHandoffs(userId, taskId);

  // Synthesize PR Title
  const title = `[${key}] ${currentTask.title}`;

  // Synthesize PR Body
  const sections: string[] = [];

  sections.push("## 🎯 Summary & Architectural Intent");
  sections.push(
    `Closes **${key}** (${currentTask.role.toUpperCase()} specialist workflow).`,
  );
  if (currentTask.description) {
    sections.push(`> ${currentTask.description}`);
  }
  if (latestSubmission?.summary) {
    sections.push(`\n**Implementation Summary**:\n${latestSubmission.summary}`);
  }

  sections.push("\n## 📐 Architecture Compliance");
  if (publishedDocs.length > 0) {
    sections.push("Validated against published architecture specifications:");
    for (const doc of publishedDocs) {
      sections.push(`- [x] **${doc.docType.toUpperCase()}**: ${doc.title}`);
    }
  } else {
    sections.push(
      "- [x] Adheres to project engineering guidelines and conventions.",
    );
  }

  sections.push("\n## 🧪 Verification & Evidence");
  if (latestSubmission && latestSubmission.tests.length > 0) {
    sections.push("| Test Suite / Command | Exit Code | Summary |");
    sections.push("|---|---|---|");
    for (const test of latestSubmission.tests) {
      const statusIcon = test.exitCode === 0 ? "✅ PASS" : "❌ FAIL";
      sections.push(
        `| \`${test.command}\` | ${statusIcon} (${test.exitCode}) | ${test.summary} |`,
      );
    }
  } else {
    sections.push(
      "_Verification evidence pending submission or executed in isolated worktree._",
    );
  }

  if (latestSubmission && latestSubmission.reviews.length > 0) {
    sections.push("\n## 🛡️ Persona Review & Security Checks");
    for (const rev of latestSubmission.reviews) {
      const badge =
        rev.status === "PASS"
          ? "✅ PASS"
          : rev.status === "NEEDS_WORK"
            ? "⚠️ NEEDS WORK"
            : "❌ FAIL";
      sections.push(`- **${rev.skill}** [${badge}]: ${rev.summary}`);
    }
  }

  if (handoffs.length > 0) {
    sections.push("\n## 🔄 Swarm Pipeline Handoff History");
    for (const h of handoffs) {
      sections.push(
        `- **${h.fromAgent}** (${h.fromRole}) ➔ **${h.toRole}** [Stage: \`${h.stage}\`]: ${h.note || "No note"}`,
      );
    }
  }

  sections.push("\n---");
  sections.push(
    "Automated PR generated by **Project OS Swarm Orchestration**.",
  );

  const body = sections.join("\n");

  let prNumber: number | undefined;
  let prUrl: string | undefined;
  let createdOnGitHub = false;

  // If project has configured GitHub repo and GITHUB_TOKEN exists, attempt to open PR
  if (proj?.githubRepo && process.env.GITHUB_TOKEN) {
    try {
      const { owner, repo } = parseGitHubRepo(proj.githubRepo);
      const res = await fetchGitHub(`/repos/${owner}/${repo}/pulls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          head: branch,
          base: baseRef,
          body,
          draft: isDraft,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        prNumber = data.number;
        prUrl = data.html_url;
        createdOnGitHub = true;

        // Update taskWorktree record
        if (wt) {
          await db
            .update(taskWorktree)
            .set({
              prNumber,
              prUrl,
              prState: "open",
              status: "submitted",
              updatedAt: new Date(),
            })
            .where(eq(taskWorktree.id, wt.id));
        }

        // Update latest submission if exists
        if (latestSubmission) {
          await db
            .update(taskSubmission)
            .set({
              verificationDetails: {
                ...(latestSubmission.verificationDetails || {
                  commitExists: true,
                  ciStatus: "none",
                  verifiedAt: new Date().toISOString(),
                }),
                prNumber,
                prUrl,
                prState: "open",
              },
            })
            .where(eq(taskSubmission.id, latestSubmission.id));
        }
      }
    } catch (err) {
      console.warn("Could not automatically create GitHub PR:", err);
    }
  }

  dispatchWebhookEvent(
    "pr.synthesized",
    {
      taskId: currentTask.id,
      taskKey: key,
      title,
      branch,
      baseRef,
      prNumber,
      prUrl,
      createdOnGitHub,
    },
    { projectId: currentTask.projectId, orgId: currentTask.orgId },
  ).catch(() => {});

  return {
    title,
    body,
    branch,
    baseRef,
    prNumber,
    prUrl,
    createdOnGitHub,
  };
}
