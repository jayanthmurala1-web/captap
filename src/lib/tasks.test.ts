import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db } from "@/db";
import { taskSubmission } from "@/db/schema";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { addProjectMember, createProject } from "./projects";
import {
  assignTask,
  claimNextTask,
  claimTask,
  computeTasksHash,
  createTasks,
  decideTask,
  deleteTask,
  type Evidence,
  getTask,
  listTasks,
  releaseTask,
  retractSubmission,
  submitTask,
  updateTask,
} from "./tasks";
import { fixtures } from "./test-fixtures";

const f = fixtures();
let me: string;
let teammate: string;
let outsider: string;
let org: string;

const evidence: Evidence = {
  summary: "Built it",
  filesChanged: ["src/quote.ts"],
  tests: [{ command: "pnpm test", exitCode: 0, summary: "12 passed" }],
  reviews: [{ skill: "code-review", status: "PASS", summary: "ok" }],
};
// teammate is a plain workspace member assigned to each project as QA (a role that can approve).
const newProject = async () => {
  const id = (await createProject(me, org, { name: "P" })).id;
  await addProjectMember(me, id, teammate, "qa");
  return id;
};

beforeAll(async () => {
  me = await f.user("me");
  teammate = await f.user("mate");
  outsider = await f.user("out");
  org = await f.org("tasks", { [me]: "owner", [teammate]: "member" });
  await f.org("other", { [outsider]: "owner" });
});

afterAll(() => f.cleanup());

test("batch create assigns sequential keys and resolves dependency refs; bad refs roll back", async () => {
  const p = await newProject();
  const created = await createTasks(me, p, [
    { ref: "db", title: "Schema", role: "developer" },
    { ref: "api", title: "API", role: "developer", dependsOn: ["db"] },
    { title: "E2E", role: "qa", dependsOn: ["api", "db"] },
  ]);
  expect(created.map((c) => c.key)).toEqual(["T-1", "T-2", "T-3"]);
  expect((await listTasks(me, p)).map((t) => t.blockedBy)).toEqual([
    [],
    ["T-1"],
    ["T-1", "T-2"],
  ]);

  await expect(
    createTasks(me, p, [
      { title: "X", role: "developer", dependsOn: ["later"] },
      { ref: "later", title: "Y", role: "qa" },
    ]),
  ).rejects.toBeInstanceOf(ValidationError);
  await expect(
    createTasks(me, p, [
      { title: "X", role: "developer", assigneeId: outsider },
    ]),
  ).rejects.toBeInstanceOf(ValidationError);
  // Failed batches consumed no numbers; later batches can depend on existing tasks by key.
  const [next] = await createTasks(me, p, [
    { title: "Next", role: "developer", dependsOn: ["t-2"] },
  ]);
  expect(next.key).toBe("T-4");
  expect((await getTask(me, next.id)).dependencies.map((d) => d.key)).toEqual([
    "T-2",
  ]);
});

test("parallel agents never get the same task", async () => {
  const p = await newProject();
  await createTasks(
    me,
    p,
    Array.from({ length: 8 }, (_, i) => ({
      title: `Task ${i}`,
      role: "developer" as const,
    })),
  );
  const claims = await Promise.all(
    Array.from({ length: 10 }, (_, i) => claimNextTask(me, p, `dev-${i}`)),
  );
  const keys = claims.flatMap((c) => (c ? [c.key] : []));
  expect(keys).toHaveLength(8);
  expect(new Set(keys).size).toBe(8);
  expect(claims.filter((c) => c === null)).toHaveLength(2);
});

test("blocked tasks can't be claimed until dependencies are approved", async () => {
  const p = await newProject();
  const [a, b] = await createTasks(me, p, [
    { ref: "a", title: "A", role: "developer" },
    { title: "B", role: "developer", dependsOn: ["a"] },
  ]);
  expect((await claimNextTask(me, p, "dev-1"))?.key).toBe(a.key);
  expect(await claimNextTask(me, p, "dev-2")).toBeNull();
  await expect(claimTask(me, b.id, "dev-2")).rejects.toThrow(/blocked by T-1/);

  await submitTask(me, a.id, "dev-1", evidence);
  expect(await claimNextTask(me, p, "dev-2")).toBeNull(); // in_review is not done
  await decideTask(teammate, a.id, "approved");
  expect((await claimNextTask(me, p, "dev-2"))?.key).toBe(b.key);
});

