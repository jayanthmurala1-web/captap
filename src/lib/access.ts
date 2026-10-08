import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { member, orgRole, project, projectMember, task } from "@/db/schema";
import {
  CAPABILITIES,
  CAPABILITY_INFO,
  type Capability,
  isCapability,
} from "./capabilities";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";

export { ForbiddenError, NotFoundError };

// Checked before querying uuid columns: malformed ids must read as "not found", not a Postgres error.
export const isUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** What a role slug can do in an org. `owner` always has everything, so an org can never lock itself out. */
export async function capabilitiesOf(
  orgId: string,
  slug: string,
): Promise<Set<Capability>> {
  if (slug === "owner") return new Set(CAPABILITIES);
  const [row] = await db
    .select({ capabilities: orgRole.capabilities })
    .from(orgRole)
    .where(and(eq(orgRole.orgId, orgId), eq(orgRole.slug, slug)));
  return new Set((row?.capabilities ?? []).filter(isCapability));
}

const denied = (cap: Capability) =>
  new ForbiddenError(`You need the "${CAPABILITY_INFO[cap].label}" permission`);

/** The tenant boundary: every org-scoped read/write resolves the caller's role slug here first. */
export async function requireMember(
  userId: string,
  orgId: string,
): Promise<string> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1);
  if (!row) throw new ForbiddenError("Not a member of this organization");
  return row.role;
}

/** Org-level permission check. Returns the caller's role slug. */
export async function requireCapability(
  userId: string,
  orgId: string,
  cap: Capability,
) {
  const role = await requireMember(userId, orgId);
  if (!(await capabilitiesOf(orgId, role)).has(cap)) throw denied(cap);
  return role;
}

/**
 * Resolves a project, and the caller's effective capabilities in it: org role ∪ project role.
 * Zero-knowledge isolation: without `access_all_projects`, an unassigned member gets "not found".
 */
export function requireProject(userId: string, projectIdOrName: string) {
  return resolveProject(
    userId,
    projectIdOrName,
    () => new NotFoundError("Project not found"),
  );
}

async function resolveProject(
  userId: string,
  projectIdOrName: string,
  hidden: () => Error,
) {
  const trimmed = projectIdOrName.trim();
  // By name: exact and case-insensitive. Not ILIKE, where "%" or "_" in an agent's input would match
  // some arbitrary project; and a name shared across two of your workspaces is ambiguous, not a coin toss.
  const whereClause = isUuid(trimmed)
    ? eq(project.id, trimmed)
    : sql`lower(${project.name}) = lower(${trimmed})`;

  const rows = await db
    .select({ orgId: project.orgId, role: member.role, id: project.id })
    .from(project)
    .innerJoin(
      member,
      and(eq(member.organizationId, project.orgId), eq(member.userId, userId)),
    )
    .where(whereClause)
    .limit(2);
  if (rows.length > 1)
    throw new ValidationError(
      `More than one of your projects is named "${trimmed}". Use the project's id instead.`,
    );
  const [row] = rows;
  if (!row) throw new NotFoundError("Project not found");

  const orgCaps = await capabilitiesOf(row.orgId, row.role);

  const [pm] = await db
    .select({ role: projectMember.role })
    .from(projectMember)
    .where(
      and(
        eq(projectMember.projectId, row.id),
        eq(projectMember.userId, userId),
      ),
    )
    .limit(1);

  let projectRole: string | null = pm?.role ?? null;
  if (!projectRole && !orgCaps.has("access_all_projects")) {
    // Fallback: user is assignee or claimant on a task in this project
    const [assignedTask] = await db
      .select({ id: task.id })
      .from(task)
      .where(
        and(
          eq(task.projectId, row.id),
          or(eq(task.assigneeId, userId), eq(task.claimedBy, userId)),
        ),
      )
      .limit(1);
    if (!assignedTask) throw hidden();
    projectRole = "developer";
  }

  const caps = new Set(orgCaps);
  if (projectRole)
    for (const c of await capabilitiesOf(row.orgId, projectRole)) caps.add(c);

  return {
    orgId: row.orgId,
    role: row.role,
    projectId: row.id,
    projectRole,
    caps,
  };
}

/** requireProject + a permission that must hold inside it. */
export async function requireProjectCapability(
  userId: string,
  projectIdOrName: string,
  cap: Capability,
) {
  // A member who can't see the project is told what they lack, as before (they already know it exists).
  const p = await resolveProject(userId, projectIdOrName, () => denied(cap));
  if (!p.caps.has(cap)) throw denied(cap);
  return p;
}
