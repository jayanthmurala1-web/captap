import { afterAll, beforeAll, expect, test } from "vitest";
import { createDocument } from "./documents";
import { addProjectMember, createProject } from "./projects";
import { claimTask, createTasks, decideTask, submitTask } from "./tasks";
import { getProjectTelemetry } from "./telemetry";
import { fixtures, validPrd } from "./test-fixtures";

const f = fixtures();

let owner: string;
let dev: string;
let orgId: string;
let projectId: string;

beforeAll(async () => {
  owner = await f.user("telemetry-owner");
  dev = await f.user("telemetry-dev");

  orgId = await f.org("telemetry-org", {
    [owner]: "owner",
    [dev]: "member",
  });

  const proj = await createProject(owner, orgId, {
    name: "Telemetry Test Project",
    description: "Testing executive health matrix and telemetry analytics",
  });
  projectId = proj.id;

  await addProjectMember(owner, projectId, dev, "developer");
});

afterAll(async () => {
  await f.cleanup();
});

test("Architecture Readiness Score reflects document publication states", async () => {
  // Initial state: no docs
  const t0 = await getProjectTelemetry(owner, projectId);
  expect(t0.readiness.score).toBe(0);
  expect(t0.readiness.gateStatus).toBe("blocked");

  // Add draft PRD (weight 35 * 0.5 = 18 rounded)
  await createDocument(owner, projectId, {
    title: "Draft PRD",
    kind: "doc",
    docType: "prd",
    visibility: "draft",
    content: validPrd,
  });

  const t1 = await getProjectTelemetry(owner, projectId);
  expect(t1.readiness.score).toBe(18);

  // Publish PRD (weight 35) and add Published Brief (weight 15) -> 50%
  await createDocument(owner, projectId, {
    title: "Official PRD",
    kind: "doc",
    docType: "prd",
    visibility: "published",
    content: validPrd,
  });

  await createDocument(owner, projectId, {
    title: "Project Brief",
    kind: "doc",
    docType: "brief",
    visibility: "published",
    content: "# Brief",
  });

  const t2 = await getProjectTelemetry(owner, projectId);
  expect(t2.readiness.score).toBe(50);
  expect(t2.readiness.gateStatus).toBe("partial");

  // Publish HLD (20), LLD (15), and ERD (15) -> 100%
  await createDocument(owner, projectId, {
    title: "High Level Design",
    kind: "doc",
    docType: "hld",
    visibility: "published",
    content: "# HLD",
  });
  await createDocument(owner, projectId, {
    title: "Low Level Design",
    kind: "doc",
    docType: "lld",
    visibility: "published",
    content: "# LLD",
  });
  await createDocument(owner, projectId, {
    title: "Database ERD",
    kind: "doc",
    docType: "erd",
    visibility: "published",
    content: "erDiagram",
  });

  const t3 = await getProjectTelemetry(owner, projectId);
  expect(t3.readiness.score).toBe(100);
  expect(t3.readiness.gateStatus).toBe("ready");
});

test("Dependency Bottleneck Heatmap calculates transitive blocked tasks", async () => {
  // Create chain: Task 1 -> Task 2 -> Task 3
  const [t1] = await createTasks(owner, projectId, [
    { ref: "core", title: "Core DB Engine", role: "developer" },
    {
      ref: "api",
      title: "API Service Layer",
      role: "developer",
      dependsOn: ["core"],
    },
    {
      ref: "ui",
      title: "Frontend Dashboard",
      role: "developer",
      dependsOn: ["api"],
    },
  ]);

  const telemetry = await getProjectTelemetry(owner, projectId);
  expect(telemetry.dependencies.criticalPathDepth).toBeGreaterThanOrEqual(2);

  const coreBottleneck = telemetry.dependencies.bottlenecks.find(
    (b) => b.taskId === t1.id,
  );
  expect(coreBottleneck).toBeDefined();
  expect(coreBottleneck?.directDependentsCount).toBe(1);
  expect(coreBottleneck?.totalTransitiveBlockedCount).toBe(2);
});

test("Agent Autonomy Index tracks first-pass vs rework cycles", async () => {
  // Create a separate task for autonomy tracking
  const [task] = await createTasks(owner, projectId, [
    { title: "Autonomous Feature Implementation", role: "developer" },
  ]);

  // Dev claims and submits
  await claimTask(dev, task.id, "agent-builder");
  await submitTask(dev, task.id, "agent-builder", {
    summary: "Implemented initial feature",
    filesChanged: ["src/lib/feature.ts"],
    tests: [{ command: "pnpm test", exitCode: 0, summary: "Passed 5 tests" }],
  });

  // Human rejects with note (rework required)
  await decideTask(
    owner,
    task.id,
    "rejected",
    "Please add edge case error handling",
  );

  const telemetryAfterRejection = await getProjectTelemetry(owner, projectId);
  expect(
    telemetryAfterRejection.autonomy.reworkSubmissionsCount,
  ).toBeGreaterThanOrEqual(1);

  // Dev re-claims and re-submits
  await submitTask(dev, task.id, "agent-builder", {
    summary: "Added edge case error handling",
    filesChanged: ["src/lib/feature.ts", "src/lib/feature.test.ts"],
    tests: [{ command: "pnpm test", exitCode: 0, summary: "Passed 7 tests" }],
  });

  // Human approves
  await decideTask(owner, task.id, "approved");

  const finalTelemetry = await getProjectTelemetry(owner, projectId);
  expect(finalTelemetry.autonomy.totalDecidedTasks).toBeGreaterThan(0);
  expect(finalTelemetry.autonomy.agentPerformance.length).toBeGreaterThan(0);
});