test("the person who submitted a task cannot approve their own work (ADR-004)", async () => {
  const p = await newProject();
  const [t] = await createTasks(me, p, [
    { title: "Quote API", role: "developer" },
  ]);
  await claimTask(me, t.id, "dev-1");
  await submitTask(me, t.id, "dev-1", evidence);

  await expect(decideTask(me, t.id, "approved")).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  expect((await getTask(me, t.id)).status).toBe("in_review"); // still unapproved

  // Self-rejecting your own work back to yourself is not a bypass; still allowed.
  await decideTask(me, t.id, "rejected", "actually needs more work");
  expect((await getTask(me, t.id)).status).toBe("in_progress");

  // A different human can approve it.
  await submitTask(me, t.id, "dev-1", evidence);
  await decideTask(teammate, t.id, "approved");
  expect((await getTask(me, t.id)).status).toBe("done");
});

test("a blocking review stops approval until overridden with a reason (spec 024)", async () => {
  const p = await newProject();
  const [t] = await createTasks(me, p, [
    { title: "Quote API", role: "developer" },
  ]);
  await claimTask(me, t.id, "dev-1");
  await submitTask(me, t.id, "dev-1", evidence);
  // `blocking` is set by the automated persona review (spec 008), never by the agent's own
  // evidence — simulate that here rather than widening what an agent can self-report.
  // Re-applied before each check below: submitTask fires an async persona review in the
  // background (skipped when GROQ_API_KEY is unset, but not guaranteed to have run yet either
  // way), so the row can't be trusted to still hold this write by the time a later call runs.
  const setBlocking = () =>
    db
      .update(taskSubmission)
      .set({
        reviews: [
          { skill: "code-review", status: "PASS", summary: "ok" },
          {
            skill: "qa-review",
            status: "FAIL",
            summary: "missing auth check",
            blocking: true,
          },
        ],
      })
      .where(eq(taskSubmission.taskId, t.id));

  await setBlocking();
  await expect(decideTask(teammate, t.id, "approved")).rejects.toThrow(
    /Blocked by qa-review/,
  );
  expect((await getTask(me, t.id)).status).toBe("in_review"); // still unapproved

  // Overriding needs a reason, not just the flag.
  await setBlocking();
  await expect(
    decideTask(teammate, t.id, "approved", undefined, {
      overrideBlocking: true,
    }),
  ).rejects.toThrow(ValidationError);

  await setBlocking();
  await decideTask(
    teammate,
    t.id,
    "approved",
    "Known false positive, shipping",
    {
      overrideBlocking: true,
    },
  );
  expect((await getTask(me, t.id)).status).toBe("done");
});

test("submit requires the claiming agent and complete evidence; reject returns work with a note", async () => {
  const p = await newProject();
  const [t] = await createTasks(me, p, [
    { title: "Quote API", role: "developer" },
  ]);
  await claimTask(me, t.id, "dev-1");

  await expect(submitTask(me, t.id, "dev-2", evidence)).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  await expect(
    submitTask(me, t.id, "dev-1", { ...evidence, tests: [] }),
  ).rejects.toBeInstanceOf(ValidationError);
  await expect(decideTask(me, t.id, "approved")).rejects.toBeInstanceOf(
    ConflictError,
  ); // not in review yet

  await submitTask(me, t.id, "dev-1", evidence);
  await expect(decideTask(me, t.id, "rejected")).rejects.toBeInstanceOf(
    ValidationError,
  ); // note required
  await decideTask(me, t.id, "rejected", "Missing validation on quantity");

  const back = await getTask(me, t.id);
  expect(back).toMatchObject({
    status: "in_progress",
    claimedAgent: "dev-1",
    reviewNote: "Missing validation on quantity",
  });
  expect(back.submissions[0].decision).toBe("rejected");

  await submitTask(me, t.id, "dev-1", evidence);
  await decideTask(teammate, t.id, "approved");
  const done = await getTask(me, t.id);
  expect(done.status).toBe("done");
  expect(done.submissions.map((s) => s.decision)).toEqual([
    "approved",
    "rejected",
  ]);
});

test("assigned tasks go to their assignee first; others can't take them", async () => {
  const p = await newProject();
  const [open, mine] = await createTasks(me, p, [
    { title: "Unassigned", role: "developer" },
    { title: "For teammate", role: "developer", assigneeId: teammate },
  ]);
  expect((await claimNextTask(teammate, p, "mate-agent"))?.id).toBe(mine.id);
  await expect(claimTask(me, mine.id, "dev-1")).rejects.toBeInstanceOf(
    ConflictError,
  ); // already claimed
  expect((await claimNextTask(me, p, "dev-1"))?.id).toBe(open.id);
});

