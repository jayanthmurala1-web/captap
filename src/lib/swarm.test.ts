import { afterAll, beforeAll, expect, test } from "vitest";
import { addProjectMember, createProject } from "./projects";
import {
  claimNextSpecialistTask,
  getSwarmPipeline,
  handoffTaskToSpecialist,
  listTaskHandoffs,
} from "./swarm";
import { createTasks } from "./tasks";
import { fixtures } from "./test-fixtures";

const f = fixtures();

let owner: string;
let dev: string;
let qa: string;
let orgId: string;
let projectId: string;

beforeAll(async () => {
  owner = await f.user("swarm-owner");
  dev = await f.user("swarm-dev");
  qa = await f.user("swarm-qa");

  orgId = await f.org("swarm-corp", {
    [owner]: "owner",
    [dev]: "member",
    [qa]: "member",
  });

  const proj = await createProject(owner, orgId, {
    name: "Swarm Orchestration Project",
    description: "Testing multi-agent swarm handoffs and specialist pipeline",
  });
  projectId = proj.id;

  await addProjectMember(owner, projectId, dev, "developer");
  await addProjectMember(owner, projectId, qa, "qa");
});

afterAll(async () => {
  await f.cleanup();
});

test("claimNextSpecialistTask routes work based on agent role", async () => {
  // Create tasks with different roles
  await createTasks(owner, projectId, [
    { title: "Implement Auth Flow", role: "developer" },
    { title: "E2E Integration Test Suite", role: "qa" },
  ]);

  // Dev claims developer task
  const devTask = await claimNextSpecialistTask(
    dev,
    projectId,
    "agent-builder",
    "developer",
  );
  expect(devTask).toBeDefined();
  expect(devTask?.role).toBe("developer");
  expect(devTask?.title).toBe("Implement Auth Flow");

  // QA claims QA task
  const qaTask = await claimNextSpecialistTask(
    qa,
    projectId,
    "agent-tester",
    "qa",
  );
  expect(qaTask).toBeDefined();
  expect(qaTask?.role).toBe("qa");
  expect(qaTask?.title).toBe("E2E Integration Test Suite");
});

test("handoffTaskToSpecialist executes Builder -> QA -> Reviewer -> Human pipeline", async () => {
  // Create single task starting in developer role
  const [initialTask] = await createTasks(owner, projectId, [
    { title: "Multi-Agent Pipeline Feature", role: "developer" },
  ]);

  // Stage 1: Builder claims and implements
  const claimedByBuilder = await claimNextSpecialistTask(
    dev,
    projectId,
    "builder-bot",
    "developer",
  );
  expect(claimedByBuilder?.id).toBe(initialTask.id);

  // Stage 1 -> Stage 2 Handoff: Builder hands off to QA
  const handoff1 = await handoffTaskToSpecialist(dev, initialTask.id, {
    fromAgent: "builder-bot",
    toRole: "qa",
    stage: "test",
    note: "Implemented core feature on branch task/T-3. Ready for edge case validation.",
    artifacts: {
      commitSha: "a1b2c3d4e5f67890",
      branch: "task/T-3",
      filesChanged: ["src/lib/swarm.ts", "src/lib/swarm.test.ts"],
    },
  });

  expect(handoff1.handoff.stage).toBe("test");
  expect(handoff1.handoff.fromRole).toBe("developer");
  expect(handoff1.handoff.toRole).toBe("qa");
  expect(handoff1.task.role).toBe("qa");
  expect(handoff1.task.status).toBe("todo");
  expect(handoff1.task.claimedAgent).toBeNull();

  // Stage 2: QA claims the handed-off task
  const claimedByQA = await claimNextSpecialistTask(
    qa,
    projectId,
    "tester-bot",
    "qa",
  );
  expect(claimedByQA?.id).toBe(initialTask.id);
  expect(claimedByQA?.claimedAgent).toBe("tester-bot");

  // Stage 2 -> Stage 3 Handoff: QA hands off to Reviewer / Security
  const handoff2 = await handoffTaskToSpecialist(qa, initialTask.id, {
    fromAgent: "tester-bot",
    toRole: "devops",
    stage: "review",
    note: "All unit and integration tests passed. 94% coverage. Ready for security review.",
    artifacts: {
      testResults: [
        {
          command: "pnpm test",
          exitCode: 0,
          summary: "14 tests passed, 0 failures",
        },
      ],
    },
  });

  expect(handoff2.handoff.stage).toBe("review");
  expect(handoff2.task.role).toBe("devops");

  // Stage 3 -> Stage 4 Handoff: Reviewer hands off to Approval (moves to in_review for human)
  const handoff3 = await handoffTaskToSpecialist(owner, initialTask.id, {
    fromAgent: "reviewer-bot",
    toRole: "product",
    stage: "approval",
    note: "Persona review gate PASS. No security vulnerabilities detected. Ready for human sign-off.",
    artifacts: {
      reviewFindings: [],
    },
  });

  expect(handoff3.handoff.stage).toBe("approval");
  expect(handoff3.task.status).toBe("in_review");

  // Verify chronological history
  const history = await listTaskHandoffs(owner, initialTask.id);
  expect(history.length).toBe(3);
  expect(history[0].stage).toBe("test");
  expect(history[1].stage).toBe("review");
  expect(history[2].stage).toBe("approval");
});

test("getSwarmPipeline aggregates pipeline throughput and active stages", async () => {
  const pipeline = await getSwarmPipeline(owner, projectId);
  expect(pipeline.projectId).toBe(projectId);
  expect(pipeline.stages.build).toBeDefined();
  expect(pipeline.stages.test).toBeDefined();
  expect(pipeline.stages.review).toBeDefined();
  expect(pipeline.stages.approval).toBeDefined();
  expect(pipeline.recentHandoffs.length).toBeGreaterThanOrEqual(1);
});
