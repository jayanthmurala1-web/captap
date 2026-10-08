import { afterAll, beforeAll, expect, test } from "vitest";
import { addProjectMember, createProject } from "./projects";
import { claimTask, createTasks, submitTask } from "./tasks";
import { fixtures } from "./test-fixtures";
import {
  getTaskWorktree,
  listProjectWorktrees,
  provisionTaskWorktree,
  pruneTaskWorktree,
  synthesizeTaskPullRequest,
  verifyTaskBranchState,
} from "./worktree";

const f = fixtures();

let owner: string;
let dev: string;
let outsider: string;
let orgId: string;
let projectId: string;
let taskId: string;

beforeAll(async () => {
  owner = await f.user("wt-owner");
  dev = await f.user("wt-dev");
  outsider = await f.user("wt-outsider");

  orgId = await f.org("wt-org", {
    [owner]: "owner",
    [dev]: "member",
  });

  const proj = await createProject(owner, orgId, {
    name: "Worktree Project",
    description: "Ensure git worktrees isolate parallel agents",
  });
  projectId = proj.id;

  await addProjectMember(owner, projectId, dev, "developer");

  const created = await createTasks(owner, projectId, [
    {
      ref: "T1",
      title: "Implement OAuth2 Worktree Sandbox",
      description: "Ensure git worktrees isolate parallel agents",
      role: "developer",
    },
  ]);
  taskId = created[0].id;
});

afterAll(async () => {
  await f.cleanup();
});

test("Phase 3.7: provisionTaskWorktree creates isolated worktree sandbox and is idempotent", async () => {
  const result1 = await provisionTaskWorktree(dev, taskId, { baseRef: "main" });

  expect(result1.branch).toMatch(/^task\/t-1-implement-oauth2/);
  expect(result1.worktreePath).toBe(".worktrees/t-1");
  expect(result1.commands.create).toContain(
    "git worktree add .worktrees/t-1 -b",
  );
  expect(result1.commands.checkout).toContain("git checkout -b");
  expect(result1.commands.remove).toBe("git worktree remove .worktrees/t-1");
  expect(result1.worktree.status).toBe("active");

  // Fetch via getTaskWorktree
  const fetched = await getTaskWorktree(dev, taskId);
  expect(fetched).not.toBeNull();
  expect(fetched?.id).toBe(result1.worktree.id);

  // Idempotency: second call returns same record
  const result2 = await provisionTaskWorktree(dev, taskId);
  expect(result2.worktree.id).toBe(result1.worktree.id);

  // List project worktrees
  const list = await listProjectWorktrees(owner, projectId);
  expect(list.length).toBeGreaterThanOrEqual(1);
  expect(list.some((w) => w.taskId === taskId)).toBe(true);
});

test("Phase 3.7: verifyTaskBranchState inspects sandbox readiness and commit state", async () => {
  const stateBefore = await verifyTaskBranchState(dev, taskId);
  expect(stateBefore.taskKey).toBe("T-1");
  expect(stateBefore.status).toBe("active");
  expect(stateBefore.hasCommits).toBe(false);

  // Claim task and submit work
  await claimTask(dev, taskId, "agent-wt-1");
  await submitTask(dev, taskId, "agent-wt-1", {
    summary: "Implemented worktree sandbox isolation",
    filesChanged: ["src/lib/worktree.ts"],
    branch: stateBefore.branch,
    commitSha: "abc1234def5678",
    tests: [
      {
        command: "pnpm test",
        exitCode: 0,
        summary: "All unit tests pass",
      },
    ],
    reviews: [
      {
        skill: "code-review",
        status: "PASS",
        summary: "Clean architecture implementation",
      },
    ],
  });

  const stateAfter = await verifyTaskBranchState(dev, taskId);
  expect(stateAfter.hasCommits).toBe(true);
  expect(stateAfter.commitSha).toBe("abc1234def5678");
  expect(stateAfter.verificationSummary).toContain("Clean commit verified");
});

test("Phase 3.7: synthesizeTaskPullRequest generates complete Markdown with verification and reviews", async () => {
  const pr = await synthesizeTaskPullRequest(dev, taskId);

  expect(pr.title).toBe("[T-1] Implement OAuth2 Worktree Sandbox");
  expect(pr.branch).toMatch(/^task\/t-1/);
  expect(pr.body).toContain("## 🎯 Summary & Architectural Intent");
  expect(pr.body).toContain("## 📐 Architecture Compliance");
  expect(pr.body).toContain("## 🧪 Verification & Evidence");
  expect(pr.body).toContain("pnpm test");
  expect(pr.body).toContain("## 🛡️ Persona Review & Security Checks");
  expect(pr.body).toContain("code-review");
});

test("Phase 3.7: pruneTaskWorktree marks sandbox pruned and returns cleanup command", async () => {
  const pruneRes = await pruneTaskWorktree(dev, taskId);
  expect(pruneRes.success).toBe(true);
  expect(pruneRes.cleanupCommand).toContain(
    "git worktree remove --force .worktrees/t-1",
  );

  const wtAfter = await getTaskWorktree(dev, taskId);
  expect(wtAfter?.status).toBe("pruned");
});

test("Phase 3.7: Outsiders cannot access or mutate project worktrees", async () => {
  await expect(provisionTaskWorktree(outsider, taskId)).rejects.toThrow();
  await expect(getTaskWorktree(outsider, taskId)).rejects.toThrow();
  await expect(pruneTaskWorktree(outsider, taskId)).rejects.toThrow();
  await expect(listProjectWorktrees(outsider, projectId)).rejects.toThrow();
});
