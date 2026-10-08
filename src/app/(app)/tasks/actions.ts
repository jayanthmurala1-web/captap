"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DomainError } from "@/lib/errors";
import { requireSession } from "@/lib/session";
import {
  assignTask,
  assignTaskAgent,
  createTasks,
  decideTask,
  deleteTask,
  moveTaskStatus,
  releaseTask,
  retractSubmission,
  updateTask,
} from "@/lib/tasks";

export type FormState = { error?: string; ok?: boolean } | undefined;

async function run(
  paths: string[],
  fn: () => Promise<unknown>,
): Promise<FormState> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  for (const p of paths) revalidatePath(p);
  return { ok: true };
}

export async function createTaskAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  const input = z
    .object({
      projectId: z.string(),
      title: z.string(),
      role: z.enum(["developer", "devops", "qa", "product"]),
      description: z.string().default(""),
      // "auto" = let skill matching pick; anything else is an agent name.
      agent: z.string().optional(),
    })
    .parse(Object.fromEntries(form));
  const { agent, ...task } = input;
  const prdDocumentId = form.get("prdDocumentId");
  return run([`/projects/${input.projectId}`], () =>
    createTasks(user.id, input.projectId, [
      {
        ...task,
        assignedSkill: agent && agent !== "auto" ? agent : undefined,
        prdDocumentId:
          prdDocumentId && prdDocumentId !== "none"
            ? String(prdDocumentId)
            : undefined,
        requirementKeys: form.getAll("requirementKey").map(String),
      },
    ]),
  );
}

/** Sets the PRD a task is built under and the requirements it delivers (replaces the old links). */
export async function updateTaskLinksAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  const taskId = z.string().parse(form.get("taskId"));
  const prd = form.get("prdDocumentId");
  return run([`/tasks/${taskId}`], () =>
    updateTask(user.id, taskId, {
      prdDocumentId: prd && prd !== "none" ? String(prd) : null,
      requirementKeys: form.getAll("requirementKey").map(String),
    }),
  );
}

export async function assignTaskAgentAction(
  taskId: string,
  agentName: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { user } = await requireSession();
  try {
    await assignTaskAgent(user.id, taskId, agentName);
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

export async function assignTaskAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  const { taskId, projectId, assigneeId } = z
    .object({
      taskId: z.string(),
      projectId: z.string(),
      assigneeId: z.string().optional(),
    })
    .parse(Object.fromEntries(form));
  return run([`/tasks/${taskId}`, `/projects/${projectId}`], () =>
    assignTask(user.id, taskId, assigneeId || null),
  );
}

export async function updateTaskAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  const raw = Object.fromEntries(form);
  const { taskId, projectId, title, description, role, assigneeId } = z
    .object({
      taskId: z.string(),
      projectId: z.string(),
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(50_000).optional(),
      role: z.enum(["developer", "devops", "qa", "product"]).optional(),
      assigneeId: z.string().optional(),
    })
    .parse(raw);
  return run([`/tasks/${taskId}`, `/projects/${projectId}`], () =>
    updateTask(user.id, taskId, {
      title,
      description,
      role,
      assigneeId: assigneeId !== undefined ? assigneeId || null : undefined,
    }),
  );
}

export async function deleteTaskAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  const { taskId, projectId } = z
    .object({
      taskId: z.string(),
      projectId: z.string(),
    })
    .parse(Object.fromEntries(form));
  const res = await run([`/projects/${projectId}`], () =>
    deleteTask(user.id, taskId),
  );
  // Redirect from the server: revalidating re-renders the page being viewed, which is now a 404.
  if (res?.ok) redirect(`/projects/${projectId}`);
  return res;
}

/** Human-only decisions (ADR-004): approve, reject with a note, or force-release a stuck task. */
export async function taskDecisionAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  const raw = Object.fromEntries(form);
  const {
    taskId,
    projectId,
    action,
    note,
    addToLearnedRules,
    targetSkillName,
    overrideBlocking,
  } = z
    .object({
      taskId: z.string(),
      projectId: z.string(),
      action: z.enum(["approve", "reject", "release"]),
      note: z.string().optional(),
      addToLearnedRules: z
        .preprocess(
          (v) => v === "true" || v === "on" || v === true,
          z.boolean(),
        )
        .optional(),
      targetSkillName: z.string().optional(),
      overrideBlocking: z
        .preprocess(
          (v) => v === "true" || v === "on" || v === true,
          z.boolean(),
        )
        .optional(),
    })
    .parse(raw);
  return run([`/tasks/${taskId}`, `/projects/${projectId}`, "/flow"], () =>
    action === "release"
      ? releaseTask(user.id, taskId, null)
      : decideTask(
          user.id,
          taskId,
          action === "approve" ? "approved" : "rejected",
          note,
          {
            addToLearnedRules: Boolean(addToLearnedRules),
            targetSkillName: targetSkillName?.trim() || undefined,
            overrideBlocking: Boolean(overrideBlocking),
          },
        ),
  );
}

