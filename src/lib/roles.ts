import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  invitation,
  member,
  organization,
  orgRole,
  projectMember,
  session,
  task,
} from "@/db/schema";
import { requireCapability, requireMember } from "./access";
import { recordAudit } from "./audit";
import {
  CAPABILITIES,
  type Capability,
  isCapability,
  SYSTEM_ROLES,
} from "./capabilities";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";

export { CAPABILITIES };

/** Idempotent: creates whichever system roles the org is missing. Runs when an org is created. */
export async function seedDefaultRoles(orgId: string) {
  await db
    .insert(orgRole)
    .values(
      SYSTEM_ROLES.map((r) => ({
        orgId,
        slug: r.slug,
        name: r.name,
        capabilities: r.capabilities,
        isSystem: true,
      })),
    )
    .onConflictDoNothing();
}

/** Any member can read the list (it fills the invite and assignment pickers). */
export async function listRoles(userId: string, orgId: string) {
  await requireMember(userId, orgId);
  const rows = await db
    .select()
    .from(orgRole)
    .where(eq(orgRole.orgId, orgId))
    .orderBy(orgRole.createdAt, orgRole.slug);
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    isSystem: r.isSystem,
    // owner is always everything, whatever its row says
    capabilities: (r.slug === "owner"
      ? CAPABILITIES
      : r.capabilities.filter(isCapability)) as Capability[],
  }));
}

function cleanCapabilities(input: string[]): Capability[] {
  const bad = input.filter((c) => !isCapability(c));
  if (bad.length)
    throw new ValidationError(`Unknown permission: ${bad.join(", ")}`);
  return [...new Set(input)] as Capability[];
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

export async function createRole(
  userId: string,
  orgId: string,
  input: { name: string; capabilities: string[] },
) {
  await requireCapability(userId, orgId, "manage_roles");
  const name = input.name.trim();
  const slug = slugify(name);
  if (!name || !slug) throw new ValidationError("Give the role a name");
  const capabilities = cleanCapabilities(input.capabilities);
  const [row] = await db
    .insert(orgRole)
    .values({ orgId, slug, name, capabilities })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new ValidationError(`A role called "${name}" already exists`);
  await recordAudit(db, {
    orgId,
    actorId: userId,
    action: "role.created",
    targetType: "role",
    targetId: row.id,
    targetLabel: row.name,
    detail: { capabilities },
  });
  return row;
}

async function loadRole(userId: string, roleId: string) {
  const [row] = await db.select().from(orgRole).where(eq(orgRole.id, roleId));
  if (!row) throw new NotFoundError("Role not found");
  await requireCapability(userId, row.orgId, "manage_roles").catch((e) => {
    // Not even a member: don't reveal the role exists.
    if (e instanceof ForbiddenError && e.message.startsWith("Not a member"))
      throw new NotFoundError("Role not found");
    throw e;
  });
  return row;
}

export async function updateRole(
  userId: string,
  roleId: string,
  patch: { name?: string; capabilities?: string[] },
) {
  const row = await loadRole(userId, roleId);
  if (row.slug === "owner")
    throw new ValidationError("The Owner role can't be changed");
  const set: { name?: string; capabilities?: Capability[] } = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new ValidationError("Give the role a name");
    set.name = name;
  }
  if (patch.capabilities !== undefined)
    set.capabilities = cleanCapabilities(patch.capabilities);
  if (Object.keys(set).length === 0) return row;
  const [updated] = await db
    .update(orgRole)
    .set(set)
    .where(eq(orgRole.id, row.id))
    .returning();
  await recordAudit(db, {
    orgId: row.orgId,
    actorId: userId,
    action: "role.updated",
    targetType: "role",
    targetId: row.id,
    targetLabel: updated.name,
    detail: {
      before: row.capabilities,
      after: updated.capabilities,
      ...(set.name ? { name: { from: row.name, to: set.name } } : {}),
    },
  });
  return updated;
}

export async function deleteRole(userId: string, roleId: string) {
  const row = await loadRole(userId, roleId);
  if (row.slug === "owner")
    throw new ValidationError("The Owner role can't be deleted");
  const uses = await Promise.all([
    db
      .select({ n: count() })
      .from(member)
      .where(
        and(eq(member.organizationId, row.orgId), eq(member.role, row.slug)),
      ),
    db
      .select({ n: count() })
      .from(projectMember)
      .where(
        and(
          eq(projectMember.orgId, row.orgId),
          eq(projectMember.role, row.slug),
        ),
      ),
    db
      .select({ n: count() })
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, row.orgId),
          eq(invitation.role, row.slug),
          eq(invitation.status, "pending"),
        ),
      ),
  ]);
  const inUse = uses.reduce((sum, [r]) => sum + r.n, 0);
  if (inUse > 0)
    throw new ValidationError(
      `${row.name} is still assigned to ${inUse} ${inUse === 1 ? "person or invite" : "people or invites"}. Move them to another role first.`,
    );
  await db.delete(orgRole).where(eq(orgRole.id, row.id));
  await recordAudit(db, {
    orgId: row.orgId,
    actorId: userId,
    action: "role.deleted",
    targetType: "role",
    targetId: row.id,
    targetLabel: row.name,
    detail: { capabilities: row.capabilities },
  });
}

