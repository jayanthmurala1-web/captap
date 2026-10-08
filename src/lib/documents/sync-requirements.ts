import { eq, sql } from "drizzle-orm";
import type { db } from "@/db";
import { requirement } from "@/db/schema";
import { numberRequirements } from "./requirements";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Called inside every PRD save (spec 017). Writes keys onto unmarked acceptance bullets, mirrors the
 * bullets into `requirement` rows, and marks rows whose bullet is gone as removed. Returns the content
 * to store as the new version (identical to the input when it was already numbered).
 */
export async function syncRequirements(
  tx: Tx,
  doc: { id: string; orgId: string; projectId: string },
  content: string,
) {
  const existing = await tx
    .select({ key: requirement.key, removedAt: requirement.removedAt })
    .from(requirement)
    .where(eq(requirement.documentId, doc.id));
  const taken = Math.max(0, ...existing.map((r) => Number(r.key.slice(2))));
  const numbered = numberRequirements(content, taken);

  if (numbered.items.length)
    await tx
      .insert(requirement)
      .values(
        numbered.items.map((i) => ({
          orgId: doc.orgId,
          projectId: doc.projectId,
          documentId: doc.id,
          key: i.key,
          text: i.text,
        })),
      )
      .onConflictDoUpdate({
        target: [requirement.documentId, requirement.key],
        set: { text: sql`excluded.text`, removedAt: null },
      });

  const kept = new Set(numbered.items.map((i) => i.key));
  for (const r of existing)
    if (!r.removedAt && !kept.has(r.key))
      await tx
        .update(requirement)
        .set({ removedAt: new Date() })
        .where(
          sql`${requirement.documentId} = ${doc.id} AND ${requirement.key} = ${r.key}`,
        );
  return numbered.content;
}
