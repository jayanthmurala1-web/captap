import { randomBytes } from "node:crypto";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  document,
  documentApproval,
  documentShare,
  documentVersion,
  organization,
  user,
} from "@/db/schema";
import { requireProjectCapability } from "./access";
import { recordAudit } from "./audit";
import { notifySlack } from "./connections";
import { appLink, clientDecisionEmail, sendEmail } from "./email";
import { NotFoundError, ValidationError } from "./errors";

const approverName = z.string().trim().min(1, "approverName is required");
const note = z.string().trim().min(1, "note is required");

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new ValidationError(r.error.issues.map((i) => i.message).join("; "));
  return r.data;
}

async function loadDocumentForAdmin(userId: string, documentId: string) {
  const [doc] = await db
    .select({
      id: document.id,
      projectId: document.projectId,
      orgId: document.orgId,
      title: document.title,
    })
    .from(document)
    .where(eq(document.id, documentId));
  if (!doc) throw new NotFoundError("Document not found");
  await requireProjectCapability(userId, doc.projectId, "share_with_client");
  return doc;
}

/** Admin generates a revocable, unguessable link a client can open with no account. */
export async function createDocumentShare(userId: string, documentId: string) {
  const doc = await loadDocumentForAdmin(userId, documentId);
  const token = randomBytes(32).toString("hex");
  const [row] = await db
    .insert(documentShare)
    .values({ documentId: doc.id, token, createdBy: userId })
    .returning({ id: documentShare.id, token: documentShare.token });
  await recordAudit(db, {
    orgId: doc.orgId,
    projectId: doc.projectId,
    actorId: userId,
    action: "document.shared",
    targetType: "document",
    targetId: doc.id,
    targetLabel: doc.title,
  });
  return row;
}

export async function revokeDocumentShare(userId: string, shareId: string) {
  const [share] = await db
    .select({ documentId: documentShare.documentId })
    .from(documentShare)
    .where(eq(documentShare.id, shareId));
  if (!share) throw new NotFoundError("Share not found");
  const doc = await loadDocumentForAdmin(userId, share.documentId);
  await db
    .update(documentShare)
    .set({ revokedAt: new Date() })
    .where(eq(documentShare.id, shareId));
  await recordAudit(db, {
    orgId: doc.orgId,
    projectId: doc.projectId,
    actorId: userId,
    action: "document.share_revoked",
    targetType: "document",
    targetId: doc.id,
    targetLabel: doc.title,
  });
}

async function loadActiveShare(token: string) {
  const [share] = await db
    .select({
      documentId: documentShare.documentId,
      createdBy: documentShare.createdBy,
    })
    .from(documentShare)
    .where(
      and(eq(documentShare.token, token), isNull(documentShare.revokedAt)),
    );
  // Same error for "never existed" and "revoked" — don't leak which.
  if (!share) throw new NotFoundError("Link not found or no longer active");
  return share;
}

/** No userId required — this is the client's read, authorized by possessing the token. */
export async function getSharedDocument(token: string) {
  const share = await loadActiveShare(token);
  const [doc] = await db
    .select({
      title: document.title,
      currentVersion: document.currentVersion,
      orgName: organization.name,
    })
    .from(document)
    .innerJoin(organization, eq(organization.id, document.orgId))
    .where(eq(document.id, share.documentId));
  if (!doc) throw new NotFoundError("Link not found or no longer active");

  const [version] = await db
    .select({
      content: documentVersion.content,
      createdAt: documentVersion.createdAt,
    })
    .from(documentVersion)
    .where(
      and(
        eq(documentVersion.documentId, share.documentId),
        eq(documentVersion.version, doc.currentVersion),
      ),
    );

  return {
    documentId: share.documentId,
    title: doc.title,
    orgName: doc.orgName,
    version: doc.currentVersion,
    updatedAt: version?.createdAt ?? null,
    content: version?.content ?? "",
  };
}

/** No userId required. `version` must be the one the client actually saw (from getSharedDocument),
 * not re-derived from "latest" here — the document may have changed since they opened the link. */
