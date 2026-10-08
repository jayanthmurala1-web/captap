import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  document,
  member,
  project,
  requirement,
  task,
  taskDependency,
  taskRequirement,
  taskSubmission,
  user,
} from "@/db/schema";
import {
  isUuid,
  requireMember,
  requireProject,
  requireProjectCapability,
} from "./access";
import { recordAudit } from "./audit";
import { ensureDeveloperWorkLedger } from "./documents";
import { appLink, sendEmail, taskDecisionEmail } from "./email";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { generateGitIsolation } from "./git-isolation";
import { verifyTaskSubmission } from "./github";
import { runPersonaReview } from "./persona-review";
import { resolveTaskLinks, taskRequirements } from "./requirements";
import { isBlockingReview } from "./review-checklist";
import {
  distillLearningFromCritique,
  listAgentNames,
  matchSkillsForTask,
} from "./skills";
import { dispatchWebhookEvent } from "./webhooks";

export type TaskRole = (typeof task.$inferSelect)["role"];
export type TaskStatus = (typeof task.$inferSelect)["status"];
export const taskKey = (n: number) => `T-${n}`;

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new ValidationError(
      r.error.issues
        .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
        .join("; "),
    );
  }
  return r.data;
}

const role = z.enum(["developer", "devops", "qa", "product"]);
const agentName = z.string().trim().min(1).max(64);

/** SQL: every dependency of the task whose id column is `idCol` is done. Used inside claim statements. */
const depsDone = (idCol: "t.id" | '"task"."id"') =>
  sql.raw(
    `NOT EXISTS (SELECT 1 FROM task_dependency d JOIN task dt ON dt.id = d.depends_on_id
                 WHERE d.task_id = ${idCol} AND dt.status <> 'done')`,
  );

async function loadTask(userId: string, taskId: string) {
  const trimmed = taskId.trim();
  let row: typeof task.$inferSelect | undefined;

  if (isUuid(trimmed)) {
    [row] = await db.select().from(task).where(eq(task.id, trimmed));
  } else {
    // If not UUID, check if it's formatted as "T-1", "T1", or "1". Org membership here is only
    // a candidate filter (task numbers repeat per project) — requireProject below is the real gate.
    const match = trimmed.match(/^(?:T-?)?(\d+)$/i);
    if (match) {
      const taskNum = parseInt(match[1], 10);
      const rows = await db
        .select({ task })
        .from(task)
        .innerJoin(
          member,
          and(eq(member.organizationId, task.orgId), eq(member.userId, userId)),
        )
        .where(eq(task.number, taskNum))
        .orderBy(desc(task.createdAt));
      row = rows[0]?.task;
    }
  }
  if (!row) throw new NotFoundError("Task not found");

  // Project-level isolation, not just org membership: an org member with no role in this
  // project and no access_all_projects capability must not be able to touch its tasks.
  await requireProject(userId, row.projectId).catch(() => {
    throw new NotFoundError("Task not found");
  });
  return row;
}

export async function listMembers(userId: string, orgId: string) {
  await requireMember(userId, orgId);
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: member.role,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, orgId));
}

// ---------- create ----------

const newTask = z.object({
  ref: z.string().max(40).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(50_000).default(""),
  role,
  storyPoints: z.number().int().min(1).max(100).optional().default(1),
  assigneeId: z.string().optional(),
  assignedSkill: z.string().trim().min(1).max(64).optional(),
  prdDocumentId: z.string().optional(),
  requirementKeys: z.array(z.string()).max(50).default([]),
  outputContract: z.record(z.string(), z.unknown()).optional(),
  dependsOn: z.array(z.string()).max(50).default([]),
});
export type NewTask = z.input<typeof newTask>;

/**
 * Creates tasks in one transaction. `dependsOn` entries are a `ref` of an EARLIER item in the batch,
 * an existing task key ("T-4") or id. Forward references are rejected, so no cycles can exist.
 */
