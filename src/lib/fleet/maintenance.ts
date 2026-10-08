import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { project, task, taskWorktree } from "@/db/schema";
import { requireProject } from "../access";
import { getAgentTelemetrySummary } from "../ai/telemetry";
import { NotFoundError } from "../errors";
import { taskKey } from "../tasks";
import { getProjectTelemetry } from "../telemetry";

export interface PruneResult {
  projectId: string;
  prunedWorktreeIds: string[];
  prunedTaskKeys: string[];
  reclaimedDiskSpaceEstMb: number;
  cleanupCommands: string[];
}

export interface FleetHealthAudit {
  projectId: string;
  projectName: string;
  auditTimestamp: string;
  healthGrade: "A+" | "A" | "B" | "C" | "F";
  healthScore: number;
  metrics: {
    activeWorktrees: number;
    staleWorktrees: number;
    completedTasksWithoutPrunedWorktrees: number;
    activeAgentSpendUsd: number;
    tokenSpendBurnRate: string;
    criticalPathDepth: number;
    dependencyBottlenecks: number;
    architectureReadinessScore: number;
  };
  recommendations: string[];
}

/**
 * Discovers and prunes worktrees that belong to completed tasks or have exceeded inactivity thresholds.
 */
export async function pruneStaleWorktrees(
  userId: string,
  projectId: string,
  options?: { maxAgeDays?: number; dryRun?: boolean },
): Promise<PruneResult> {
  const p = await requireProject(userId, projectId);
  const maxAgeDays = options?.maxAgeDays ?? 7;
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  // Find worktrees in this project that are active/submitted
  const worktrees = await db
    .select({
      id: taskWorktree.id,
      taskId: taskWorktree.taskId,
      branch: taskWorktree.branch,
      worktreePath: taskWorktree.worktreePath,
      status: taskWorktree.status,
      createdAt: taskWorktree.createdAt,
      taskStatus: task.status,
      taskNumber: task.number,
    })
    .from(taskWorktree)
    .innerJoin(task, eq(task.id, taskWorktree.taskId))
    .where(
      and(
        eq(taskWorktree.projectId, p.projectId),
        or(
          eq(taskWorktree.status, "active"),
          eq(taskWorktree.status, "submitted"),
        ),
      ),
    );

  // Eligible for pruning if:
  // 1. Task is completed ('done')
  // 2. Or worktree was created before cutoff date
  const eligible = worktrees.filter(
    (wt) => wt.taskStatus === "done" || wt.createdAt < cutoff,
  );

  const prunedWorktreeIds = eligible.map((w) => w.id);
  const prunedTaskKeys = eligible.map((w) => taskKey(w.taskNumber));
  const cleanupCommands = eligible.map(
    (w) =>
      `git worktree remove --force ${w.worktreePath} && git branch -D ${w.branch}`,
  );

  if (!options?.dryRun && prunedWorktreeIds.length > 0) {
    await db
      .update(taskWorktree)
      .set({
        status: "pruned",
      })
      .where(inArray(taskWorktree.id, prunedWorktreeIds));
  }

  // Estimate ~120MB per node_modules/git worktree directory
  const reclaimedDiskSpaceEstMb = eligible.length * 120;

  return {
    projectId: p.projectId,
    prunedWorktreeIds,
    prunedTaskKeys,
    reclaimedDiskSpaceEstMb,
    cleanupCommands,
  };
}

/**
 * Runs a comprehensive fleet health audit across project telemetry, active worktrees,
 * AI token spend, dependency bottlenecks, and provides actionable recommendations.
 */
