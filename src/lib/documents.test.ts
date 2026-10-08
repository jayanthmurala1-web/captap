import { afterAll, beforeAll, expect, test } from "vitest";
import { db } from "@/db";
import { documentApproval } from "@/db/schema";
import {
  createDocument,
  deleteDocument,
  getDeleteImpact,
  getDocument,
  getProjectArchitecture,
  listDocuments,
  listVersions,
  updateDocument,
} from "./documents";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { addProjectMember, createProject } from "./projects";
import { fixtures, validPrd } from "./test-fixtures";

const f = fixtures();
let pm: string;
let admin: string;
let dev: string;
let outsider: string;
let projectId: string;

beforeAll(async () => {
  pm = await f.user("pm");
  admin = await f.user("admin");
  dev = await f.user("dev");
  outsider = await f.user("out");
  const org = await f.org("docs", {
    [pm]: "owner",
    [admin]: "admin",
    [dev]: "member",
  });
  await f.org("other", { [outsider]: "owner" });
  projectId = (await createProject(pm, org, { name: "Marketplace" })).id;
  await addProjectMember(pm, projectId, dev, "developer");
});

afterAll(() => f.cleanup());

test("versions are appended and every past version stays readable", async () => {
  const doc = await createDocument(pm, projectId, {
    title: "Doc",
    kind: "prd",
    docType: "general",
    content: "v1 body",
  });
  await updateDocument(admin, doc.id, {
    content: "v2 body",
    baseVersion: 1,
    note: "client changed payments",
  });

  expect(await getDocument(pm, doc.id)).toMatchObject({
    version: 2,
    content: "v2 body",
  });
  expect(await getDocument(pm, doc.id, 1)).toMatchObject({
    version: 1,
    content: "v1 body",
  });
  expect(
    (await listVersions(pm, doc.id)).map((v) => [v.version, v.note]),
  ).toEqual([
    [2, "client changed payments"],
    [1, null],
  ]);
  await expect(getDocument(pm, doc.id, 9)).rejects.toBeInstanceOf(
    NotFoundError,
  );
});

test("stale base_version is rejected; concurrent saves never both win", async () => {
  const doc = await createDocument(pm, projectId, {
    title: "Race",
    kind: "doc",
    content: "base",
  });
  const results = await Promise.allSettled([
    updateDocument(pm, doc.id, { content: "pm edit", baseVersion: 1 }),
    updateDocument(admin, doc.id, { content: "admin edit", baseVersion: 1 }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  expect(rejected.reason).toBeInstanceOf(ConflictError);
  expect(rejected.reason.message).toContain("latest is 2");
  expect((await getDocument(pm, doc.id)).version).toBe(2);
});

test("outsiders can't see or touch documents; input is validated", async () => {
  const [first] = await listDocuments(pm, projectId);
  await expect(getDocument(outsider, first.id)).rejects.toBeInstanceOf(
    NotFoundError,
  );
  await expect(
    updateDocument(outsider, first.id, { content: "x", baseVersion: 1 }),
  ).rejects.toBeInstanceOf(NotFoundError);
  await expect(listDocuments(outsider, projectId)).rejects.toBeInstanceOf(
    NotFoundError,
  );
  await expect(
    createDocument(pm, projectId, { title: " ", kind: "doc", content: "x" }),
  ).rejects.toBeInstanceOf(ValidationError);
});

test("members can read documents but cannot create or update them", async () => {
  const [first] = await listDocuments(dev, projectId);
  expect(first).toBeDefined();
  await expect(
    createDocument(dev, projectId, {
      title: "Hacked PRD",
      kind: "prd",
      content: "hacked",
    }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  await expect(
    updateDocument(dev, first.id, {
      content: "unauthorized edit",
      baseVersion: 1,
    }),
  ).rejects.toBeInstanceOf(ForbiddenError);
});

test("PRDs are listed first", async () => {
  await createDocument(pm, projectId, {
    title: "PRD",
    kind: "prd",
    content: validPrd,
  });
  expect((await listDocuments(dev, projectId))[0].kind).toBe("prd");
});

test("Phase 3.1: architecture docTypes, work_ledger member creation, and draft isolation", async () => {
  // 1. Admin creates HLD, LLD, and ERD docs
  const hld = await createDocument(pm, projectId, {
    title: "System Architecture HLD",
    docType: "hld",
    content: "## Microservices Architecture\n- Auth Service\n- Task Engine",
  });
  expect(hld.docType).toBe("hld");

  const erd = await createDocument(pm, projectId, {
    title: "Database ERD",
    docType: "erd",
    content: "erDiagram\n  USER ||--o{ TASK : claims",
  });
  expect(erd.docType).toBe("erd");

  // 2. Member/Dev can create work_ledger without needing admin role
  const ledger = await createDocument(dev, projectId, {
    title: "Daily Work Ledger - 2026-09-20",
    docType: "work_ledger",
    content: "Worked on T-1. Implemented auth token validation.",
  });
  expect(ledger.docType).toBe("work_ledger");

  // 3. Draft isolation: PM creates a draft
  const draft = await createDocument(pm, projectId, {
    title: "Confidential Draft Architecture",
    docType: "hld",
    visibility: "draft",
    content: "Top secret upcoming v2 design",
  });
  // Dev cannot load or see the draft
  await expect(getDocument(dev, draft.id)).rejects.toBeInstanceOf(
    NotFoundError,
  );
  const devList = await listDocuments(dev, projectId);
  expect(devList.some((d) => d.id === draft.id)).toBe(false);

  // PM who created it can see it
  const pmList = await listDocuments(pm, projectId);
  expect(pmList.some((d) => d.id === draft.id)).toBe(true);

  // 4. getProjectArchitecture returns the core published specs
  const arch = await getProjectArchitecture(dev, projectId);
  const types = arch.map((a) => a.docType);
  expect(types).toContain("hld");
  expect(types).toContain("erd");
  // Draft should not be in published architecture
  expect(arch.some((a) => a.id === draft.id)).toBe(false);
});

test("a creator can delete their own unapproved document, but never one a client has decided on", async () => {
  // Work-ledger docs are the one kind any project member can create, so `dev` (no
  // manage_documents) is genuinely the creator here — the case the old creator-bypass let through.
  const open = await createDocument(dev, projectId, {
    title: "Ledger, never shared",
    docType: "work_ledger",
    content: "notes",
  });
  expect(await getDeleteImpact(dev, open.id)).toMatchObject({
    canDelete: true,
    approvalCount: 0,
  });
  await deleteDocument(dev, open.id); // fine: nobody has ever approved it

  const signed = await createDocument(dev, projectId, {
    title: "Ledger, client signed",
    docType: "work_ledger",
    content: "notes",
  });
  await db.insert(documentApproval).values({
    documentId: signed.id,
    version: 1,
    decision: "approved",
    approverName: "The Client",
  });

  // Regression: authorship alone used to be enough to destroy a client-approved document AND the
  // approval record itself (it cascades). Now the creator is refused...
  expect(await getDeleteImpact(dev, signed.id)).toMatchObject({
    canDelete: false,
    approvalCount: 1,
  });
  await expect(deleteDocument(dev, signed.id)).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  // ...the document and its approval survive the attempt...
  expect(await getDocument(pm, signed.id)).toMatchObject({ version: 1 });
  // ...and someone holding manage_documents still can, deliberately.
  expect((await getDeleteImpact(admin, signed.id)).canDelete).toBe(true);
  await deleteDocument(admin, signed.id);
});