test("release: agents only their own; only manage_tasks can force; outsiders see nothing", async () => {
  const p = await newProject();
  const [t] = await createTasks(me, p, [{ title: "Stuck", role: "devops" }]);
  await expect(claimNextTask(me, p, "dev-1", "developer")).resolves.toBeNull(); // role filter
  await claimNextTask(me, p, "ops-1", "devops");

  await expect(releaseTask(me, t.id, "other-agent")).rejects.toBeInstanceOf(
    ConflictError,
  );
  // Regression: a plain project member (QA — can approve, but no manage_tasks) used to be able to
  // force-release anyone's claimed work. They must be refused, and the claim must survive.
  await expect(releaseTask(teammate, t.id, null)).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  expect((await getTask(me, t.id)).status).toBe("in_progress");
  // The owner holds manage_tasks, so the human force-release still works for them.
  await releaseTask(me, t.id, null);
  expect((await getTask(me, t.id)).status).toBe("todo");

  await expect(getTask(outsider, t.id)).rejects.toBeInstanceOf(NotFoundError);
  await expect(releaseTask(outsider, t.id, "agent-1")).rejects.toBeInstanceOf(
    NotFoundError,
  );
  await expect(listTasks(outsider, p)).rejects.toBeInstanceOf(NotFoundError);
});

test("an org member with no role in a project cannot touch its tasks (loadTask isolation)", async () => {
  // Regression: loadTask only checked org membership, so any org member could read, claim,
  // submit or release tasks in projects they were never added to.
  const bystander = await f.user("bystander");
  const iso = await f.org("iso", { [me]: "owner", [bystander]: "member" });
  const pid = (await createProject(me, iso, { name: "Secret" })).id;
  const [t] = await createTasks(me, pid, [
    { title: "Private", role: "developer" },
  ]);

  await expect(getTask(bystander, t.id)).rejects.toBeInstanceOf(NotFoundError);
  await expect(claimTask(bystander, t.id, "dev-1")).rejects.toBeInstanceOf(
    NotFoundError,
  );
  await expect(releaseTask(bystander, t.id, "dev-1")).rejects.toBeInstanceOf(
    NotFoundError,
  );
  // The "T-1" shorthand goes through the same gate, not around it.
  await expect(getTask(bystander, "T-1")).rejects.toBeInstanceOf(NotFoundError);
  // Control: the owner holds access_all_projects and still sees it.
  expect((await getTask(me, t.id)).title).toBe("Private");
});

test("a task pinned to an agent can only be claimed by that agent", async () => {
  const p = await newProject();
  const [t] = await createTasks(me, p, [
    { title: "Pinned", role: "developer", assignedSkill: "code-review" },
  ]);
  await expect(claimTask(me, t.id, "other-agent")).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  // claimNextTask must honor the pin too, not just claimTask.
  await expect(claimNextTask(me, p, "other-agent")).resolves.toBeNull();
  expect((await claimTask(me, t.id, "code-review")).key).toBe(t.key);
});

test("a task being worked or reviewed cannot be deleted; deleting a blocker reports who it unblocks", async () => {
  const p = await newProject();
  const [blocker, dependent] = await createTasks(me, p, [
    { ref: "a", title: "Blocker", role: "developer" },
    { title: "Dependent", role: "developer", dependsOn: ["a"] },
  ]);
  await claimTask(me, blocker.id, "dev-1");
  await expect(deleteTask(me, blocker.id)).rejects.toBeInstanceOf(
    ConflictError,
  );
  await submitTask(me, blocker.id, "dev-1", evidence);
  await expect(deleteTask(me, blocker.id)).rejects.toBeInstanceOf(
    ConflictError,
  );

  await decideTask(teammate, blocker.id, "rejected", "redo it");
  await releaseTask(me, blocker.id, null);
  const res = await deleteTask(me, blocker.id);
  // The dependent silently becomes claimable once its blocker is gone — that must be visible.
  expect(res.unblockedDependents).toEqual([dependent.key]);
});

