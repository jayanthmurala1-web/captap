import { afterAll, beforeAll, expect, test } from "vitest";
import { createProject } from "../projects";
import { fixtures } from "../test-fixtures";
import { getAgentTelemetrySummary, recordAgentTelemetry } from "./telemetry";

const f = fixtures();

let owner: string;
let outsider: string;
let orgId: string;
let projectId: string;

beforeAll(async () => {
  owner = await f.user("ai-telemetry-owner");
  outsider = await f.user("ai-telemetry-outsider");

  orgId = await f.org("ai-telemetry-org", {
    [owner]: "owner",
  });

  const proj = await createProject(owner, orgId, {
    name: "AI Telemetry Project",
    description: "Testing token telemetry, spend aggregation, and benchmarks",
  });
  projectId = proj.id;
});

afterAll(async () => {
  await f.cleanup();
});

test("Phase 3.9: recordAgentTelemetry stores token consumption and calculates spend", async () => {
  const telemetry = await recordAgentTelemetry({
    orgId,
    projectId,
    agentName: "builder-agent",
    modelProvider: "anthropic",
    modelName: "claude-haiku-4-5-20251001",
    inputTokens: 10_000,
    outputTokens: 5_000,
    durationMs: 850,
    status: "success",
    metadata: { test: true },
  });

  expect(telemetry).toBeDefined();
  expect(telemetry.id).toBeDefined();
  expect(telemetry.totalTokens).toBe(15_000);
  expect(telemetry.modelName).toBe("claude-haiku-4-5-20251001");
  // 10k in @ $1 + 5k out @ $5 per 1M = $0.035
  expect(telemetry.estimatedCostUsd).toBe("0.035000");
  expect(Number.parseFloat(telemetry.estimatedCostUsd)).toBeGreaterThan(0);
});

test("Phase 3.9: getAgentTelemetrySummary aggregates spend, tokens, and model breakdown", async () => {
  // Record another entry with Groq
  await recordAgentTelemetry({
    orgId,
    projectId,
    agentName: "qa-agent",
    modelProvider: "groq",
    modelName: "openai/gpt-oss-120b",
    inputTokens: 50_000,
    outputTokens: 20_000,
    durationMs: 420,
    status: "success",
  });

  const summary = await getAgentTelemetrySummary(owner, projectId);

  expect(summary.projectId).toBe(projectId);
  expect(summary.totalExecutions).toBeGreaterThanOrEqual(2);
  expect(summary.totalTokens).toBeGreaterThanOrEqual(85_000);
  expect(Number.parseFloat(summary.totalEstimatedCostUsd)).toBeGreaterThan(0);

  // Model breakdowns
  expect(summary.byModel["claude-haiku-4-5-20251001"]).toBeDefined();
  expect(summary.byModel["openai/gpt-oss-120b"]).toBeDefined();

  // Provider breakdowns
  expect(summary.byProvider.anthropic).toBeDefined();
  expect(summary.byProvider.groq).toBeDefined();

  // Agent breakdowns
  expect(summary.byAgent["builder-agent"]).toBeDefined();
  expect(summary.byAgent["qa-agent"]).toBeDefined();

  // Recent timeline
  expect(summary.recentExecutions.length).toBeGreaterThan(0);
});

test("Phase 3.9: Outsiders cannot access project AI telemetry", async () => {
  await expect(getAgentTelemetrySummary(outsider, projectId)).rejects.toThrow();
});

test("a model with no platform price (their own key) is recorded with zero cost, never a guessed one", async () => {
  const t = await recordAgentTelemetry({
    orgId,
    projectId,
    modelProvider: "openai",
    modelName: "some-model-on-their-key",
    keySource: "org",
    purpose: "review",
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    durationMs: 1,
  });
  expect(t.estimatedCostUsd).toBe("0.000000");
  expect(t).toMatchObject({ keySource: "org", purpose: "review" });
});
