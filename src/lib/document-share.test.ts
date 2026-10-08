import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createDocumentShare,
  getApprovalStatus,
  getSharedDocument,
  listDocumentShares,
  listProjectApprovals,
  revokeDocumentShare,
  submitApproval,
} from "./document-share";
import { createDocument, updateDocument } from "./documents";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { addProjectMember, createProject } from "./projects";
import { fixtures, validPrd } from "./test-fixtures";

const f = fixtures();
let admin: string;
let dev: string;
let outsider: string;
let orgId: string;
let projectId: string;
let documentId: string;

beforeAll(async () => {
  admin = await f.user("share-admin");
  dev = await f.user("share-dev");
  outsider = await f.user("share-out");
  orgId = await f.org("share", { [admin]: "owner", [dev]: "member" });
  await f.org("share-other", { [outsider]: "owner" });
  projectId = (await createProject(admin, orgId, { name: "Shoe Co" })).id;
  await addProjectMember(admin, projectId, dev, "developer");
  const doc = await createDocument(admin, projectId, {
    title: "Checkout PRD",
    kind: "prd",
    content: validPrd,
  });
  documentId = doc.id;
});

afterAll(() => f.cleanup());

test("client with a valid token can read the document with no userId", async () => {
  const share = await createDocumentShare(admin, documentId);
  const shared = await getSharedDocument(share.token);
  expect(shared.title).toBe("Checkout PRD");
  expect(shared.content).toContain("Problem & Context");
  // The client needs to see who is asking and when this version was written.
  expect(shared.orgName).toBe(orgId);
  expect(shared.updatedAt).toBeInstanceOf(Date);
});

test("an invalid token and a revoked token both 404 identically", async () => {
  await expect(getSharedDocument("not-a-real-token")).rejects.toBeInstanceOf(
    NotFoundError,
  );

  const share = await createDocumentShare(admin, documentId);
  await revokeDocumentShare(admin, share.id);
  await expect(getSharedDocument(share.token)).rejects.toBeInstanceOf(
    NotFoundError,
  );
});

test("approving requires no note; requesting changes requires one", async () => {
  const share = await createDocumentShare(admin, documentId);
  const shared = await getSharedDocument(share.token);

  await submitApproval(share.token, {
    decision: "approved",
    approverName: "Jamie the Client",
    version: shared.version,
  });

  const share2 = await createDocumentShare(admin, documentId);
  const shared2 = await getSharedDocument(share2.token);
  await expect(
    submitApproval(share2.token, {
      decision: "changes_requested",
      approverName: "Jamie the Client",
      version: shared2.version,
    }),
  ).rejects.toBeInstanceOf(ValidationError);

  await submitApproval(share2.token, {
    decision: "changes_requested",
    approverName: "Jamie the Client",
    version: shared2.version,
    note: "Please use Stripe, not PayPal.",
  });
});

test("approval is pinned to the version the client actually saw, not the latest at submit time", async () => {
  const share = await createDocumentShare(admin, documentId);
  const shared = await getSharedDocument(share.token);
  const seenVersion = shared.version;

  // Document changes after the client fetched it but before they submit.
  await updateDocument(admin, documentId, {
    content: `${validPrd}\n\n(edited after client viewed it)`,
    baseVersion: seenVersion,
  });

  await submitApproval(share.token, {
    decision: "approved",
    approverName: "Jamie the Client",
    version: seenVersion,
  });

  const status = await getApprovalStatus(admin, documentId);
  expect(status.latest?.version).toBe(seenVersion);
  expect(status.stale).toBe(true);
});

test("a client can't record approval of a version that doesn't exist", async () => {
  const share = await createDocumentShare(admin, documentId);
  const { version } = await getSharedDocument(share.token);
  for (const bogus of [0, version + 1, 1.5]) {
    await expect(
      submitApproval(share.token, {
        decision: "approved",
        approverName: "Jamie",
        version: bogus,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  }
  // The receipt shows exactly what was recorded.
  const receipt = await submitApproval(share.token, {
    decision: "approved",
    approverName: "Jamie",
    version,
  });
  expect(receipt).toMatchObject({ decision: "approved", version });
  expect(receipt.createdAt).toBeInstanceOf(Date);
});

test("only an org admin can create/revoke shares or check approval status", async () => {
  await expect(createDocumentShare(dev, documentId)).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  await expect(getApprovalStatus(dev, documentId)).rejects.toBeInstanceOf(
    ForbiddenError,
  );

  const share = await createDocumentShare(admin, documentId);
  await expect(revokeDocumentShare(dev, share.id)).rejects.toBeInstanceOf(
    ForbiddenError,
  );
});

test("a user from a different org cannot touch this document's shares", async () => {
  await expect(
    createDocumentShare(outsider, documentId),
  ).rejects.toBeInstanceOf(NotFoundError);
  await expect(getApprovalStatus(outsider, documentId)).rejects.toBeInstanceOf(
    NotFoundError,
  );
});

test("listProjectApprovals: shared docs with their latest client decision, admin-only", async () => {
  // A doc that was never shared doesn't appear.
  await createDocument(admin, projectId, {
    title: "Internal notes",
    kind: "doc",
    content: "not for the client",
  });
  const rows = await listProjectApprovals(admin, projectId);
  expect(rows.map((r) => r.title)).toEqual(["Checkout PRD"]);
  const [row] = rows;
  expect(row.documentId).toBe(documentId);
  expect(row.activeShares).toBeGreaterThan(0);
  expect(row.latest?.decision).toBe("approved");
  // The previous test approved the current version, so it isn't stale.
  expect(row.stale).toBe(false);

  await expect(listProjectApprovals(dev, projectId)).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  await expect(
    listProjectApprovals(outsider, projectId),
  ).rejects.toBeInstanceOf(NotFoundError);
});

test("listDocumentShares: active links only, newest first, admin-only", async () => {
  const kept = await createDocumentShare(admin, documentId);
  const revoked = await createDocumentShare(admin, documentId);
  await revokeDocumentShare(admin, revoked.id);

  const shares = await listDocumentShares(admin, documentId);
  const ids = shares.map((s) => s.id);
  expect(ids).toContain(kept.id);
  expect(ids).not.toContain(revoked.id);
  expect(shares[0].id).toBe(kept.id);
  expect(shares[0].token).toBe(kept.token);

  await expect(listDocumentShares(dev, documentId)).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  await expect(listDocumentShares(outsider, documentId)).rejects.toBeInstanceOf(
    NotFoundError,
  );
});
