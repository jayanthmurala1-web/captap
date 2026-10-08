import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db } from "@/db";
import { task } from "@/db/schema";
import { ConflictError } from "./errors";
import { figmaEmbedFromContent } from "./figma";
import { createProject } from "./projects";
import {
  createTasks,
  getTask,
  listTasks,
  moveTaskStatus,
  updateTask,
} from "./tasks";
import { fixtures } from "./test-fixtures";

const f = fixtures();
let me: string;
let org: string;

beforeAll(async () => {
  me = await f.user("me");
  org = await f.org("figma-dag", { [me]: "owner" });
});

afterAll(() => f.cleanup());

test("figmaEmbedFromContent embeds the first Figma link in a document, and nothing else", () => {
  const designUrl =
    "https://www.figma.com/design/LKQ4FJ4bTnCSjedbRpk931/Sample-Mobile-Wireframe?node-id=0-1";
  const embed = figmaEmbedFromContent(`## Design

Mockups: ${designUrl}

More text.`);
  expect(embed).toBe(
    `https://www.figma.com/embed?embed_host=captap&url=${encodeURIComponent(designUrl)}`,
  );

  const protoUrl =
    "https://www.figma.com/proto/LKQ4FJ4bTnCSjedbRpk931/Sample-Prototype?scaling=scale-down";
  expect(figmaEmbedFromContent(`[prototype](${protoUrl})`)).toContain(
    encodeURIComponent(protoUrl),
  );

  expect(figmaEmbedFromContent("https://example.com/not-figma")).toBeNull();
  expect(figmaEmbedFromContent("")).toBeNull();
  expect(
    figmaEmbedFromContent("figma.com/design/abc without scheme"),
  ).toBeNull();
});

test("Phase 3.1 & 3.2: Tasks support storyPoints and enforce DAG dependency blocking", async () => {
  const p = (await createProject(me, org, { name: "DAG Sprint" })).id;

  // Create tasks with storyPoints and dependencies: T-1 (3 pts) -> T-2 (5 pts, depends on T-1)
  const created = await createTasks(me, p, [
    {
      ref: "t1",
      title: "Core Schema Migration",
      role: "developer",
      storyPoints: 3,
    },
    {
      ref: "t2",
      title: "API Endpoint Execution",
      role: "developer",
      storyPoints: 5,
      dependsOn: ["t1"],
    },
  ]);

  expect(created).toHaveLength(2);

  const t1 = await getTask(me, created[0].id);
  const t2 = await getTask(me, created[1].id);

  expect(t1.storyPoints).toBe(3);
  expect(t2.storyPoints).toBe(5);

  // Update storyPoints on T-2 to 8 pts
  const updatedT2 = await updateTask(me, t2.id, { storyPoints: 8 });
  expect(updatedT2.storyPoints).toBe(8);

  // Verify listTasks includes storyPoints and blockedBy
  const allTasks = await listTasks(me, p);
  const listedT2 = allTasks.find((t) => t.id === t2.id);
  expect(listedT2?.storyPoints).toBe(8);
  expect(listedT2?.blockedBy).toContain("T-1");

  // Phase 3.2: Attempting to move T-2 to in_progress while T-1 is in todo must be BLOCKED!
  await expect(moveTaskStatus(me, t2.id, "in_progress")).rejects.toBeInstanceOf(
    ConflictError,
  );

  // Complete T-1
  // Setup: mark done directly (Done normally comes from approving a submission).
  await db.update(task).set({ status: "done" }).where(eq(task.id, t1.id));
  const completedT1 = await getTask(me, t1.id);
  expect(completedT1.status).toBe("done");

  // Now T-2 is unblocked! Moving T-2 to in_progress succeeds
  const startedT2 = await moveTaskStatus(me, t2.id, "in_progress");
  expect(startedT2.status).toBe("in_progress");
});
