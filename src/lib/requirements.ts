import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  document,
  documentVersion,
  requirement,
  task,
  taskRequirement,
} from "@/db/schema";
import { isUuid, requireProject, requireProjectCapability } from "./access";
import { updateDocument } from "./documents";
import { numberRequirements } from "./documents/requirements";
import { NotFoundError, ValidationError } from "./errors";

export type RequirementState =
  | "no_task"
  | "not_started"
  | "in_progress"
  | "in_review"
  | "done";

const RANK: Record<string, number> = {
  todo: 0,
  in_progress: 1,
  in_review: 2,
  done: 3,
};
const STATE_OF_RANK: RequirementState[] = [
  "not_started",
  "in_progress",
  "in_review",
  "done",
];

/** A requirement is only as far along as its least-advanced task. Derived, never stored. */
export function requirementState(taskStatuses: string[]): RequirementState {
  if (taskStatuses.length === 0) return "no_task";
  return STATE_OF_RANK[Math.min(...taskStatuses.map((s) => RANK[s] ?? 0))];
}

async function loadPrd(documentId: string) {
  if (!isUuid(documentId)) throw new NotFoundError("Document not found");
  const [doc] = await db
    .select()
    .from(document)
    .where(eq(document.id, documentId));
  if (doc?.docType !== "prd") throw new NotFoundError("PRD not found");
  return doc;
}

/** Every requirement of a PRD with derived state, its tasks, and coverage counts. */
export async function listRequirements(userId: string, documentId: string) {
  const doc = await loadPrd(documentId);
  await requireProject(userId, doc.projectId);

  const [rows, links, [latest]] = await Promise.all([
    db.select().from(requirement).where(eq(requirement.documentId, doc.id)),
    db
      .select({
        requirementId: taskRequirement.requirementId,
        id: task.id,
        number: task.number,
        title: task.title,
        status: task.status,
      })
      .from(taskRequirement)
      .innerJoin(task, eq(task.id, taskRequirement.taskId))
      .innerJoin(requirement, eq(requirement.id, taskRequirement.requirementId))
      .where(eq(requirement.documentId, doc.id))
      .orderBy(asc(task.number)),
    db
      .select({ content: documentVersion.content })
      .from(documentVersion)
      .where(
        and(
          eq(documentVersion.documentId, doc.id),
          eq(documentVersion.version, doc.currentVersion),
        ),
      ),
  ]);

  const requirements = rows
    .sort((a, b) => Number(a.key.slice(2)) - Number(b.key.slice(2)))
    .map((r) => {
      const tasks = links
        .filter((l) => l.requirementId === r.id)
        .map((l) => ({
          id: l.id,
          key: `T-${l.number}`,
          title: l.title,
          status: l.status,
        }));
      return {
        id: r.id,
        key: r.key,
        text: r.text,
        removed: r.removedAt !== null,
        state: requirementState(tasks.map((t) => t.status)),
        tasks,
      };
    });
  const active = requirements.filter((r) => !r.removed);

  // Bullets in the latest text that carry no key yet (a PRD written before spec 017).
  const known = new Set(rows.map((r) => r.key));
  const unnumbered = latest
    ? numberRequirements(latest.content, 0).items.filter(
        (i) => !known.has(i.key),
      ).length
    : 0;

  return {
    requirements,
    unnumbered,
    counts: {
      total: active.length,
      withWork: active.filter((r) => r.state !== "no_task").length,
      done: active.filter((r) => r.state === "done").length,
    },
  };
}

/** Writes keys into a legacy PRD as a normal, versioned save. No-op when everything is already numbered. */
export async function numberPrdRequirements(
  userId: string,
  documentId: string,
) {
  const doc = await loadPrd(documentId);
  await requireProjectCapability(userId, doc.projectId, "manage_documents");
  const [latest] = await db
    .select({ content: documentVersion.content })
    .from(documentVersion)
    .where(
      and(
        eq(documentVersion.documentId, doc.id),
        eq(documentVersion.version, doc.currentVersion),
      ),
    );
  if (!latest) throw new NotFoundError("PRD has no content");
  const taken = await db
    .select({ key: requirement.key })
    .from(requirement)
    .where(eq(requirement.documentId, doc.id));
  const { content, items } = numberRequirements(
    latest.content,
    Math.max(0, ...taken.map((r) => Number(r.key.slice(2)))),
  );
  if (content === latest.content) return { numbered: 0 };
  await updateDocument(userId, doc.id, {
    content,
    baseVersion: doc.currentVersion,
    note: "Numbered requirements (R-1, R-2, …)",
  });
  return { numbered: items.length };
}

