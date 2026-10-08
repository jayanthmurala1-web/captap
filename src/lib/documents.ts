import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  type DocType,
  type DocVisibility,
  document,
  documentApproval,
  documentVersion,
  project,
  requirement,
  task,
  taskRequirement,
  user,
} from "@/db/schema";
import {
  capabilitiesOf,
  isUuid,
  requireMember,
  requireProject,
  requireProjectCapability,
} from "./access";
import { recordAudit } from "./audit";
import { syncRequirements } from "./documents/sync-requirements";
import { validatePrdStructure } from "./documents/validator";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

export type DocumentKind = (typeof document.$inferSelect)["kind"];
export type { DocType, DocVisibility };

const MAX_CONTENT_BYTES = 500_000;
const title = z
  .string()
  .trim()
  .min(1, "title is required")
  .max(200, "title: max 200 characters");
const note = z.string().trim().max(500, "note: max 500 characters").optional();

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new ValidationError(r.error.issues.map((i) => i.message).join("; "));
  return r.data;
}

function checkContent(content: string) {
  if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) {
    throw new ValidationError("content is larger than 500 KB");
  }
}

/** Loads a document header after proving the caller is a member of its org and has visibility. */
async function load(userId: string, documentId: string) {
  if (!isUuid(documentId)) throw new NotFoundError("Document not found");
  const [row] = await db
    .select()
    .from(document)
    .where(eq(document.id, documentId));
  if (!row) throw new NotFoundError("Document not found");
  await requireMember(userId, row.orgId).catch(() => {
    throw new NotFoundError("Document not found"); // don't reveal it exists
  });

  // Drafts are only visible to their creator
  if (row.visibility === "draft" && row.createdBy !== userId) {
    throw new NotFoundError("Document not found");
  }
  return row;
}

export async function listDocuments(
  userId: string,
  projectId: string,
  filters?: { docType?: DocType; visibility?: DocVisibility },
) {
  const p = await requireProject(userId, projectId);
  const conditions = [
    eq(document.projectId, p.projectId),
    or(eq(document.visibility, "published"), eq(document.createdBy, userId)),
  ];

  if (filters?.docType) {
    conditions.push(eq(document.docType, filters.docType));
  }
  if (filters?.visibility) {
    conditions.push(eq(document.visibility, filters.visibility));
  }

  return db
    .select({
      id: document.id,
      title: document.title,
      kind: document.kind,
      docType: document.docType,
      visibility: document.visibility,
      currentVersion: document.currentVersion,
      createdBy: document.createdBy,
      updatedAt: document.updatedAt,
    })
    .from(document)
    .where(and(...conditions))
    .orderBy(document.kind, desc(document.updatedAt));
}

/** Latest version by default, or any past version. */
export async function getDocument(
  userId: string,
  documentId: string,
  version?: number,
) {
  const doc = await load(userId, documentId);
  const v = version ?? doc.currentVersion;
  const [snap] = await db
    .select({
      content: documentVersion.content,
      note: documentVersion.note,
      createdAt: documentVersion.createdAt,
      author: user.name,
    })
    .from(documentVersion)
    .innerJoin(user, eq(user.id, documentVersion.authorId))
    .where(
      and(
        eq(documentVersion.documentId, doc.id),
        eq(documentVersion.version, v),
      ),
    );
  if (!snap)
    throw new NotFoundError(
      `Version ${v} not found (latest is ${doc.currentVersion})`,
    );
  return { ...doc, version: v, ...snap };
}

export async function listVersions(userId: string, documentId: string) {
  const doc = await load(userId, documentId);
  return db
    .select({
      version: documentVersion.version,
      note: documentVersion.note,
      createdAt: documentVersion.createdAt,
      author: user.name,
    })
    .from(documentVersion)
    .innerJoin(user, eq(user.id, documentVersion.authorId))
    .where(eq(documentVersion.documentId, doc.id))
    .orderBy(desc(documentVersion.version));
}