export async function addLearnedRuleAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  const { projectId, rule, skillName } = z
    .object({
      projectId: z.string(),
      rule: z.string().min(1, "Rule description is required"),
      skillName: z.string().default("code-review"),
    })
    .parse(Object.fromEntries(form));
  const { distillLearningFromCritique } = await import("@/lib/skills");
  return run([`/projects/${projectId}`, "/flow"], () =>
    distillLearningFromCritique(user.id, {
      projectId,
      rule,
      skillName,
      source: "manual",
    }),
  );
}

export async function deleteLearnedRuleAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  const { ruleId, projectId } = z
    .object({
      ruleId: z.string(),
      projectId: z.string(),
    })
    .parse(Object.fromEntries(form));
  const { deleteLearnedRule } = await import("@/lib/skills");
  return run([`/projects/${projectId}`, "/flow"], () =>
    deleteLearnedRule(user.id, ruleId),
  );
}

export async function verifySubmissionAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  const { submissionId, taskId } = z
    .object({
      submissionId: z.string(),
      taskId: z.string(),
    })
    .parse(Object.fromEntries(form));
  const { verifyTaskSubmission } = await import("@/lib/github");
  return run([`/tasks/${taskId}`], () =>
    verifyTaskSubmission(user.id, submissionId),
  );
}

export async function setProjectGithubRepoAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  const { projectId, githubRepo } = z
    .object({
      projectId: z.string(),
      githubRepo: z.string().optional(),
    })
    .parse(Object.fromEntries(form));
  const { setProjectGithubRepo } = await import("@/lib/github");
  return run([`/projects/${projectId}`], () =>
    setProjectGithubRepo(user.id, projectId, githubRepo?.trim() || null),
  );
}

export async function runPersonaReviewAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  const { submissionId, taskId, skillName } = z
    .object({
      submissionId: z.string(),
      taskId: z.string(),
      skillName: z.string().optional(),
    })
    .parse(Object.fromEntries(form));
  const { runPersonaReview } = await import("@/lib/persona-review");
  return run([`/tasks/${taskId}`], () =>
    runPersonaReview(
      user.id,
      submissionId,
      // "all" (or empty) = run every reviewer agent.
      skillName && skillName !== "all" ? skillName.trim() : undefined,
    ),
  );
}

export async function moveTaskStatusAction(
  taskId: string,
  projectId: string,
  newStatus: "todo" | "in_progress" | "in_review" | "done",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { user } = await requireSession();
    await moveTaskStatus(user.id, taskId, newStatus);
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to move task",
    };
  }
}

export async function handoffTaskAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  const raw = Object.fromEntries(form);
  const {
    taskId,
    projectId,
    fromAgent,
    toRole,
    toAgent,
    stage,
    note,
    commitSha,
    branch,
  } = z
    .object({
      taskId: z.string(),
      projectId: z.string(),
      fromAgent: z.string().default("team-user"),
      toRole: z.enum(["developer", "qa", "devops", "product"]),
      toAgent: z.string().optional(),
      stage: z.enum(["build", "test", "review", "approval"]),
      note: z.string().default(""),
      commitSha: z.string().optional(),
      branch: z.string().optional(),
    })
    .parse(raw);

  const { handoffTaskToSpecialist } = await import("@/lib/swarm");

  return run([`/tasks/${taskId}`, `/projects/${projectId}`], () =>
    handoffTaskToSpecialist(user.id, taskId, {
      fromAgent: fromAgent.trim() || user.name || "team-user",
      toRole,
      toAgent: toAgent?.trim() || undefined,
      stage,
      note,
      artifacts: {
        commitSha: commitSha?.trim() || undefined,
        branch: branch?.trim() || undefined,
      },
    }),
  );
}

export async function synthesizePullRequestAction(
  taskId: string,
  draft?: boolean,
): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  try {
    const { user } = await requireSession();
    const { synthesizeTaskPullRequest } = await import("@/lib/worktree");
    const res = await synthesizeTaskPullRequest(user.id, taskId, { draft });
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true, data: res };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to synthesize PR",
    };
  }
}

/** The submitter pulls their own pending work back before anyone decides it. */
export async function retractSubmissionAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  const { taskId, projectId } = z
    .object({ taskId: z.string(), projectId: z.string() })
    .parse(Object.fromEntries(form));
  return run([`/tasks/${taskId}`, `/projects/${projectId}`], () =>
    retractSubmission(user.id, taskId),
  );
}
