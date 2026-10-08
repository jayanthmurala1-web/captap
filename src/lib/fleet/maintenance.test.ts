import { eq } from "drizzle-orm";
import { beforeAll, expect, test } from "vitest";
import { db } from "@/db";
import { task } from "@/db/schema";
import { createProject } from "../projects";
import { createTasks } from "../tasks";
import { fixtures } from "../test-fixtures";
import { provisionTaskWorktree } from "../worktree";
import { pruneStaleWorktrees, runFleetHealthAudit } from "./maintenance";

const f = fixtures();

let owner: string;
let outsider: string;
let orgId: string;
let projectId: string;

beforeAll(async () => {
  owner = await f.user("maint-owner");
  outsider = await f.user("maint-outsider");
  orgId = await f.org("maint-org", {
    [owner]: "owner",
  });
  const proj = await createProject(owner, orgId, {
    name: "Fleet Maintenance Test Project",
  });
  projectId = proj.id;
});

test("Phase 4.1: pruneStaleWorktrees prunes sandboxes for completed tasks", async () => {
  const [createdTask] = await createTasks(owner, projectId, [
    {
      title: "Completed worktree task",
      role: "developer",
    },
  ]);

  // Provision worktree
  const wt = await provisionTaskWorktree(owner, createdTask.id);
  expect(wt.worktree.status).toBe("active");

  // Mark task as done
  await db
    .update(task)
    .set({ status: "done" })
    .where(eq(task.id, createdTask.id));

  // Run dryRun
  const dry = await pruneStaleWorktrees(owner, projectId, { dryRun: true });
  expect(dry.prunedWorktreeIds).toContain(wt.worktree.id);

  // Run actual prune
  const result = await pruneStaleWorktrees(owner, projectId);
  expect(result.prunedWorktreeIds).toContain(wt.worktree.id);
  expect(result.cleanupCommands.length).toBeGreaterThan(0);
  expect(result.reclaimedDiskSpaceEstMb).toBeGreaterThan(0);
});

test("Phase 4.1: runFleetHealthAudit computes health score, grade, and recommendations", async () => {
  const audit = await runFleetHealthAudit(owner, projectId);

  expect(audit.projectId).toBe(projectId);
  expect(audit.healthGrade).toBeDefined();
  expect(audit.healthScore).toBeGreaterThanOrEqual(10);
  expect(audit.healthScore).toBeLessThanOrEqual(100);
  expect(audit.metrics).toBeDefined();
  expect(audit.recommendations.length).toBeGreaterThan(0);

  // Outsiders cannot audit project
  await expect(runFleetHealthAudit(outsider, projectId)).rejects.toThrow();
});