export async function submitApproval(
  token: string,
  input: {
    decision: "approved" | "changes_requested";
    approverName: string;
    approverEmail?: string;
    note?: string;
    version: number;
  },
) {
  const share = await loadActiveShare(token);
  const name = validate(approverName, input.approverName);
  const n =
    input.decision === "changes_requested"
      ? validate(note, input.note)
      : input.note?.trim() || undefined;

  // `version` comes from a hidden form field — the approval is the proof, so it must name a real version.
  const [doc] = await db
    .select({
      currentVersion: document.currentVersion,
      orgId: document.orgId,
      projectId: document.projectId,
      title: document.title,
    })
    .from(document)
    .where(eq(document.id, share.documentId));
  if (
    !doc ||
    !Number.isInteger(input.version) ||
    input.version < 1 ||
    input.version > doc.currentVersion
  ) {
    throw new ValidationError("Unknown document version");
  }

  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(documentApproval)
      .values({
        documentId: share.documentId,
        version: input.version,
        decision: input.decision,
        approverName: name,
        approverEmail: input.approverEmail,
        note: n,
      })
      .returning({
        decision: documentApproval.decision,
        version: documentApproval.version,
        approverName: documentApproval.approverName,
        createdAt: documentApproval.createdAt,
      });
    await recordAudit(tx, {
      orgId: doc.orgId,
      projectId: doc.projectId,
      actorId: null,
      actorLabel: name,
      action:
        input.decision === "approved"
          ? "client.approved"
          : "client.changes_requested",
      targetType: "document",
      targetId: share.documentId,
      targetLabel: doc.title,
      detail: { version: input.version, ...(n ? { note: n } : {}) },
    });
    return created;
  });

  // Tell whoever made the link (spec 020), and the team's Slack if connected (spec 023).
  // Both best-effort: the decision is already recorded either way.
  try {
    const [creator] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, share.createdBy));
    if (creator)
      await sendEmail({
        to: creator.email,
        ...clientDecisionEmail({
          decision: input.decision,
          clientName: name,
          documentTitle: doc.title,
          version: input.version,
          note: n,
          link: appLink(`/documents/${share.documentId}`),
        }),
      });
  } catch (e) {
    console.error("could not notify about the client's decision:", e);
  }
  await notifySlack(
    doc.orgId,
    input.decision === "approved"
      ? `✅ ${name} approved "${doc.title}" v${input.version}.`
      : `✏️ ${name} requested changes on "${doc.title}" v${input.version}${n ? `: ${n}` : ""}.`,
  );
  return row;
}

/** Admin-only internal view: the latest client decision, and whether the document has moved on since. */
export async function getApprovalStatus(userId: string, documentId: string) {
  const doc = await loadDocumentForAdmin(userId, documentId);
  const [current] = await db
    .select({ currentVersion: document.currentVersion })
    .from(document)
    .where(eq(document.id, doc.id));

  const [latest] = await db
    .select()
    .from(documentApproval)
    .where(eq(documentApproval.documentId, doc.id))
    .orderBy(desc(documentApproval.createdAt))
    .limit(1);

  return {
    latest: latest ?? null,
    stale: latest ? latest.version < (current?.currentVersion ?? 0) : false,
  };
}

/** Admin view: every document in the project that has been shared, with the client's latest decision. */
export async function listProjectApprovals(userId: string, projectId: string) {
  const { projectId: id } = await requireProjectCapability(
    userId,
    projectId,
    "share_with_client",
  );
  const shared = await db
    .select({
      documentId: document.id,
      title: document.title,
      currentVersion: document.currentVersion,
      totalShares: count(documentShare.id).mapWith(Number),
      // count(col) skips nulls, so this counts revoked shares only.
      revokedShares: count(documentShare.revokedAt).mapWith(Number),
    })
    .from(document)
    .innerJoin(documentShare, eq(documentShare.documentId, document.id))
    .where(eq(document.projectId, id))
    .groupBy(document.id)
    .orderBy(document.title);
  if (shared.length === 0) return [];

  // ponytail: loads every approval for these docs and keeps the newest in JS; use DISTINCT ON if approvals get large.
  const approvals = await db
    .select()
    .from(documentApproval)
    .where(
      inArray(
        documentApproval.documentId,
        shared.map((d) => d.documentId),
      ),
    )
    .orderBy(desc(documentApproval.createdAt));

  return shared.map(({ totalShares, revokedShares, ...d }) => {
    const latest = approvals.find((a) => a.documentId === d.documentId) ?? null;
    return {
      ...d,
      activeShares: totalShares - revokedShares,
      latest,
      stale: latest ? latest.version < d.currentVersion : false,
    };
  });
}

/** Admin view: the document's live share links, so they can be re-copied or revoked later. */
export async function listDocumentShares(userId: string, documentId: string) {
  const doc = await loadDocumentForAdmin(userId, documentId);
  return db
    .select({
      id: documentShare.id,
      token: documentShare.token,
      createdAt: documentShare.createdAt,
    })
    .from(documentShare)
    .where(
      and(
        eq(documentShare.documentId, doc.id),
        isNull(documentShare.revokedAt),
      ),
    )
    .orderBy(desc(documentShare.createdAt));
}