export async function createTasks(
  userId: string,
  projectId: string,
  input: NewTask[],
) {
  const { orgId, projectId: resolvedProjectId } =
    await requireProjectCapability(userId, projectId, "manage_tasks");
  const items = validate(z.array(newTask).min(1).max(100), input);
  const agents = items.flatMap((i) =>
    i.assignedSkill ? [i.assignedSkill] : [],
  );
  if (agents.length) {
    const known = await listAgentNames(userId, resolvedProjectId);
    const unknown = agents.find((a) => !known.has(a));
    if (unknown) throw new ValidationError(`No agent named "${unknown}"`);
  }

  const assignees = [
    ...new Set(items.flatMap((i) => (i.assigneeId ? [i.assigneeId] : []))),
  ];
  if (assignees.length) {
    const found = await db
      .select({ id: member.userId })
      .from(member)
      .where(
        and(
          eq(member.organizationId, orgId),
          inArray(member.userId, assignees),
        ),
      );
    const missing = assignees.filter((a) => !found.some((f) => f.id === a));
    if (missing.length)
      throw new ValidationError(
        `Not members of this organization: ${missing.join(", ")}`,
      );
  }

  // Each task's PRD and requirement keys must be real and live in this project (spec 017).
  const links = await Promise.all(
    items.map((i) =>
      resolveTaskLinks(
        db,
        resolvedProjectId,
        i.prdDocumentId,
        i.requirementKeys,
      ),
    ),
  );

  const existing = await db
    .select({ id: task.id, number: task.number })
    .from(task)
    .where(eq(task.projectId, resolvedProjectId));

  return db.transaction(async (tx) => {
    const [{ seq }] = await tx
      .update(project)
      .set({ taskSeq: sql`${project.taskSeq} + ${items.length}` })
      .where(eq(project.id, resolvedProjectId))
      .returning({ seq: project.taskSeq });
    const first = seq - items.length + 1;

    const rows = await tx
      .insert(task)
      .values(
        items.map((i, n) => ({
          orgId,
          projectId: resolvedProjectId,
          number: first + n,
          title: i.title,
          description: i.description,
          role: i.role,
          storyPoints: i.storyPoints ?? 1,
          assigneeId: i.assigneeId,
          assignedSkill: i.assignedSkill ?? null,
          prdDocumentId: links[n].prdDocumentId,
          outputContract: i.outputContract
            ? JSON.stringify(i.outputContract)
            : null,
          createdBy: userId,
        })),
      )
      .returning({ id: task.id, number: task.number, title: task.title });

    const linkRows = rows.flatMap((r, n) =>
      links[n].requirementIds.map((requirementId) => ({
        taskId: r.id,
        requirementId,
      })),
    );
    if (linkRows.length) await tx.insert(taskRequirement).values(linkRows);

    const byRef = new Map<string, string>();
    const edges: { taskId: string; dependsOnId: string }[] = [];
    items.forEach((item, n) => {
      for (const dep of item.dependsOn) {
        const target =
          byRef.get(dep) ??
          existing.find(
            (e) => e.id === dep || taskKey(e.number) === dep.toUpperCase(),
          )?.id;
        if (!target) {
          throw new ValidationError(
            `"${item.title}" depends on "${dep}", which is not an earlier item in this batch or an existing task`,
          );
        }
        edges.push({ taskId: rows[n].id, dependsOnId: target });
      }
      if (item.ref) byRef.set(item.ref, rows[n].id);
    });
    if (edges.length)
      await tx.insert(taskDependency).values(edges).onConflictDoNothing();

    for (const item of items) {
      if (item.assigneeId) {
        await ensureDeveloperWorkLedger(resolvedProjectId, item.assigneeId);
      }
    }

    const created = rows.map((r) => ({
      id: r.id,
      key: taskKey(r.number),
      title: r.title,
    }));
    for (const c of created)
      await recordAudit(tx, {
        orgId,
        projectId: resolvedProjectId,
        actorId: userId,
        action: "task.created",
        targetType: "task",
        targetId: c.id,
        targetLabel: c.key,
        detail: { title: c.title },
      });

    for (const c of created) {
      dispatchWebhookEvent(
        "task.created",
        { taskId: c.id, taskKey: c.key, title: c.title },
        { projectId: resolvedProjectId, orgId },
      ).catch(() => {});
    }

    return created;
  });
}

// ---------- read ----------

