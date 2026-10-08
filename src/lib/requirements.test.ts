import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db } from "@/db";
import { document, documentVersion } from "@/db/schema";
import { createDocument, getDocument, updateDocument } from "./documents";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { addProjectMember, createProject } from "./projects";
import { listRequirements, numberPrdRequirements } from "./requirements";
import {
  claimTask,
  createTasks,
  decideTask,
  getTask,
  submitTask,
  updateTask,
} from "./tasks";
import { fixtures } from "./test-fixtures";

const f = fixtures();
let me: string;
let qa: string;
let outsider: string;
let org: string;
let projectId: string;
let otherProjectId: string;

const evidence = {
  summary: "ok",
  filesChanged: ["a.ts"],
  tests: [{ command: "pnpm test", exitCode: 0, summary: "pass" }],
  reviews: [],
};
const problem = Array(55).fill("word").join(" ");
const prdText = (criteria: string[]) =>
  `## Problem & Context\n${problem}\n\n## Non-Goals\n- Not mobile\n- Not SSO\n\n## Acceptance Criteria\n${criteria.join("\n")}\n`;

beforeAll(async () => {
  me = await f.user("me");
  qa = await f.user("qa");
  outsider = await f.user("out");
  org = await f.org("reqs", { [me]: "owner", [qa]: "member" });
  await f.org("other", { [outsider]: "owner" });
  projectId = (await createProject(me, org, { name: "Checkout" })).id;
  otherProjectId = (await createProject(me, org, { name: "Other" })).id;
  await addProjectMember(me, projectId, qa, "qa");
});

afterAll(() => f.cleanup());

const state = async (prd: string) =>
  Object.fromEntries(
    (await listRequirements(me, prd)).requirements.map((r) => [r.key, r.state]),
  );

test("saving a PRD numbers its acceptance bullets and tracks edits without reusing keys", async () => {
  const doc = await createDocument(me, projectId, {
    title: "Checkout PRD",
    kind: "prd",
    content: prdText(["- Pay by card", "- Get a receipt", "- Refund an order"]),
  });
  const v1 = await getDocument(me, doc.id);
  expect(v1.content).toContain("- R-1: Pay by card");
  expect(await state(doc.id)).toEqual({
    "R-1": "no_task",
    "R-2": "no_task",
    "R-3": "no_task",
  });

  // Reword R-1, delete R-2, add a new one: R-1 keeps its key, R-2 is removed, the new one is R-4 (not R-2).
  await updateDocument(me, doc.id, {
    baseVersion: v1.version,
    content: prdText([
      "- R-3: Refund an order",
      "- R-1: Pay by card or wallet",
      "- Track the parcel",
    ]),
  });
  const list = (await listRequirements(me, doc.id)).requirements;
  expect(list.map((r) => [r.key, r.removed])).toEqual([
    ["R-1", false],
    ["R-2", true],
    ["R-3", false],
    ["R-4", false],
  ]);
  expect(list[0].text).toBe("Pay by card or wallet");
});

test("tasks link to requirements of a PRD in their own project; bad links are refused", async () => {
  const prd = await createDocument(me, projectId, {
    title: "Loyalty PRD",
    kind: "prd",
    content: prdText(["- Earn points", "- Redeem points"]),
  });
  const otherPrd = await createDocument(me, otherProjectId, {
    title: "Elsewhere",
    kind: "prd",
    content: prdText(["- Something"]),
  });
  const note = await createDocument(me, projectId, {
    title: "Notes",
    content: "just notes",
  });

  const [t] = await createTasks(me, projectId, [
    {
      title: "Points engine",
      role: "developer",
      prdDocumentId: prd.id,
      requirementKeys: ["R-1", "R-2"],
    },
  ]);
  const got = await getTask(me, t.id);
  expect(got.prd?.id).toBe(prd.id);
  expect(got.requirements.map((r) => r.key)).toEqual(["R-1", "R-2"]);

  const bad = (extra: object) =>
    createTasks(me, projectId, [{ title: "x", role: "developer", ...extra }]);
  await expect(
    bad({ prdDocumentId: prd.id, requirementKeys: ["R-9"] }),
  ).rejects.toBeInstanceOf(ValidationError);
  await expect(bad({ requirementKeys: ["R-1"] })).rejects.toBeInstanceOf(
    ValidationError,
  ); // keys need a PRD
  await expect(bad({ prdDocumentId: otherPrd.id })).rejects.toBeInstanceOf(
    ValidationError,
  ); // PRD from another project
  await expect(bad({ prdDocumentId: note.id })).rejects.toBeInstanceOf(
    ValidationError,
  ); // not a PRD
});

