import { and, desc, eq, like, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvent, user } from "@/db/schema";
import { requireCapability } from "./access";

/** A `db` or a transaction: pass the transaction when the change has one, so change and record commit together. */
type Runner = Pick<typeof db, "insert">;

export type AuditEventInput = {
  orgId: string;
  projectId?: string | null;
  /** Null for the no-account client; give `actorLabel` then. */
  actorId?: string | null;
  actorLabel?: string;
  /** e.g. "task.approved" — the part before the dot is the area filter on /activity. */
  action: string;
  targetType: string;
  targetId?: string | null;
  targetLabel?: string | null;
  detail?: Record<string, unknown>;
};

export async function recordAudit(runner: Runner, e: AuditEventInput) {
  // One round trip: the actor's current name is snapshotted by the insert itself.
  const actorLabel =
    e.actorLabel ??
    (e.actorId
      ? sql<string>`coalesce((select ${user.name} from ${user} where ${user.id} = ${e.actorId}), 'Unknown')`
      : "Unknown");
  await runner.insert(auditEvent).values({
    orgId: e.orgId,
    projectId: e.projectId ?? null,
    actorId: e.actorId ?? null,
    actorLabel,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId ?? null,
    targetLabel: e.targetLabel ?? null,
    detail: e.detail ?? {},
  });
}

/** Newest first. `area` is the part of the action before the dot ("task", "document", …). */
export async function listAuditEvents(
  userId: string,
  orgId: string,
  opts: { area?: string; before?: Date; limit?: number } = {},
) {
  await requireCapability(userId, orgId, "view_audit_log");
  return db
    .select()
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.orgId, orgId),
        opts.area ? like(auditEvent.action, `${opts.area}.%`) : undefined,
        opts.before ? lt(auditEvent.createdAt, opts.before) : undefined,
      ),
    )
    .orderBy(desc(auditEvent.createdAt), desc(auditEvent.id))
    .limit(Math.min(opts.limit ?? 50, 200));
}