export async function listTasks(
  userId: string,
  projectId: string,
  filter: { status?: TaskStatus; mine?: boolean } = {},
) {
  const p = await requireProject(userId, projectId);
  const [rows, deps, reqLinks] = await Promise.all([
    db
      .select({
        id: task.id,
        number: task.number,
        title: task.title,
        role: task.role,
        status: task.status,
        storyPoints: task.storyPoints,
        prdDocumentId: task.prdDocumentId,
        legacyGroup: task.legacyGroup,
        outputContract: task.outputContract,
        assigneeId: task.assigneeId,
        assignee: user.name,
        claimedBy: task.claimedBy,
        claimedAgent: task.claimedAgent,
        reviewNote: task.reviewNote,
        updatedAt: task.updatedAt,
      })
      .from(task)
      .leftJoin(user, eq(user.id, task.assigneeId))
      .where(eq(task.projectId, p.projectId))
      .orderBy(asc(task.number)),
    db
      .select({
        taskId: taskDependency.taskId,
        dependsOnId: taskDependency.dependsOnId,
      })
      .from(taskDependency)
      .innerJoin(task, eq(task.id, taskDependency.taskId))
      .where(eq(task.projectId, p.projectId)),
    db
      .select({ taskId: taskRequirement.taskId, key: requirement.key })
      .from(taskRequirement)
      .innerJoin(task, eq(task.id, taskRequirement.taskId))
      .innerJoin(requirement, eq(requirement.id, taskRequirement.requirementId))
      .where(eq(task.projectId, p.projectId)),
  ]);
  // ponytail: whole-project scan per call; paginate/filter in SQL past a few thousand tasks per project.
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows
    .filter((r) => !filter.status || r.status === filter.status)
    .filter(
      (r) => !filter.mine || r.assigneeId === userId || r.claimedBy === userId,
    )
    .map((r) => ({
      ...r,
      key: taskKey(r.number),
      requirementKeys: reqLinks
        .filter((l) => l.taskId === r.id)
        .map((l) => l.key)
        .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2))),
      blockedBy: deps
        .filter(
          (d) =>
            d.taskId === r.id && byId.get(d.dependsOnId)?.status !== "done",
        )
        .map((d) => byId.get(d.dependsOnId)?.number ?? 0)
        .sort((a, b) => a - b)
        .map(taskKey),
    }));
}

/** Everything an agent needs to execute a task: the task, its dependencies, history and project docs. */
export async function getTask(userId: string, taskId: string) {
  const t = await loadTask(userId, taskId);
  const [dependencies, submissions, documents, [assignee], [prd], taskContext] =
    await Promise.all([
      db
        .select({
          id: task.id,
          number: task.number,
          title: task.title,
          status: task.status,
        })
        .from(taskDependency)
        .innerJoin(task, eq(task.id, taskDependency.dependsOnId))
        .where(eq(taskDependency.taskId, t.id))
        .orderBy(asc(task.number)),
      db
        .select()
        .from(taskSubmission)
        .where(eq(taskSubmission.taskId, t.id))
        .orderBy(desc(taskSubmission.createdAt)),
      db
        .select({
          id: document.id,
          title: document.title,
          kind: document.kind,
          version: document.currentVersion,
        })
        .from(document)
        .where(eq(document.projectId, t.projectId)),
      t.assigneeId
        ? db
            .select({ name: user.name, email: user.email })
            .from(user)
            .where(eq(user.id, t.assigneeId))
        : Promise.resolve([]),
      t.prdDocumentId
        ? db
            .select({ id: document.id, title: document.title })
            .from(document)
            .where(eq(document.id, t.prdDocumentId))
        : Promise.resolve([]),
      matchSkillsForTask(userId, t.id),
    ]);
  const requirements = await taskRequirements(t.id);

  let parsedContract = null;
  if (t.outputContract) {
    try {
      parsedContract = JSON.parse(t.outputContract);
    } catch {
      parsedContract = t.outputContract;
    }
  }

  return {
    ...t,
    key: taskKey(t.number),
    assignee: assignee ?? null,
    prd: prd ?? null,
    requirements,
    outputContract: parsedContract,
    dependencies: dependencies.map((d) => ({ ...d, key: taskKey(d.number) })),
    blocked: dependencies.some((d) => d.status !== "done"),
    submissions,
    projectDocuments: documents,
    gitIsolation: generateGitIsolation(taskKey(t.number), t.title),
    matchedSkills: taskContext.matchedSkills,
    learnedRules: taskContext.learnedRules,
    suggestedDocs: taskContext.suggestedDocs,
  };
}

/**
 * Returns a complete, self-contained agent execution bundle for a task:
 * full task spec, git isolation instructions, matched skills with markdown guidelines,
 * institutional gotchas, and relevant architecture documents.
 */
export async function getTaskExecutionBundle(userId: string, taskId: string) {
  const t = await getTask(userId, taskId);
  return {
    task: {
      id: t.id,
      key: t.key,
      number: t.number,
      title: t.title,
      description: t.description,
      role: t.role,
      status: t.status,
      outputContract: t.outputContract,
      reviewNote: t.reviewNote,
      assignee: t.assignee,
      prd: t.prd,
      requirements: t.requirements.filter((r) => !r.removed),
    },
    gitIsolation: t.gitIsolation,
    matchedSkills: t.matchedSkills,
    learnedRules: t.learnedRules,
    suggestedDocs: t.suggestedDocs,
    projectDocuments: t.projectDocuments,
    dependencies: t.dependencies,
  };
}

// ---------- claim ----------

const claimSet = (userId: string, agent: string) => ({
  status: "in_progress" as const,
  claimedBy: userId,
  claimedAgent: agent,
  claimedAt: new Date(),
});