test("editing links replaces them; moving to another PRD clears the old requirement links", async () => {
  const a = await createDocument(me, projectId, {
    title: "PRD A",
    kind: "prd",
    content: prdText(["- One", "- Two"]),
  });
  const b = await createDocument(me, projectId, {
    title: "PRD B",
    kind: "prd",
    content: prdText(["- Three"]),
  });
  const [t] = await createTasks(me, projectId, [
    {
      title: "T",
      role: "developer",
      prdDocumentId: a.id,
      requirementKeys: ["R-1"],
    },
  ]);
  await updateTask(me, t.id, { requirementKeys: ["R-2"] });
  expect((await getTask(me, t.id)).requirements.map((r) => r.key)).toEqual([
    "R-2",
  ]);

  await updateTask(me, t.id, { prdDocumentId: b.id });
  const moved = await getTask(me, t.id);
  expect(moved.prd?.id).toBe(b.id);
  expect(moved.requirements).toEqual([]);

  await updateTask(me, t.id, { prdDocumentId: null });
  expect((await getTask(me, t.id)).prd).toBeNull();
});

test("requirement state rolls up its tasks: none, not started, in progress, in review, done", async () => {
  const prd = await createDocument(me, projectId, {
    title: "States PRD",
    kind: "prd",
    content: prdText(["- A", "- B", "- C", "- D", "- E"]),
  });
  const mk = async (key: string) =>
    (
      await createTasks(me, projectId, [
        {
          title: `for ${key}`,
          role: "developer",
          prdDocumentId: prd.id,
          requirementKeys: [key],
        },
      ])
    )[0];
  await mk("R-2");
  const c = await mk("R-3");
  const d = await mk("R-4");
  const e = await mk("R-5");
  await claimTask(me, c.id, "dev-1");
  for (const t of [d, e]) {
    await claimTask(me, t.id, "dev-1");
    await submitTask(me, t.id, "dev-1", evidence);
  }
  await decideTask(qa, e.id, "approved");
  expect(await state(prd.id)).toEqual({
    "R-1": "no_task",
    "R-2": "not_started",
    "R-3": "in_progress",
    "R-4": "in_review",
    "R-5": "done",
  });

  // A second, unfinished task on the done requirement pulls it back (worst case wins).
  await createTasks(me, projectId, [
    {
      title: "more E",
      role: "developer",
      prdDocumentId: prd.id,
      requirementKeys: ["R-5"],
    },
  ]);
  expect((await state(prd.id))["R-5"]).toBe("not_started");

  const cov = (await listRequirements(me, prd.id)).counts;
  expect(cov).toEqual({ total: 5, withWork: 4, done: 0 });
});

test("a removed requirement keeps its tasks and says so", async () => {
  const prd = await createDocument(me, projectId, {
    title: "Removal PRD",
    kind: "prd",
    content: prdText(["- Keep", "- Drop"]),
  });
  const [t] = await createTasks(me, projectId, [
    {
      title: "for drop",
      role: "developer",
      prdDocumentId: prd.id,
      requirementKeys: ["R-2"],
    },
  ]);
  const v = await getDocument(me, prd.id);
  await updateDocument(me, prd.id, {
    baseVersion: v.version,
    content: prdText(["- R-1: Keep"]),
  });
  const got = await getTask(me, t.id);
  expect(got.requirements).toMatchObject([{ key: "R-2", removed: true }]);
  const cov = (await listRequirements(me, prd.id)).counts;
  expect(cov.total).toBe(1); // removed ones don't count toward coverage
});

test("a legacy PRD (no keys) is numbered by an explicit versioned save", async () => {
  const [doc] = await db
    .insert(document)
    .values({
      orgId: org,
      projectId,
      kind: "prd",
      docType: "prd",
      title: "Legacy PRD",
      createdBy: me,
    })
    .returning();
  await db.insert(documentVersion).values({
    documentId: doc.id,
    version: 1,
    content: prdText(["- Old bullet one", "- Old bullet two"]),
    authorId: me,
  });
  await db
    .update(document)
    .set({ currentVersion: 1 })
    .where(eq(document.id, doc.id));

  const before = await listRequirements(me, doc.id);
  expect(before.requirements).toEqual([]);
  expect(before.unnumbered).toBe(2);

  await numberPrdRequirements(me, doc.id);
  const after = await listRequirements(me, doc.id);
  expect(after.unnumbered).toBe(0);
  expect(after.requirements.map((r) => r.key)).toEqual(["R-1", "R-2"]);
  expect((await getDocument(me, doc.id)).version).toBe(2);
  // second call is a no-op: no third version
  await numberPrdRequirements(me, doc.id);
  expect((await getDocument(me, doc.id)).version).toBe(2);
});

test("requirements are only visible to members who can see the project", async () => {
  const prd = await createDocument(me, projectId, {
    title: "Private PRD",
    kind: "prd",
    content: prdText(["- Secret"]),
  });
  await expect(listRequirements(outsider, prd.id)).rejects.toBeInstanceOf(
    NotFoundError,
  );
  await expect(numberPrdRequirements(qa, prd.id)).rejects.toBeInstanceOf(
    ForbiddenError,
  ); // qa can't manage documents
});