export async function runFleetHealthAudit(
  userId: string,
  projectId: string,
): Promise<FleetHealthAudit> {
  const p = await requireProject(userId, projectId);

  const [projRow] = await db
    .select({ name: project.name })
    .from(project)
    .where(eq(project.id, p.projectId))
    .limit(1);

  if (!projRow) throw new NotFoundError("Project not found");

  // Parallel gathering of telemetry, AI spend, and worktrees
  const [telemetry, aiTelemetry, worktrees] = await Promise.all([
    getProjectTelemetry(userId, p.projectId),
    getAgentTelemetrySummary(userId, p.projectId).catch(() => ({
      totalEstimatedCostUsd: "0.000000",
      totalTokens: 0,
      totalExecutions: 0,
    })),
    db
      .select({
        status: taskWorktree.status,
        taskStatus: task.status,
        createdAt: taskWorktree.createdAt,
      })
      .from(taskWorktree)
      .innerJoin(task, eq(task.id, taskWorktree.taskId))
      .where(eq(taskWorktree.projectId, p.projectId)),
  ]);

  const activeWorktrees = worktrees.filter(
    (w) => w.status === "active" || w.status === "submitted",
  ).length;

  const completedWithActiveWorktrees = worktrees.filter(
    (w) =>
      (w.status === "active" || w.status === "submitted") &&
      w.taskStatus === "done",
  ).length;

  const weekCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const staleWorktrees = worktrees.filter(
    (w) =>
      (w.status === "active" || w.status === "submitted") &&
      w.createdAt < weekCutoff,
  ).length;

  const spendUsd = parseFloat(aiTelemetry.totalEstimatedCostUsd || "0") || 0;
  const recommendations: string[] = [];

  // Calculate composite health score
  let score = 100;

  if (completedWithActiveWorktrees > 0) {
    score -= Math.min(20, completedWithActiveWorktrees * 5);
    recommendations.push(
      `Prune ${completedWithActiveWorktrees} worktrees from completed tasks to reclaim local disk storage.`,
    );
  }

  if (telemetry.readiness.score < 80) {
    score -= 15;
    recommendations.push(
      `Architecture Readiness is ${telemetry.readiness.score}%. Publish remaining architectural documents to prevent drift.`,
    );
  }

  if (telemetry.dependencies.bottlenecks.length > 0) {
    score -= Math.min(25, telemetry.dependencies.bottlenecks.length * 5);
    recommendations.push(
      `Resolve top dependency bottlenecks (${telemetry.dependencies.bottlenecks
        .slice(0, 2)
        .map((b) => b.key)
        .join(", ")}) to unblock pending parallel work.`,
    );
  }

  if (telemetry.autonomy.autonomyIndex < 60) {
    score -= 15;
    recommendations.push(
      `Agent Autonomy Index is ${telemetry.autonomy.autonomyIndex}%. Distill rejection notes into institutional learned rules to reduce rework cycles.`,
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "All fleet metrics optimal. Zero unmanaged worktrees or blocking bottlenecks detected.",
    );
  }

  const normalizedScore = Math.max(10, Math.min(100, score));

  let healthGrade: FleetHealthAudit["healthGrade"] = "F";
  if (normalizedScore >= 95) healthGrade = "A+";
  else if (normalizedScore >= 85) healthGrade = "A";
  else if (normalizedScore >= 70) healthGrade = "B";
  else if (normalizedScore >= 50) healthGrade = "C";

  return {
    projectId: p.projectId,
    projectName: projRow.name,
    auditTimestamp: new Date().toISOString(),
    healthGrade,
    healthScore: normalizedScore,
    metrics: {
      activeWorktrees,
      staleWorktrees,
      completedTasksWithoutPrunedWorktrees: completedWithActiveWorktrees,
      activeAgentSpendUsd: spendUsd,
      tokenSpendBurnRate: `$${spendUsd.toFixed(4)} USD (${aiTelemetry.totalTokens.toLocaleString()} tokens)`,
      criticalPathDepth: telemetry.dependencies.criticalPathDepth,
      dependencyBottlenecks: telemetry.dependencies.bottlenecks.length,
      architectureReadinessScore: telemetry.readiness.score,
    },
    recommendations,
  };
}