/**
 * Atomically claims the next available task: todo, unblocked, role-matching, unassigned or assigned to me
 * (mine first, then lowest number). SKIP LOCKED lets parallel agents grab different tasks without waiting.
 */
export async function claimNextTask(
  userId: string,
  projectId: string,
  agent: string,
  forRole?: TaskRole,
) {
  const p = await requireProject(userId, projectId);
  const a = validate(agentName, agent);
  const r = forRole === undefined ? undefined : validate(role, forRole);
  const [claimed] = await db
    .update(task)
    .set(claimSet(userId, a))
    .where(
      sql`${task.id} = (
        SELECT t.id FROM task t
        WHERE t.project_id = ${p.projectId} AND t.status = 'todo'
          AND (t.assignee_id IS NULL OR t.assignee_id = ${userId})
          AND (t.assigned_skill IS NULL OR t.assigned_skill = ${a})
          ${r ? sql`AND t.role = ${r}` : sql``}
          AND ${depsDone("t.id")}
        ORDER BY (t.assignee_id IS NOT NULL) DESC, t.number
        LIMIT 1
        FOR UPDATE OF t SKIP LOCKED
      ) AND ${task.status} = 'todo'`,
    )
    .returning();
  return claimed ? getTask(userId, claimed.id) : null;
}

export async function claimTask(userId: string, taskId: string, agent: string) {
  const t = await loadTask(userId, taskId);
  const a = validate(agentName, agent);
  if (t.assignedSkill && t.assignedSkill !== a) {
    throw new ForbiddenError(
      `${taskKey(t.number)} is assigned to agent "${t.assignedSkill}", not "${a}"`,
    );
  }
  const [claimed] = await db
    .update(task)
    .set(claimSet(userId, a))
    .where(
      sql`${task.id} = ${t.id} AND ${task.status} = 'todo'
        AND (${task.assigneeId} IS NULL OR ${task.assigneeId} = ${userId})
        AND ${depsDone('"task"."id"')}`,
    )
    .returning();
  if (claimed) {
    dispatchWebhookEvent(
      "task.claimed",
      {
        taskId: claimed.id,
        taskKey: taskKey(claimed.number),
        agent: a,
        claimedBy: userId,
      },
      { projectId: t.projectId, orgId: t.orgId },
    ).catch(() => {});
    return getTask(userId, claimed.id);
  }

  // Explain why, from fresh state.
  const now = await getTask(userId, t.id);
  if (now.status !== "todo") {
    throw new ConflictError(
      `${now.key} is ${now.status}${now.claimedAgent ? ` (claimed by ${now.claimedAgent})` : ""}`,
    );
  }
  if (now.assigneeId && now.assigneeId !== userId)
    throw new ForbiddenError(`${now.key} is assigned to someone else`);
  const open = now.dependencies
    .filter((d) => d.status !== "done")
    .map((d) => d.key);
  throw new ConflictError(`${now.key} is blocked by ${open.join(", ")}`);
}

// ---------- submit / release ----------

const evidence = z.object({
  summary: z.string().trim().min(1).max(5_000),
  filesChanged: z
    .array(z.string().min(1).max(500))
    .min(1, "list at least one changed file")
    .max(500),
  tests: z
    .array(
      z.object({
        command: z.string().min(1).max(500),
        exitCode: z.number().int(),
        summary: z.string().min(1).max(2_000),
      }),
    )
    .min(1, "include at least one test run"),
  reviews: z
    .array(
      z.object({
        skill: z.string().min(1).max(64),
        status: z.enum(["PASS", "NEEDS_WORK", "FAIL"]),
        summary: z.string().min(1).max(5_000),
      }),
    )
    .default([]),
  branch: z.string().max(200).optional(),
  commitSha: z.string().max(64).optional(),
});
export type Evidence = z.input<typeof evidence>;

