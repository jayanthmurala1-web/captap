import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  type HandoffArtifacts,
  type TaskHandoff,
  type TaskRole,
  task,
  taskHandoff,
} from "@/db/schema";
import { requireProject } from "./access";
import { appendDeveloperWorkLedger } from "./documents";
import { NotFoundError } from "./errors";
import { claimNextTask, getTask, taskKey } from "./tasks";
import { dispatchWebhookEvent } from "./webhooks";

export interface SwarmStageSummary {
  stage: "build" | "test" | "review" | "approval";
  label: string;
  role: TaskRole;
  icon: string;
  tasksCount: number;
  inProgressCount: number;
  tasks: Array<{
    id: string;
    key: string;
    title: string;
    role: TaskRole;
    status: string;
    claimedAgent?: string | null;
  }>;
}

export interface SwarmPipelineStatus {
  projectId: string;
  activeAgents: string[];
  totalHandoffsCount: number;
  stages: Record<"build" | "test" | "review" | "approval", SwarmStageSummary>;
  recentHandoffs: Array<TaskHandoff & { taskKey: string; taskTitle: string }>;
}

const roleSchema = z.enum(["developer", "qa", "devops", "product"]);
const stageSchema = z.enum(["build", "test", "review", "approval"]);

export const handoffInputSchema = z.object({
  fromAgent: z.string().trim().min(1).max(64),
  toRole: roleSchema,
  toAgent: z.string().trim().min(1).max(64).optional(),
  stage: stageSchema,
  note: z.string().trim().default(""),
  artifacts: z
    .object({
      commitSha: z.string().optional(),
      branch: z.string().optional(),
      worktree: z.string().optional(),
      testResults: z
        .array(
          z.object({
            command: z.string(),
            exitCode: z.number().int(),
            summary: z.string(),
          }),
        )
        .optional(),
      reviewFindings: z
        .array(
          z.object({
            severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
            fileLine: z.string().optional(),
            problem: z.string(),
            impact: z.string().optional(),
            fix: z.string().optional(),
          }),
        )
        .optional(),
      filesChanged: z.array(z.string()).optional(),
      notes: z.string().optional(),
    })
    .default({}),
});

export type HandoffInput = z.input<typeof handoffInputSchema>;

/**
 * Claims next task specifically matching the agent's specialist role (developer, qa, devops).
 */
export async function claimNextSpecialistTask(
  userId: string,
  projectId: string,
  agent: string,
  role?: TaskRole,
) {
  return claimNextTask(userId, projectId, agent, role);
}

/**
 * Hands off a task to the next specialist in the multi-agent swarm pipeline.
 * e.g. Builder (developer) -> Tester (qa) -> Reviewer (devops) -> Human (approval)
 */
export async function handoffTaskToSpecialist(
  userId: string,
  taskId: string,
  rawInput: HandoffInput,
) {
  const input = handoffInputSchema.parse(rawInput);
  const currentTask = await getTask(userId, taskId);
  if (!currentTask) throw new NotFoundError("Task not found");

  const fromRole = currentTask.role;

  const result = await db.transaction(async (tx) => {
    // 1. Record the handoff event
    const [handoff] = await tx
      .insert(taskHandoff)
      .values({
        taskId: currentTask.id,
        stage: input.stage,
        fromAgent: input.fromAgent,
        fromRole,
        toRole: input.toRole,
        toAgent: input.toAgent,
        note: input.note,
        artifacts: input.artifacts as HandoffArtifacts,
      })
      .returning();

    // 2. Transition task state
    // When moving to approval, task goes to in_review for human approval.
    // Otherwise it moves to todo for the target specialist role to claim atomically.
    const isApprovalStage = input.stage === "approval";
    const nextStatus = isApprovalStage ? "in_review" : "todo";

    await tx
      .update(task)
      .set({
        role: input.toRole,
        status: nextStatus,
        claimedBy: null,
        claimedAgent: null,
        claimedAt: null,
        reviewNote: input.note
          ? `[Handoff from ${input.fromAgent} (${fromRole})]: ${input.note}`
          : null,
        updatedAt: new Date(),
      })
      .where(eq(task.id, currentTask.id));

    return handoff;
  });

  // Append KT briefing note to developer work ledger if applicable
  try {
    const briefNote = `**Swarm Handoff (${fromRole} ➔ ${input.toRole})** on ${taskKey(
      currentTask.number,
    )}: ${input.note || "Task transitioned to next specialist"}`;
    await appendDeveloperWorkLedger(userId, currentTask.projectId, {
      status: `Handoff: ${taskKey(currentTask.number)} -> ${input.toRole}`,
      ktHandoff: briefNote,
      rawText: input.artifacts?.commitSha
        ? `Commit: ${input.artifacts.commitSha} on branch ${input.artifacts.branch || "main"}`
        : undefined,
    });
  } catch (err) {
    console.warn("Could not append handoff note to work ledger:", err);
  }

  dispatchWebhookEvent(
    "task.handoff",
    {
      taskId: currentTask.id,
      taskKey: taskKey(currentTask.number),
      fromAgent: input.fromAgent,
      fromRole,
      toRole: input.toRole,
      toAgent: input.toAgent,
      stage: input.stage,
      note: input.note,
    },
    { projectId: currentTask.projectId, orgId: currentTask.orgId },
  ).catch(() => {});

  const updatedTask = await getTask(userId, taskId);
  return { handoff: result, task: updatedTask };
}