export async function createDocument(
  userId: string,
  projectId: string,
  input: {
    title: string;
    kind?: DocumentKind;
    docType?: DocType;
    visibility?: DocVisibility;
    content: string;
    note?: string;
  },
) {
  // Members can write daily work ledgers; Admins can write all core architecture docs
  const isWorkLedger = input.docType === "work_ledger";
  const { orgId, projectId: resolvedProjectId } = isWorkLedger
    ? await requireProject(userId, projectId)
    : await requireProjectCapability(userId, projectId, "manage_documents");

  const t = validate(title, input.title);
  const n = validate(note, input.note);
  checkContent(input.content);

  const finalDocType: DocType =
    input.docType ?? (input.kind === "prd" ? "prd" : "general");
  const finalKind: DocumentKind =
    input.kind ?? (finalDocType === "prd" ? "prd" : "doc");
  const finalVisibility: DocVisibility = input.visibility ?? "published";
  if (finalDocType === "prd") validatePrdStructure(input.content);

  return db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(document)
      .values({
        orgId,
        projectId: resolvedProjectId,
        kind: finalKind,
        docType: finalDocType,
        visibility: finalVisibility,
        title: t,
        createdBy: userId,
      })
      .returning();
    const content =
      finalDocType === "prd"
        ? await syncRequirements(
            tx,
            { id: doc.id, orgId, projectId: resolvedProjectId },
            input.content,
          )
        : input.content;
    await tx.insert(documentVersion).values({
      documentId: doc.id,
      version: 1,
      content,
      note: n,
      authorId: userId,
    });
    await recordAudit(tx, {
      orgId,
      projectId: resolvedProjectId,
      actorId: userId,
      action: "document.created",
      targetType: "document",
      targetId: doc.id,
      targetLabel: t,
      detail: { version: 1, docType: finalDocType },
    });
    return doc;
  });
}

/**
 * Appends a new version. `baseVersion` must be the version the caller last read;
 * if someone saved since, nothing is written and the caller must re-read and merge.
 */
export async function updateDocument(
  userId: string,
  documentId: string,
  input: {
    content: string;
    baseVersion: number;
    note?: string;
    title?: string;
    docType?: DocType;
    visibility?: DocVisibility;
  },
) {
  const doc = await load(userId, documentId);
  // Author can update their own draft or work_ledger; project admin can update any document
  if (doc.createdBy !== userId) {
    await requireProjectCapability(userId, doc.projectId, "manage_documents");
  }
  const t =
    input.title === undefined ? undefined : validate(title, input.title);
  const n = validate(note, input.note);
  checkContent(input.content);
  const finalDocType = input.docType ?? doc.docType;
  if (finalDocType === "prd") validatePrdStructure(input.content);
  return db.transaction(async (tx) => {
    // Compare-and-swap on current_version: the row lock makes concurrent saves serialize.
    const [bumped] = await tx
      .update(document)
      .set({
        currentVersion: sql`${document.currentVersion} + 1`,
        ...(t && { title: t }),
        ...(input.docType && { docType: input.docType }),
        ...(input.visibility && { visibility: input.visibility }),
      })
      .where(
        and(
          eq(document.id, doc.id),
          eq(document.currentVersion, input.baseVersion),
        ),
      )
      .returning();
    if (!bumped) {
      const [{ current }] = await tx
        .select({ current: document.currentVersion })
        .from(document)
        .where(eq(document.id, doc.id));
      throw new ConflictError(
        `Document changed since version ${input.baseVersion}; latest is ${current}. Re-read it, merge your changes and retry with base_version ${current}.`,
      );
    }
    const content =
      finalDocType === "prd"
        ? await syncRequirements(tx, doc, input.content)
        : input.content;
    await tx.insert(documentVersion).values({
      documentId: doc.id,
      version: bumped.currentVersion,
      content,
      note: n,
      authorId: userId,
    });
    await recordAudit(tx, {
      orgId: doc.orgId,
      projectId: doc.projectId,
      actorId: userId,
      action: "document.updated",
      targetType: "document",
      targetId: doc.id,
      targetLabel: bumped.title,
      detail: { version: bumped.currentVersion, note: n ?? null },
    });
    return bumped;
  });
}

/**
 * Returns the active published architectural documents (Brief, PRD, HLD, LLD, ERD)
 * for an entire project, ideal for injecting into AI agent contexts.
 */