type Reader = Pick<typeof db, "select">;

/**
 * Validates a task's PRD + requirement keys and returns the requirement ids to link.
 * The PRD must be a PRD document in the same project; keys must be live requirements of it.
 */
export async function resolveTaskLinks(
  reader: Reader,
  projectId: string,
  prdDocumentId: string | null | undefined,
  keys: string[] | undefined,
) {
  if (!prdDocumentId) {
    if (keys?.length)
      throw new ValidationError("Pick a PRD before choosing its requirements");
    return { prdDocumentId: null, requirementIds: [] as string[] };
  }
  if (!isUuid(prdDocumentId))
    throw new ValidationError("That PRD doesn't exist in this project");
  const [prd] = await reader
    .select({ id: document.id })
    .from(document)
    .where(
      and(
        eq(document.id, prdDocumentId),
        eq(document.projectId, projectId),
        eq(document.docType, "prd"),
      ),
    );
  if (!prd) throw new ValidationError("That PRD doesn't exist in this project");

  const wanted = [...new Set((keys ?? []).map((k) => k.trim().toUpperCase()))];
  if (wanted.length === 0) return { prdDocumentId, requirementIds: [] };
  const found = await reader
    .select({ id: requirement.id, key: requirement.key })
    .from(requirement)
    .where(
      and(
        eq(requirement.documentId, prdDocumentId),
        inArray(requirement.key, wanted),
        isNull(requirement.removedAt),
      ),
    );
  const missing = wanted.filter((k) => !found.some((f) => f.key === k));
  if (missing.length)
    throw new ValidationError(
      `No live requirement ${missing.join(", ")} in that PRD`,
    );
  return { prdDocumentId, requirementIds: found.map((f) => f.id) };
}

/** The requirements linked to one task, in key order. */
export async function taskRequirements(taskId: string) {
  const rows = await db
    .select({
      id: requirement.id,
      key: requirement.key,
      text: requirement.text,
      removedAt: requirement.removedAt,
    })
    .from(taskRequirement)
    .innerJoin(requirement, eq(requirement.id, taskRequirement.requirementId))
    .where(eq(taskRequirement.taskId, taskId))
    .orderBy(desc(requirement.createdAt));
  return rows
    .map((r) => ({
      id: r.id,
      key: r.key,
      text: r.text,
      removed: r.removedAt !== null,
    }))
    .sort((a, b) => Number(a.key.slice(2)) - Number(b.key.slice(2)));
}

export type PrdOption = {
  id: string;
  title: string;
  requirements: { key: string; text: string }[];
};

/** A project's PRDs with their live requirements: fills the "built under" pickers. */
export async function listProjectPrds(
  userId: string,
  projectId: string,
): Promise<PrdOption[]> {
  const p = await requireProject(userId, projectId);
  const prds = await db
    .select({ id: document.id, title: document.title })
    .from(document)
    .where(
      and(
        eq(document.projectId, p.projectId),
        eq(document.docType, "prd"),
        // drafts stay private to their author, same as everywhere else
        sql`(${document.visibility} <> 'draft' OR ${document.createdBy} = ${userId})`,
      ),
    )
    .orderBy(asc(document.createdAt));
  if (prds.length === 0) return [];
  const reqs = await db
    .select({
      documentId: requirement.documentId,
      key: requirement.key,
      text: requirement.text,
    })
    .from(requirement)
    .where(
      and(
        inArray(
          requirement.documentId,
          prds.map((d) => d.id),
        ),
        isNull(requirement.removedAt),
      ),
    );
  return prds.map((d) => ({
    ...d,
    requirements: reqs
      .filter((r) => r.documentId === d.id)
      .sort((a, b) => Number(a.key.slice(2)) - Number(b.key.slice(2)))
      .map(({ key, text }) => ({ key, text })),
  }));
}