/** Only the claiming user + agent can submit; the task moves to in_review for a human decision. */
export async function submitTask(
  userId: string,
  taskId: string,
  agent: string,
  input: Evidence,
) {
  const t = await loadTask(userId, taskId);
  const a = validate(agentName, agent);
  const e = validate(evidence, input);
  const res = await db.transaction(async (tx) => {
    const [moved] = await tx
      .update(task)
      .set({ status: "in_review", reviewNote: null })
      .where(
        and(
          eq(task.id, t.id),
          eq(task.status, "in_progress"),
          eq(task.claimedBy, userId),
          eq(task.claimedAgent, a),
        ),
      )
      .returning();
    if (!moved) {
      throw t.status !== "in_progress"
        ? new ConflictError(
            `${taskKey(t.number)} is ${t.status}, not in_progress`,
          )
        : new ForbiddenError(
            `${taskKey(t.number)} is claimed by ${t.claimedAgent}, not ${a}`,
          );
    }
    const [submission] = await tx
      .insert(taskSubmission)
      .values({ taskId: t.id, submittedBy: userId, agent: a, ...e })
      .returning();
    await recordAudit(tx, {
      orgId: t.orgId,
      projectId: t.projectId,
      actorId: userId,
      action: "task.submitted",
      targetType: "task",
      targetId: t.id,
      targetLabel: taskKey(t.number),
      detail: { agent: a, submissionId: submission.id },
    });
    return {
      key: taskKey(t.number),
      status: moved.status,
      submissionId: submission.id,
    };
  });

  // Background checks: they must never fail the submit itself, but a failure has to be visible,
  // otherwise a reviewer just sees "not run yet" forever with no clue why.
  verifyTaskSubmission(userId, res.submissionId).catch((e) =>
    console.error(
      `GitHub verification failed for submission ${res.submissionId}:`,
      e,
    ),
  );
  runPersonaReview(userId, res.submissionId).catch((e) =>
    console.error(
      `Persona review failed for submission ${res.submissionId}:`,
      e,
    ),
  );

  dispatchWebhookEvent(
    "task.submitted",
    {
      taskId: t.id,
      taskKey: taskKey(t.number),
      submissionId: res.submissionId,
      agent: a,
      summary: e.summary,
      commitSha: e.commitSha,
      branch: e.branch,
    },
    { projectId: t.projectId, orgId: t.orgId },
  ).catch(() => {});

  return res;
}

/**
 * Pulls a submission back before anyone has decided it (wrong commit, forgot a file). Only the person
 * who submitted it can; the task returns to in_progress still claimed by them. The pending row is
 * deleted rather than marked, so the reviewer's queue and "last decisions" never show a ghost — the
 * audit log keeps the record that it happened. Once a human has decided, it's too late by design.
 */
export async function retractSubmission(
  userId: string,
  taskId: string,
  agent?: string,
) {
  const t = await loadTask(userId, taskId);
  const retracted = await db.transaction(async (tx) => {
    const [pending] = await tx
      .select({ id: taskSubmission.id, agent: taskSubmission.agent })
      .from(taskSubmission)
      .where(
        and(
          eq(taskSubmission.taskId, t.id),
          eq(taskSubmission.decision, "pending"),
          eq(taskSubmission.submittedBy, userId),
        ),
      );
    if (!pending || (agent !== undefined && pending.agent !== agent))
      throw new ConflictError(
        `${taskKey(t.number)} has no pending submission of yours to retract`,
      );
    const [moved] = await tx
      .update(task)
      .set({ status: "in_progress" })
      .where(and(eq(task.id, t.id), eq(task.status, "in_review")))
      .returning();
    if (!moved)
      throw new ConflictError(
        `${taskKey(t.number)} is ${t.status}, not in_review`,
      );
    await tx.delete(taskSubmission).where(eq(taskSubmission.id, pending.id));
    await recordAudit(tx, {
      orgId: t.orgId,
      projectId: t.projectId,
      actorId: userId,
      action: "task.submission_retracted",
      targetType: "task",
      targetId: t.id,
      targetLabel: taskKey(t.number),
      detail: { agent: pending.agent, submissionId: pending.id },
    });
    return moved;
  });
  return { key: taskKey(t.number), status: retracted.status };
}

/**
 * Returns an in-progress task to todo. Agents (MCP) must pass their own agent name;
 * humans in the web app pass `agent: null` to force-release a stuck task.
 */
export async function releaseTask(
  userId: string,
  taskId: string,
  agent: string | null,
) {
  const t = await loadTask(userId, taskId);
  // Force-release (web, agent: null) discards someone else's claimed work — require the same
  // capability deleteTask/assignTaskAgent use, not just membership.
  if (agent === null) {
    await requireProjectCapability(userId, t.projectId, "manage_tasks");
  }
  const owner =
    agent === null
      ? undefined
      : and(eq(task.claimedBy, userId), eq(task.claimedAgent, agent));
  const [released] = await db
    .update(task)
    .set({
      status: "todo",
      claimedBy: null,
      claimedAgent: null,
      claimedAt: null,
    })
    .where(and(eq(task.id, t.id), eq(task.status, "in_progress"), owner))
    .returning();
  if (!released)
    throw new ConflictError(
      `${taskKey(t.number)} is not in progress under agent ${agent}`,
    );
  return { key: taskKey(t.number), status: released.status };
}

// ---------- human decision (web only, never exposed over MCP: ADR-004) ----------

export type DecideTaskOptions = {
  addToLearnedRules?: boolean;
  targetSkillName?: string;
  customRule?: string;
  /** Approve anyway despite a blocking review (spec 024). Requires `note` — the override reason
   * becomes the audit trail, same as a rejection note. */
  overrideBlocking?: boolean;
};