export async function getProjectArchitecture(
  userId: string,
  projectId: string,
) {
  const p = await requireProject(userId, projectId);
  const docs = await listDocuments(userId, p.projectId, {
    visibility: "published",
  });

  const archDocs = docs.filter(
    (d) =>
      [
        "brief",
        "pr_faq",
        "strategy_memo",
        "brd",
        "prd",
        "hld",
        "lld",
        "erd",
      ].includes(d.docType) || d.kind === "prd",
  );

  const results = await Promise.all(
    archDocs.map(async (d) => {
      try {
        const full = await getDocument(userId, d.id);
        return {
          id: d.id,
          title: d.title,
          docType: d.docType,
          kind: d.kind,
          version: full.version,
          content: full.content,
          updatedAt: d.updatedAt,
        };
      } catch {
        return null;
      }
    }),
  );

  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

/**
 * Ensures that a developer/agent has an auto-provisioned work ledger folder & startup document
 * in the project (developer/{name}/work), providing structured daily KT logging.
 */
export async function ensureDeveloperWorkLedger(
  projectId: string,
  targetUserId: string,
) {
  const [targetUser] = await db
    .select({ name: user.name, id: user.id })
    .from(user)
    .where(eq(user.id, targetUserId))
    .limit(1);

  if (!targetUser) return null;

  const userSlug = targetUser.name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const ledgerTitle = `developer/${userSlug}/work`;

  // Check if ledger already exists
  const [existing] = await db
    .select({ id: document.id })
    .from(document)
    .where(
      and(eq(document.projectId, projectId), eq(document.title, ledgerTitle)),
    )
    .limit(1);

  if (existing) {
    return existing;
  }

  const [proj] = await db
    .select({ orgId: project.orgId, name: project.name })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);

  if (!proj) return null;

  const today = new Date().toISOString().split("T")[0];
  const initialContent = `# Developer Work & Knowledge Transfer (KT) Ledger: ${targetUser.name}

> **Project**: ${proj.name}  
> **Assigned Engineer**: ${targetUser.name}  
> **Workspace Path**: \`developer/${userSlug}/work\`  
> **Initialized**: ${today}

---

## 🚀 Daily Startup Checklist
- [ ] Pull latest \`origin/main\` and run tests (\`pnpm test\`).
- [ ] Review assigned atomic tickets in board (\`T-*\`).
- [ ] Create isolated worktree for current task: \`git worktree add .worktrees/T-{key} -b task/T-{key} origin/main\`.
- [ ] Review High-Level & Low-Level Design specifications (\`HLD\` & \`LLD\`).

---

## 📅 Daily Work & KT Log

_No entries yet. Add one each day you work on this project: what you did, what you learned, what the next person needs to know._
`;

  return db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(document)
      .values({
        orgId: proj.orgId,
        projectId,
        kind: "doc",
        docType: "work_ledger",
        visibility: "published",
        title: ledgerTitle,
        createdBy: targetUserId,
      })
      .returning();

    await tx.insert(documentVersion).values({
      documentId: doc.id,
      version: 1,
      content: initialContent,
      note: "Auto-provisioned developer work ledger & startup KT",
      authorId: targetUserId,
    });

    return doc;
  });
}

/**
 * Appends a daily progress / KT entry to the caller's work ledger.
 */
export async function appendDeveloperWorkLedger(
  userId: string,
  projectId: string,
  entry: {
    status?: string;
    focusArea?: string;
    architecturalNotes?: string;
    ktHandoff?: string;
    rawText?: string;
  },
) {
  const p = await requireProject(userId, projectId);
  const ledger = await ensureDeveloperWorkLedger(p.projectId, userId);
  if (!ledger)
    throw new NotFoundError("Failed to resolve developer work ledger");

  const [current] = await db
    .select({
      version: documentVersion.version,
      content: documentVersion.content,
    })
    .from(documentVersion)
    .where(eq(documentVersion.documentId, ledger.id))
    .orderBy(desc(documentVersion.version))
    .limit(1);

  const today = new Date().toISOString().split("T")[0];
  const formattedEntry = entry.rawText
    ? `\n\n### Entry: ${today}\n${entry.rawText}`
    : `\n\n### Entry: ${today}
- **Status**: ${entry.status ?? "In Progress"}
- **Focus Area**: ${entry.focusArea ?? "Ticket Execution"}
- **Architectural Reference**: ${entry.architecturalNotes ?? "Followed approved LLD & ERD"}
- **KT Handoff Notes**: ${entry.ktHandoff ?? "Working copy in isolated branch."}`;

  const newContent = (current?.content ?? "") + formattedEntry;
  const nextVersion = (current?.version ?? 0) + 1;

  return db.transaction(async (tx) => {
    await tx
      .update(document)
      .set({ currentVersion: nextVersion })
      .where(eq(document.id, ledger.id));

    await tx.insert(documentVersion).values({
      documentId: ledger.id,
      version: nextVersion,
      content: newContent,
      note: `Daily KT log: ${today}`,
      authorId: userId,
    });

    return {
      documentId: ledger.id,
      version: nextVersion,
      entryDate: today,
    };
  });
}