/**
 * Returns complete chronological handoff history for a task.
 */
export async function listTaskHandoffs(userId: string, taskId: string) {
  const currentTask = await getTask(userId, taskId);
  if (!currentTask) throw new NotFoundError("Task not found");

  return db
    .select()
    .from(taskHandoff)
    .where(eq(taskHandoff.taskId, currentTask.id))
    .orderBy(taskHandoff.createdAt);
}

/**
 * Aggregates live swarm pipeline status, active agents, and specialist stages for a project.
 */
export async function getSwarmPipeline(
  userId: string,
  projectId: string,
): Promise<SwarmPipelineStatus> {
  const { projectId: projId } = await requireProject(userId, projectId);

  const allTasks = await db
    .select({
      id: task.id,
      number: task.number,
      title: task.title,
      role: task.role,
      status: task.status,
      claimedAgent: task.claimedAgent,
    })
    .from(task)
    .where(eq(task.projectId, projId))
    .orderBy(task.number);

  const taskMap = new Map(allTasks.map((t) => [t.id, t]));
  const taskIds = allTasks.map((t) => t.id);

  let handoffs: TaskHandoff[] = [];
  if (taskIds.length > 0) {
    handoffs = await db
      .select()
      .from(taskHandoff)
      .where(inArray(taskHandoff.taskId, taskIds))
      .orderBy(desc(taskHandoff.createdAt))
      .limit(20);
  }

  const activeAgentsSet = new Set<string>();
  for (const t of allTasks) {
    if (t.claimedAgent && t.status !== "done") {
      activeAgentsSet.add(t.claimedAgent);
    }
  }

  // Stages partitioning
  const stages: Record<
    "build" | "test" | "review" | "approval",
    SwarmStageSummary
  > = {
    build: {
      stage: "build",
      label: "Build Stage",
      role: "developer",
      icon: "🛠️",
      tasksCount: 0,
      inProgressCount: 0,
      tasks: [],
    },
    test: {
      stage: "test",
      label: "Test & Verification",
      role: "qa",
      icon: "🧪",
      tasksCount: 0,
      inProgressCount: 0,
      tasks: [],
    },
    review: {
      stage: "review",
      label: "Security & Review",
      role: "devops",
      icon: "🛡️",
      tasksCount: 0,
      inProgressCount: 0,
      tasks: [],
    },
    approval: {
      stage: "approval",
      label: "Human Sign-off",
      role: "product",
      icon: "👤",
      tasksCount: 0,
      inProgressCount: 0,
      tasks: [],
    },
  };

  for (const t of allTasks) {
    if (t.status === "done") continue;

    let targetStage: "build" | "test" | "review" | "approval" = "build";

    if (t.status === "in_review") {
      targetStage = "approval";
    } else if (t.role === "qa") {
      targetStage = "test";
    } else if (t.role === "devops") {
      targetStage = "review";
    } else {
      targetStage = "build";
    }

    const summary = stages[targetStage];
    summary.tasksCount++;
    if (t.status === "in_progress") {
      summary.inProgressCount++;
    }
    summary.tasks.push({
      id: t.id,
      key: taskKey(t.number),
      title: t.title,
      role: t.role,
      status: t.status,
      claimedAgent: t.claimedAgent,
    });
  }

  const recentHandoffs = handoffs.map((h) => {
    const parentTask = taskMap.get(h.taskId);
    return {
      ...h,
      taskKey: parentTask ? taskKey(parentTask.number) : "T-?",
      taskTitle: parentTask ? parentTask.title : "Unknown Task",
    };
  });

  return {
    projectId: projId,
    activeAgents: Array.from(activeAgentsSet),
    totalHandoffsCount: handoffs.length,
    stages,
    recentHandoffs,
  };
}