/** Tell the person who submitted the work how it went (spec 020). Best-effort: never fails the decision. */
async function emailSubmitter(
  t: { id: string; number: number; title: string },
  decidedBy: string,
  decision: "approved" | "rejected",
  note?: string,
) {
  try {
    const [row] = await db
      .select({ submittedBy: taskSubmission.submittedBy, email: user.email })
      .from(taskSubmission)
      .innerJoin(user, eq(user.id, taskSubmission.submittedBy))
      .where(
        and(
          eq(taskSubmission.taskId, t.id),
          eq(taskSubmission.decidedBy, decidedBy),
        ),
      )
      .orderBy(desc(taskSubmission.decidedAt))
      .limit(1);
    if (!row || row.submittedBy === decidedBy) return;
    const [decider] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, decidedBy));
    await sendEmail({
      to: row.email,
      ...taskDecisionEmail({
        decision,
        taskKey: taskKey(t.number),
        taskTitle: t.title,
        note,
        decidedBy: decider?.name ?? "A reviewer",
        link: appLink(`/tasks/${t.id}`),
      }),
    });
  } catch (e) {
    console.error("could not notify the submitter:", e);
  }
}

export async function decideTask(
  userId: string,
  taskId: string,
  decision: "approved" | "rejected",
  note?: string,
  options?: DecideTaskOptions,
) {
  const t = await loadTask(userId, taskId);
  const n = note?.trim() || undefined;
  let blockingOverridden: string[] | undefined;
  if (decision === "rejected" && !n)
    throw new ValidationError("Say what needs to change");
  if (decision === "approved") {
    // Spec 016: approving is a permission (Owner, Admin, Lead, QA, Product by default), not just membership.
    await requireProjectCapability(userId, t.projectId, "approve_tasks");
    // ADR-004: the person who submitted the work cannot also be the one who approves it.
    const [pending] = await db
      .select({
        submittedBy: taskSubmission.submittedBy,
        reviews: taskSubmission.reviews,
      })
      .from(taskSubmission)
      .where(
        and(
          eq(taskSubmission.taskId, t.id),
          eq(taskSubmission.decision, "pending"),
        ),
      );
    if (pending?.submittedBy === userId)
      throw new ForbiddenError(
        "You submitted this work; a different person must approve it",
      );
    // Spec 024: a reviewer agent that reported `blocking: true` must actually block the button, not
    // just advise it — the gate said something, this is where it has to matter. Same definition the
    // task page's checklist already shows the human (isBlockingReview), so the two never disagree.
    const blocking = (pending?.reviews ?? []).filter(isBlockingReview);
    if (blocking.length > 0 && !options?.overrideBlocking) {
      throw new ValidationError(
        `Blocked by ${blocking.map((r) => r.skill).join(", ")}. Fix it, or approve anyway with a reason.`,
      );
    }
    if (blocking.length > 0 && options?.overrideBlocking && !n) {
      throw new ValidationError(
        "Say why you're approving over a blocking review",
      );
    }
    if (blocking.length > 0) blockingOverridden = blocking.map((r) => r.skill);
  }
  const moved = await db.transaction(async (tx) => {
    const [m] = await tx
      .update(task)
      .set(
        decision === "approved"
          ? { status: "done", reviewNote: null }
          : { status: "in_progress", reviewNote: n },
      )
      .where(and(eq(task.id, t.id), eq(task.status, "in_review")))
      .returning();
    if (!m)
      throw new ConflictError(
        `${taskKey(t.number)} is ${t.status}, not in_review`,
      );
    await tx
      .update(taskSubmission)
      .set({
        decision,
        decisionNote: n,
        decidedBy: userId,
        decidedAt: new Date(),
      })
      .where(
        and(
          eq(taskSubmission.taskId, t.id),
          eq(taskSubmission.decision, "pending"),
        ),
      );
    await recordAudit(tx, {
      orgId: t.orgId,
      projectId: t.projectId,
      actorId: userId,
      action: decision === "approved" ? "task.approved" : "task.rejected",
      targetType: "task",
      targetId: t.id,
      targetLabel: taskKey(t.number),
      detail: {
        ...(n ? { note: n } : {}),
        ...(blockingOverridden
          ? { overrodeBlockingReviews: blockingOverridden }
          : {}),
      },
    });
    return m;
  });

  // Continuous Learning Flywheel: distill rejection critique into institutional rules
  if (decision === "rejected" && options?.addToLearnedRules && n) {
    try {
      await distillLearningFromCritique(userId, {
        projectId: t.projectId,
        rule: options.customRule?.trim() || n,
        skillName: options.targetSkillName ?? "code-review",
        source: "human_critique",
        sourceTaskId: t.id,
      });
    } catch (err) {
      console.warn("Could not distill rejection into learned rule:", err);
    }
  }

  dispatchWebhookEvent(
    decision === "approved" ? "task.approved" : "task.rejected",
    {
      taskId: t.id,
      taskKey: taskKey(t.number),
      decision,
      note: n,
      decidedBy: userId,
    },
    { projectId: t.projectId, orgId: t.orgId },
  ).catch(() => {});

  await emailSubmitter(t, userId, decision, n);

  return moved;
}