/**
 * Deletes all documents of a specific docType in a project.
 */
export async function deleteDocumentsByType(
  userId: string,
  projectId: string,
  docType: string,
) {
  const p = await requireProject(userId, projectId);
  await requireProjectCapability(userId, p.projectId, "manage_documents");

  return db.transaction(async (tx) => {
    const docs = await tx
      .select({ id: document.id })
      .from(document)
      .where(
        and(eq(document.projectId, p.projectId), eq(document.docType, docType)),
      );

    for (const d of docs) {
      await tx
        .delete(documentVersion)
        .where(eq(documentVersion.documentId, d.id));
      await tx.delete(document).where(eq(document.id, d.id));
    }
    if (docs.length)
      await recordAudit(tx, {
        orgId: p.orgId,
        projectId: p.projectId,
        actorId: userId,
        action: "document.deleted",
        targetType: "document",
        targetLabel: `${docs.length} ${docType} document(s)`,
        detail: { docType, count: docs.length },
      });

    return { deletedCount: docs.length };
  });
}

/** How many client decisions exist on this document — deleting it destroys them (cascade). */
async function approvalCount(documentId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documentApproval)
    .where(eq(documentApproval.documentId, documentId));
  return row?.count ?? 0;
}

/** Tasks that would lose their link to this document — either directly (prdDocumentId) or
 * through one of its requirements (taskRequirement). Deleting the document doesn't delete these
 * tasks, it silently unlinks them (prdDocumentId -> null, their requirement rows cascade away). */
async function linkedTaskCount(documentId: string) {
  const [direct, viaRequirement] = await Promise.all([
    db
      .select({ id: task.id })
      .from(task)
      .where(eq(task.prdDocumentId, documentId)),
    db
      .select({ taskId: taskRequirement.taskId })
      .from(taskRequirement)
      .innerJoin(requirement, eq(requirement.id, taskRequirement.requirementId))
      .where(eq(requirement.documentId, documentId)),
  ]);
  const ids = new Set([
    ...direct.map((t) => t.id),
    ...viaRequirement.map((t) => t.taskId),
  ]);
  return ids.size;
}

/**
 * Everything the delete-confirmation UI needs: whether this viewer could actually succeed, and
 * what deleting would destroy. Never throws for permission reasons — a false `canDelete` is the
 * answer, not an error, so the page can render (or hide) the button without a try/catch.
 */
export async function getDeleteImpact(userId: string, documentId: string) {
  const doc = await load(userId, documentId);
  const [approvals, linkedTasks] = await Promise.all([
    approvalCount(doc.id),
    linkedTaskCount(doc.id),
  ]);
  // Same rule deleteDocument enforces: the creator-bypass only applies to documents nobody has
  // ever approved. Once a client has decided on it, it's not just the creator's to remove.
  let canDelete = doc.createdBy === userId && approvals === 0;
  if (!canDelete) {
    const role = await requireMember(userId, doc.orgId);
    canDelete = (await capabilitiesOf(doc.orgId, role)).has("manage_documents");
  }
  return { canDelete, approvalCount: approvals, linkedTaskCount: linkedTasks };
}

/**
 * Deletes a single document and all of its version histories.
 */
export async function deleteDocument(userId: string, documentId: string) {
  const doc = await load(userId, documentId);
  // The creator-only bypass is for documents nobody has ever approved. Once a client has
  // recorded a decision on it, deleting it needs manage_documents regardless of who wrote it —
  // a document's original author shouldn't retain unilateral, unrevocable delete rights over
  // something a client already signed off on.
  const approvals = await approvalCount(doc.id);
  if (doc.createdBy !== userId || approvals > 0) {
    await requireProjectCapability(userId, doc.projectId, "manage_documents");
  }
  return db.transaction(async (tx) => {
    await tx
      .delete(documentVersion)
      .where(eq(documentVersion.documentId, doc.id));
    await tx.delete(document).where(eq(document.id, doc.id));
    await recordAudit(tx, {
      orgId: doc.orgId,
      projectId: doc.projectId,
      actorId: userId,
      action: "document.deleted",
      targetType: "document",
      targetId: doc.id,
      targetLabel: doc.title,
    });
    return { id: doc.id, projectId: doc.projectId };
  });
}
