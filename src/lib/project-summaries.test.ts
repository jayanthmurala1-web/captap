import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db } from "@/db";
import { task } from "@/db/schema";
import { createProject, listProjectSummaries } from "./projects";
import { createTasks } from "./tasks";
import { fixtures } from "./test-fixtures";

// Portfolio view for the projects home: progress and what needs a person, per project.
const f = fixtures();
let owner: string;
let outsider: string;
let org: string;
let busy: string;

beforeAll(async () => {
  owner = await f.user("sum-owner");
  outsider = await f.user("sum-out");
  org = await f.org("summaries", { [owner]: "owner" });
  await f.org("summaries-other", { [outsider]: "owner" });
  busy = (await createProject(owner, org, { name: "Busy" })).id;
  await createProject(owner, org, { name: "Empty" });
  const ts = await createTasks(owner, busy, [
    { title: "a", role: "developer" },
    { title: "b", role: "developer" },
    { title: "c", role: "developer" },
    { title: "d", role: "developer" },
  ]);
  // Setup only: statuses set directly (no submitTask — it triggers a live LLM review).
  await db.update(task).set({ status: "done" }).where(eq(task.id, ts[0].id));
  await db
    .update(task)
    .set({ status: "in_review" })
    .where(eq(task.id, ts[1].id));
  await db
    .update(task)
    .set({ status: "in_progress" })
    .where(eq(task.id, ts[2].id));
});

afterAll(() => f.cleanup());

test("per-project counts, percent done and review queue", async () => {
  const rows = await listProjectSummaries(owner, org);
  const b = rows.find((r) => r.name === "Busy");
  const e = rows.find((r) => r.name === "Empty");
  expect(b).toMatchObject({
    total: 4,
    done: 1,
    inReview: 1,
    inProgress: 1,
    percentDone: 25,
  });
  expect(b?.lastActivity).toBeInstanceOf(Date);
  expect(e).toMatchObject({
    total: 0,
    done: 0,
    inReview: 0,
    percentDone: 0,
    lastActivity: null,
  });
});

test("only projects the user can see", async () => {
  expect(await listProjectSummaries(outsider, org)).toEqual([]);
});