/**
 * Board moves (web UI). Only To do <-> In progress. ADR-004: In review comes from an agent's
 * submitTask, and Done / sent back from a human's decideTask on the task page — the board
 * must never approve or reject evidence.
 */
export async function moveTaskStatus(
  userId: string,
  taskId: string,
  newStatus: TaskStatus,
) {
  const t = await loadTask(userId, taskId);
  await requireProject(userId, t.projectId);

  if (t.status === newStatus) {
    return t;
  }

  const target = validate(
    z.enum(["todo", "in_progress", "in_review", "done"]),
    newStatus,
  );
  if (t.status === "in_review" || t.status === "done") {
    throw new ValidationError(
      "Approve or send back this task from its page, where the evidence is.",
    );
  }
  if (target === "in_review" || target === "done") {
    throw new ValidationError(
      "Tasks reach review when an agent submits evidence, and Done when someone approves it.",
    );
  }

  return db.transaction(async (tx) => {
    const setValues: Partial<typeof task.$inferInsert> = {
      status: target,
      updatedAt: new Date(),
    };

    if (target === "todo") {
      // Releasing task: reset agent claim and review note
      setValues.claimedBy = null;
      setValues.claimedAgent = null;
      setValues.claimedAt = null;
      setValues.reviewNote = null;
    } else {
      const unfinishedDeps = await tx
        .select({ number: task.number })
        .from(taskDependency)
        .innerJoin(task, eq(task.id, taskDependency.dependsOnId))
        .where(
          and(eq(taskDependency.taskId, t.id), sql`${task.status} <> 'done'`),
        );
      if (unfinishedDeps.length > 0) {
        throw new ConflictError(
          `Cannot start task T-${t.number}: blocked by incomplete dependencies (${unfinishedDeps.map((d) => `T-${d.number}`).join(", ")})`,
        );
      }
      // Started by a person from the board
      setValues.claimedBy = userId;
      setValues.claimedAgent = "web-user";
      setValues.claimedAt = new Date();
    }

    const [updated] = await tx
      .update(task)
      .set(setValues)
      .where(eq(task.id, t.id))
      .returning();
    return updated;
  });
}

// ---------- admin task management (assign, update, delete) ----------

const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(50_000).optional(),
  role: role.optional(),
  storyPoints: z.number().int().min(1).max(100).optional(),
  assigneeId: z.string().nullable().optional(),
  prdDocumentId: z.string().nullable().optional(),
  requirementKeys: z.array(z.string()).max(50).optional(),
});
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

export async function updateTask(
  userId: string,
  taskId: string,
  input: UpdateTaskInput,
) {
  const t = await loadTask(userId, taskId);
  const { orgId } = await requireProjectCapability(
    userId,
    t.projectId,
    "manage_tasks",
  );
  const patch = validate(updateTaskSchema, input);

  if (patch.assigneeId) {
    const [found] = await db
      .select({ id: member.userId })
      .from(member)
      .where(
        and(
          eq(member.organizationId, orgId),
          eq(member.userId, patch.assigneeId),
        ),
      );
    if (!found) {
      throw new ValidationError(
        `User "${patch.assigneeId}" is not a member of this organization`,
      );
    }
  }

  const setValues: Partial<typeof task.$inferInsert> = {};
  if (patch.title !== undefined) setValues.title = patch.title;
  if (patch.description !== undefined)
    setValues.description = patch.description;
  if (patch.role !== undefined) setValues.role = patch.role;
  if (patch.storyPoints !== undefined)
    setValues.storyPoints = patch.storyPoints;
  if (patch.assigneeId !== undefined) {
    setValues.assigneeId = patch.assigneeId;
    if (patch.assigneeId) {
      await ensureDeveloperWorkLedger(t.projectId, patch.assigneeId);
    }
  }

  // Moving a task to another PRD drops its old requirement links; keys alone replace them.
  const prdChanged =
    patch.prdDocumentId !== undefined &&
    patch.prdDocumentId !== t.prdDocumentId;
  let relink: string[] | null = null;
  if (prdChanged || patch.requirementKeys !== undefined) {
    const prdId =
      patch.prdDocumentId !== undefined ? patch.prdDocumentId : t.prdDocumentId;
    const keys = patch.requirementKeys ?? [];
    const links = await resolveTaskLinks(db, t.projectId, prdId, keys);
    setValues.prdDocumentId = links.prdDocumentId;
    relink = links.requirementIds;
  }

  if (Object.keys(setValues).length > 0 || relink) {
    await db.transaction(async (tx) => {
      if (Object.keys(setValues).length > 0)
        await tx.update(task).set(setValues).where(eq(task.id, t.id));
      await recordAudit(tx, {
        orgId,
        projectId: t.projectId,
        actorId: userId,
        action: "task.updated",
        targetType: "task",
        targetId: t.id,
        targetLabel: taskKey(t.number),
        detail: {
          fields: [
            ...Object.keys(setValues),
            ...(relink ? ["requirements"] : []),
          ].filter((f, i, all) => all.indexOf(f) === i),
        },
      });
      if (relink) {
        await tx
          .delete(taskRequirement)
          .where(eq(taskRequirement.taskId, t.id));
        if (relink.length)
          await tx
            .insert(taskRequirement)
            .values(
              relink.map((requirementId) => ({ taskId: t.id, requirementId })),
            );
      }
    });
  }

  return getTask(userId, t.id);
}