/** Changes a person's workspace role. Only an owner can grant or take away Owner, and the last owner stays. */
export async function setMemberRole(
  userId: string,
  orgId: string,
  targetUserId: string,
  slug: string,
) {
  const callerRole = await requireCapability(userId, orgId, "manage_roles");
  const [role] = await db
    .select({ slug: orgRole.slug })
    .from(orgRole)
    .where(and(eq(orgRole.orgId, orgId), eq(orgRole.slug, slug)));
  if (!role) throw new ValidationError("That role doesn't exist");

  const [target] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.organizationId, orgId), eq(member.userId, targetUserId)),
    );
  if (!target) throw new NotFoundError("Not a member of this workspace");

  const touchesOwner = slug === "owner" || target.role === "owner";
  if (touchesOwner && callerRole !== "owner")
    throw new ForbiddenError("Only an owner can change who the owners are");

  if (target.role === "owner" && slug !== "owner") {
    const [{ n }] = await db
      .select({ n: count() })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.role, "owner")));
    if (n <= 1)
      throw new ValidationError(
        "A workspace needs at least one owner. Make someone else an owner first.",
      );
  }

  await db
    .update(member)
    .set({ role: slug })
    .where(
      and(eq(member.organizationId, orgId), eq(member.userId, targetUserId)),
    );
  await recordAudit(db, {
    orgId,
    actorId: userId,
    action: "member.role_changed",
    targetType: "member",
    targetId: targetUserId,
    detail: { from: target.role, to: slug },
  });
}

/** Removes someone from the org, or lets them remove themselves ("leave"). Self-removal needs no
 * capability (you can always leave); removing someone else needs manage_roles, and only an owner can
 * remove an owner (same rule setMemberRole enforces). Either way the last owner can't go.
 *
 * Leaving isn't just deleting the membership row: their project roles go with it, work assigned to
 * them returns to the pool (an assignee who no longer exists in the org would make a task
 * unclaimable by anyone else), work they'd claimed but not submitted is released, and any session
 * still pointing at this org is reset so they land on workspace setup instead of a wall of errors. */
export async function removeMember(
  actingUserId: string,
  orgId: string,
  targetUserId: string,
) {
  const selfRemoval = actingUserId === targetUserId;
  const callerRole = selfRemoval
    ? await requireMember(actingUserId, orgId)
    : await requireCapability(actingUserId, orgId, "manage_roles");

  const [target] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.organizationId, orgId), eq(member.userId, targetUserId)),
    );
  if (!target) throw new NotFoundError("Not a member of this workspace");

  if (!selfRemoval && target.role === "owner" && callerRole !== "owner")
    throw new ForbiddenError("Only an owner can remove an owner");

  if (target.role === "owner") {
    const [{ n }] = await db
      .select({ n: count() })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.role, "owner")));
    if (n <= 1)
      throw new ValidationError(
        selfRemoval
          ? "You're the last owner. Make someone else an owner before you leave."
          : "A workspace needs at least one owner. Make someone else an owner first.",
      );
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(member)
      .where(
        and(eq(member.organizationId, orgId), eq(member.userId, targetUserId)),
      );
    await tx
      .delete(projectMember)
      .where(
        and(
          eq(projectMember.orgId, orgId),
          eq(projectMember.userId, targetUserId),
        ),
      );
    const unassigned = await tx
      .update(task)
      .set({ assigneeId: null })
      .where(and(eq(task.orgId, orgId), eq(task.assigneeId, targetUserId)))
      .returning({ id: task.id });
    // Claimed-but-unsubmitted work goes back to To do; in_review/done keep their history.
    const released = await tx
      .update(task)
      .set({
        status: "todo",
        claimedBy: null,
        claimedAgent: null,
        claimedAt: null,
      })
      .where(
        and(
          eq(task.orgId, orgId),
          eq(task.claimedBy, targetUserId),
          eq(task.status, "in_progress"),
        ),
      )
      .returning({ id: task.id });
    await tx
      .update(session)
      .set({ activeOrganizationId: null })
      .where(
        and(
          eq(session.userId, targetUserId),
          eq(session.activeOrganizationId, orgId),
        ),
      );
    await recordAudit(tx, {
      orgId,
      actorId: actingUserId,
      action: selfRemoval ? "member.left" : "member.removed",
      targetType: "member",
      targetId: targetUserId,
      detail: {
        role: target.role,
        unassignedTasks: unassigned.length,
        releasedTasks: released.length,
      },
    });
  });
}

/** Workspace rename — the only org-level field Better Auth's own disabled /organization/update
 * endpoint would have covered (see auth.ts's disabledPaths comment: org mutations are custom here
 * so org-defined roles are respected, not Better Auth's three built-in ones). */
export async function renameOrganization(
  userId: string,
  orgId: string,
  name: string,
) {
  await requireCapability(userId, orgId, "manage_org_settings");
  const trimmed = name.trim();
  if (!trimmed) throw new ValidationError("Give the workspace a name");
  await db
    .update(organization)
    .set({ name: trimmed })
    .where(eq(organization.id, orgId));
  await recordAudit(db, {
    orgId,
    actorId: userId,
    action: "org.renamed",
    targetType: "organization",
    targetId: orgId,
    detail: { name: trimmed },
  });
}
