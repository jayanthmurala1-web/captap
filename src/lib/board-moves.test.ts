import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db } from "@/db";
import { task } from "@/db/schema";
import { ValidationError } from "./errors";
import { createProject } from "./projects";
import { createTasks, getTask, moveTaskStatus } from "./tasks";
import { fixtures } from "./test-fixtures";

// ADR-004: Done only comes from a human approving submitted evidence. The board must not bypass it.
// (No submitTask here — it fires a real LLM review in the background.)

const f = fixtures();
let owner: string;
let projectId: string;

beforeAll(async () => {
  owner = await f.user("board-owner");
  const org = await f.org("board-moves", { [owner]: "owner" });
  projectId = (await createProject(owner, org, { name: "Board rules" })).id;
});
afterAll(() => f.cleanup());

test("the board moves tasks between To do and In progress only", async () => {
  const [t] = await createTasks(owner, projectId, [
    { title: "Start me", role: "developer" },
  ]);
  expect((await moveTaskStatus(owner, t.id, "in_progress")).status).toBe(
    "in_progress",
  );
  expect((await moveTaskStatus(owner, t.id, "todo")).status).toBe("todo");
});

test("even an owner can't drag a task to Done or In review", async () => {
  const [t] = await createTasks(owner, projectId, [
    { title: "No shortcut", role: "developer" },
  ]);
  await expect(moveTaskStatus(owner, t.id, "done")).rejects.toBeInstanceOf(
    ValidationError,
  );
  await expect(moveTaskStatus(owner, t.id, "in_review")).rejects.toBeInstanceOf(
    ValidationError,
  );
  expect((await getTask(owner, t.id)).status).toBe("todo");
});

test("a task in review can't be moved from the board; it's decided on the task page", async () => {
  const [t] = await createTasks(owner, projectId, [
    { title: "Awaiting review", role: "developer" },
  ]);
  // Put it in review directly (setup only).
  await db.update(task).set({ status: "in_review" }).where(eq(task.id, t.id));
  await expect(
    moveTaskStatus(owner, t.id, "in_progress"),
  ).rejects.toBeInstanceOf(ValidationError);
  await expect(moveTaskStatus(owner, t.id, "todo")).rejects.toBeInstanceOf(
    ValidationError,
  );
  expect((await getTask(owner, t.id)).status).toBe("in_review");
});