/** Pin (or clear) the agent that should do a task. Leads/admins only; must be a real agent for the project. */
export async function assignTaskAgent(
  userId: string,
  taskId: string,
  agentName: string | null,
) {
  const t = await loadTask(userId, taskId);
  await requireProjectCapability(userId, t.projectId, "manage_tasks");
  const name = agentName?.trim() || null;
  if (name && !(await listAgentNames(userId, t.projectId)).has(name)) {
    throw new ValidationError(`No agent named "${name}"`);
  }
  const [row] = await db
    .update(task)
    .set({ assignedSkill: name, updatedAt: new Date() })
    .where(eq(task.id, t.id))
    .returning();
  await recordAudit(db, {
    orgId: t.orgId,
    projectId: t.projectId,
    actorId: userId,
    action: "task.updated",
    targetType: "task",
    targetId: t.id,
    targetLabel: taskKey(t.number),
    detail: { fields: ["assignedSkill"], agent: name },
  });
  return row;
}

export async function assignTask(
  userId: string,
  taskId: string,
  assigneeId: string | null,
) {
  return updateTask(userId, taskId, { assigneeId });
}

export async function deleteTask(userId: string, taskId: string) {
  const t = await loadTask(userId, taskId);
  await requireProjectCapability(userId, t.projectId, "manage_tasks");

  // Active work can't be deleted out from under whoever's doing it, or whoever's about to decide
  // it — release/decide it first, then delete.
  if (t.status === "in_progress" || t.status === "in_review") {
    throw new ConflictError(
      `${taskKey(t.number)} is ${t.status === "in_progress" ? "claimed and in progress" : "in review"} — release or decide it first, then delete it.`,
    );
  }

  // Deleting this task silently un-blocks whatever depends on it, even though its work was
  // never actually done — surface exactly what that is rather than let it happen invisibly.
  const dependents = await db
    .select({ number: task.number })
    .from(taskDependency)
    .innerJoin(task, eq(task.id, taskDependency.taskId))
    .where(eq(taskDependency.dependsOnId, t.id));
  const unblockedDependents = dependents.map((d) => taskKey(d.number));

  await db.transaction(async (tx) => {
    await tx
      .delete(taskDependency)
      .where(
        sql`${taskDependency.taskId} = ${t.id} OR ${taskDependency.dependsOnId} = ${t.id}`,
      );
    await tx.delete(taskSubmission).where(eq(taskSubmission.taskId, t.id));
    await tx.delete(task).where(eq(task.id, t.id));
    await recordAudit(tx, {
      orgId: t.orgId,
      projectId: t.projectId,
      actorId: userId,
      action: "task.deleted",
      targetType: "task",
      targetId: t.id,
      targetLabel: taskKey(t.number),
      detail: { title: t.title, unblockedDependents },
    });
  });

  return {
    id: t.id,
    key: taskKey(t.number),
    deleted: true,
    unblockedDependents,
  };
}

export function computeTasksHash(
  tasks: Array<{
    id: string;
    status: string;
    claimedAgent?: string | null;
    assigneeId?: string | null;
    updatedAt: Date | string;
  }>,
): string {
  if (tasks.length === 0) return "empty";
  return tasks
    .map(
      (t) =>
        `${t.id}:${t.status}:${t.claimedAgent ?? ""}:${t.assigneeId ?? ""}:${
          t.updatedAt instanceof Date ? t.updatedAt.getTime() : t.updatedAt
        }`,
    )
    .join("|");
}
