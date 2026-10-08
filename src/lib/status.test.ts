import { afterAll, beforeAll, expect, test } from "vitest";
import { createDocument } from "./documents";
import { NotFoundError } from "./errors";
import { addProjectMember, createProject } from "./projects";
import { getProjectStatus } from "./status";
import { claimTask, createTasks, decideTask, submitTask } from "./tasks";
import { fixtures, validPrd } from "./test-fixtures";

const f = fixtures();
let me: string;
let approver: string;
let outsider: string;
let projectId: string;

const evidence = {
  summary: "ok",
  filesChanged: ["a.ts"],
  tests: [{ command: "pnpm test", exitCode: 0, summary: "pass" }],
};

beforeAll(async () => {
  me = await f.user("me");
  approver = await f.user("approver");
  outsider = await f.user("out");
  const org = await f.org("status", { [me]: "owner", [approver]: "member" });
  await f.org("other", { [outsider]: "owner" });
  projectId = (await createProject(me, org, { name: "Resume me" })).id;
  await addProjectMember(me, projectId, approver, "qa");
});

afterAll(() => f.cleanup());

test("classifies review, blocked, sent-back, stale and next-up work", async () => {
  await createDocument(me, projectId, {
    title: "PRD",
    kind: "prd",
    content: validPrd,
    note: "from call",
  });
  const [a, b, c, d, e] = await createTasks(me, projectId, [
    { title: "Approved", role: "developer" },
    { title: "Free dev task", role: "developer" },
    { ref: "c", title: "In review", role: "developer" },
    { title: "Sent back", role: "developer" },
    { title: "Free QA task", role: "qa" },
  ]);
  const [late] = await createTasks(me, projectId, [
    { title: "Blocked", role: "developer", dependsOn: [c.key] },
  ]);

  for (const [t, agent] of [
    [a, "dev-1"],
    [c, "dev-2"],
    [d, "dev-3"],
  ] as const) {
    await claimTask(me, t.id, agent);
    await submitTask(me, t.id, agent, evidence);
  }
  await decideTask(approver, a.id, "approved");
  await decideTask(me, d.id, "rejected", "Handle empty input");

  const later = new Date(Date.now() + 25 * 60 * 60 * 1000); // pretend a day passed
  const s = await getProjectStatus(me, projectId, later);

  expect(s.progress).toMatchObject({
    total: 6,
    done: 1,
    inReview: 1,
    inProgress: 1,
    todo: 3,
    percentDone: 17,
  });
  expect(s.needsReview.map((t) => t.key)).toEqual([c.key]);
  expect(s.blocked).toEqual([
    expect.objectContaining({ key: late.key, blockedBy: [c.key] }),
  ]);
  expect(s.sentBack).toEqual([
    expect.objectContaining({ key: d.key, note: "Handle empty input" }),
  ]);
  expect(s.stale.map((t) => t.key)).toEqual([d.key]);
  expect(s.nextUp.map((t) => t.key)).toEqual([b.key, e.key]);
  expect(s.recentDocumentChanges[0]).toMatchObject({
    title: "PRD",
    version: 1,
    note: "from call",
  });
  expect(s.recentDecisions.map((x) => x.decision)).toEqual(
    expect.arrayContaining(["approved", "rejected"]),
  );
  expect(s.lastActivityAt).toBeInstanceOf(Date);
});

test("outsiders get not-found", async () => {
  await expect(getProjectStatus(outsider, projectId)).rejects.toBeInstanceOf(
    NotFoundError,
  );
});