test("regular members cannot create tasks", async () => {
  const p = await newProject();
  await expect(
    createTasks(teammate, p, [
      { title: "Unauthorized", description: "no", role: "developer" },
    ]),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("admin can assign and reassign tasks; regular members cannot assign", async () => {
  const p = await newProject();
  const [t] = await createTasks(me, p, [
    { title: "Initial Unassigned", role: "developer" },
  ]);
  expect((await getTask(me, t.id)).assigneeId).toBeNull();

  // Admin assigns to teammate
  const assigned = await assignTask(me, t.id, teammate);
  expect(assigned.assigneeId).toBe(teammate);

  // Reassign to null (unassigned)
  const unassigned = await assignTask(me, t.id, null);
  expect(unassigned.assigneeId).toBeNull();

  // Reassign to outsider fails validation
  await expect(assignTask(me, t.id, outsider)).rejects.toBeInstanceOf(
    ValidationError,
  );

  // Regular member cannot reassign
  await expect(assignTask(teammate, t.id, teammate)).rejects.toBeInstanceOf(
    ForbiddenError,
  );
});

test("admin can update task details; regular members cannot update", async () => {
  const p = await newProject();
  const [t] = await createTasks(me, p, [
    { title: "Initial Title", description: "old desc", role: "developer" },
  ]);

  const updated = await updateTask(me, t.id, {
    title: "Phase 2 Title",
    description: "new phase 2 requirements",
    role: "qa",
  });
  expect(updated.title).toBe("Phase 2 Title");
  expect(updated.description).toBe("new phase 2 requirements");
  expect(updated.role).toBe("qa");

  // Regular member cannot update
  await expect(
    updateTask(teammate, t.id, { title: "Hacked" }),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("admin can delete tasks and associated dependencies; regular members cannot delete", async () => {
  const p = await newProject();
  const [a, b] = await createTasks(me, p, [
    { ref: "a", title: "Task A", role: "developer" },
    { title: "Task B", role: "qa", dependsOn: ["a"] },
  ]);

  // Regular member cannot delete
  await expect(deleteTask(teammate, a.id)).rejects.toBeInstanceOf(
    ForbiddenError,
  );

  // Admin deletes Task A
  const res = await deleteTask(me, a.id);
  expect(res.deleted).toBe(true);

  // Task A is now gone
  await expect(getTask(me, a.id)).rejects.toBeInstanceOf(NotFoundError);

  // Task B is no longer blocked by Task A
  const taskB = await getTask(me, b.id);
  expect(taskB.blocked).toBe(false);
  expect(taskB.dependencies).toHaveLength(0);
});

test("resolves tasks by T-key and projects by name", async () => {
  const p = await newProject();
  const [t1] = await createTasks(me, p, [
    { title: "First Task", role: "developer" },
  ]);

  // Can fetch task by "T-1", "T1", or "1"
  const byDashKey = await getTask(me, "T-1");
  expect(byDashKey.id).toBe(t1.id);
  expect(byDashKey.key).toBe("T-1");

  const byDirectKey = await getTask(me, "T1");
  expect(byDirectKey.id).toBe(t1.id);

  const byNumber = await getTask(me, "1");
  expect(byNumber.id).toBe(t1.id);

  // Can list tasks by project name: the name must identify one project, and it must be this one.
  const named = (await createProject(me, org, { name: "Name Lookup Board" }))
    .id;
  const [nt] = await createTasks(me, named, [
    { title: "Named", role: "developer" },
  ]);
  const byName = await listTasks(me, "name lookup board");
  expect(byName.map((t) => t.id)).toEqual([nt.id]);
});

test("computeTasksHash computes deterministic hash and detects state changes", () => {
  expect(computeTasksHash([])).toBe("empty");

  const now = new Date("2026-09-20T12:00:00Z");
  const taskA = {
    id: "task-1",
    status: "todo",
    claimedAgent: null,
    assigneeId: null,
    updatedAt: now,
  };

  const hash1 = computeTasksHash([taskA]);
  expect(typeof hash1).toBe("string");
  expect(hash1).toBe(computeTasksHash([taskA])); // Deterministic

  // Status change produces different hash
  const taskAInProgress = {
    ...taskA,
    status: "in_progress",
    claimedAgent: "agent-alpha",
  };
  const hash2 = computeTasksHash([taskAInProgress]);
  expect(hash2).not.toBe(hash1);

  // Assignee change produces different hash
  const taskAAssigned = { ...taskA, assigneeId: "user-123" };
  const hash3 = computeTasksHash([taskAAssigned]);
  expect(hash3).not.toBe(hash1);
  expect(hash3).not.toBe(hash2);
});

test("a submitter can take back pending work, but nobody else and never after a decision", async () => {
  const p = await newProject();
  const [t] = await createTasks(me, p, [
    { title: "Retractable", role: "developer" },
  ]);
  await claimTask(me, t.id, "dev-1");
  await submitTask(me, t.id, "dev-1", evidence);

  // Someone else (even with approve power) cannot withdraw another person's submission.
  await expect(retractSubmission(teammate, t.id)).rejects.toBeInstanceOf(
    ConflictError,
  );
  // Wrong agent name from the right person is refused too.
  await expect(retractSubmission(me, t.id, "dev-2")).rejects.toBeInstanceOf(
    ConflictError,
  );

  await retractSubmission(me, t.id, "dev-1");
  const back = await getTask(me, t.id);
  expect(back.status).toBe("in_progress");
  expect(back.claimedBy).toBe(me); // still theirs to finish
  expect(back.submissions).toHaveLength(0); // no ghost in the reviewer's queue
  await expect(retractSubmission(me, t.id)).rejects.toBeInstanceOf(
    ConflictError,
  ); // nothing left to retract

  // Once a human has decided, it is too late: the decision stands.
  await submitTask(me, t.id, "dev-1", evidence);
  await decideTask(teammate, t.id, "approved");
  await expect(retractSubmission(me, t.id)).rejects.toBeInstanceOf(
    ConflictError,
  );
  expect((await getTask(me, t.id)).status).toBe("done");
});
