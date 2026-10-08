import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  type AgentExecutionTelemetry,
  agentExecutionTelemetry,
} from "@/db/schema";
import { requireProject } from "../access";
import { callCostUsd } from "./catalog";

export interface RecordAgentTelemetryInput {
  orgId: string;
  projectId?: string;
  taskId?: string;
  agentName?: string;
  userId?: string;
  /** org = the org's own key (not our cost); platform = ours or the instance's. */
  keySource?: "org" | "platform";
  /** consult | review | drift */
  purpose?: string;
  modelProvider: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  status?: "success" | "error" | "fallback";
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentTelemetrySummary {
  projectId: string;
  totalExecutions: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCostUsd: string;
  averageDurationMs: number;
  byModel: Record<
    string,
    { modelName: string; executions: number; tokens: number; costUsd: string }
  >;
  byProvider: Record<
    string,
    { provider: string; executions: number; tokens: number; costUsd: string }
  >;
  byAgent: Record<
    string,
    { agentName: string; executions: number; tokens: number; costUsd: string }
  >;
  recentExecutions: AgentExecutionTelemetry[];
}

/**
 * Records an agent execution log with token consumption, cost calculation, and latency.
 */
export async function recordAgentTelemetry(
  input: RecordAgentTelemetryInput,
): Promise<AgentExecutionTelemetry> {
  const totalTokens = input.inputTokens + input.outputTokens;
  const cost = callCostUsd(
    input.modelProvider,
    input.modelName,
    input.inputTokens,
    input.outputTokens,
  );

  const [row] = await db
    .insert(agentExecutionTelemetry)
    .values({
      orgId: input.orgId,
      projectId: input.projectId,
      taskId: input.taskId,
      agentName: input.agentName || "consult",
      userId: input.userId,
      keySource: input.keySource ?? "platform",
      purpose: input.purpose ?? "consult",
      modelProvider: input.modelProvider,
      modelName: input.modelName,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      totalTokens,
      estimatedCostUsd: cost,
      durationMs: input.durationMs,
      status: input.status || "success",
      errorMessage: input.errorMessage,
      metadata: input.metadata || {},
    })
    .returning();

  return row;
}

/**
 * Retrieves aggregated token and spend telemetry for a project.
 */
export async function getAgentTelemetrySummary(
  userId: string,
  projectId: string,
): Promise<AgentTelemetrySummary> {
  await requireProject(userId, projectId);

  const executions = await db
    .select()
    .from(agentExecutionTelemetry)
    .where(eq(agentExecutionTelemetry.projectId, projectId))
    .orderBy(desc(agentExecutionTelemetry.createdAt))
    .limit(100);

  let totalTokens = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostNum = 0;
  let totalDurationMs = 0;

  const byModel: AgentTelemetrySummary["byModel"] = {};
  const byProvider: AgentTelemetrySummary["byProvider"] = {};
  const byAgent: AgentTelemetrySummary["byAgent"] = {};

  for (const exec of executions) {
    const cost = Number.parseFloat(exec.estimatedCostUsd) || 0;
    totalTokens += exec.totalTokens;
    totalInputTokens += exec.inputTokens;
    totalOutputTokens += exec.outputTokens;
    totalCostNum += cost;
    totalDurationMs += exec.durationMs;

    // By Model
    if (!byModel[exec.modelName]) {
      byModel[exec.modelName] = {
        modelName: exec.modelName,
        executions: 0,
        tokens: 0,
        costUsd: "0.000000",
      };
    }
    const m = byModel[exec.modelName];
    m.executions += 1;
    m.tokens += exec.totalTokens;
    m.costUsd = (Number.parseFloat(m.costUsd) + cost).toFixed(6);

    // By Provider
    if (!byProvider[exec.modelProvider]) {
      byProvider[exec.modelProvider] = {
        provider: exec.modelProvider,
        executions: 0,
        tokens: 0,
        costUsd: "0.000000",
      };
    }
    const p = byProvider[exec.modelProvider];
    p.executions += 1;
    p.tokens += exec.totalTokens;
    p.costUsd = (Number.parseFloat(p.costUsd) + cost).toFixed(6);

    // By Agent
    if (!byAgent[exec.agentName]) {
      byAgent[exec.agentName] = {
        agentName: exec.agentName,
        executions: 0,
        tokens: 0,
        costUsd: "0.000000",
      };
    }
    const a = byAgent[exec.agentName];
    a.executions += 1;
    a.tokens += exec.totalTokens;
    a.costUsd = (Number.parseFloat(a.costUsd) + cost).toFixed(6);
  }

  const averageDurationMs =
    executions.length > 0 ? Math.round(totalDurationMs / executions.length) : 0;

  return {
    projectId,
    totalExecutions: executions.length,
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    totalEstimatedCostUsd: totalCostNum.toFixed(6),
    averageDurationMs,
    byModel,
    byProvider,
    byAgent,
    recentExecutions: executions.slice(0, 25),
  };
}
