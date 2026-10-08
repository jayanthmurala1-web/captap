import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  invitation,
  member,
  organization,
  orgRole,
  session,
  user,
} from "@/db/schema";
import { requireCapability } from "./access";
import { recordAudit } from "./audit";
import { appLink, invitationEmail, sendEmail } from "./email";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";

const INVITE_DAYS = 7;

/** Invites by link. Any org role except Owner (owners are made by an owner, on the Team page). */
export async function createInvitation(
  userId: string,
  orgId: string,
  email: string,
  roleSlug: string,
) {
  await requireCapability(userId, orgId, "invite_members");
  const address = email.trim().toLowerCase();
  if (roleSlug === "owner")
    throw new ValidationError(
      "Invite them, then make them an owner from the Team page",
    );
  const [role] = await db
    .select({ slug: orgRole.slug })
    .from(orgRole)
    .where(and(eq(orgRole.orgId, orgId), eq(orgRole.slug, roleSlug)));
  if (!role) throw new ValidationError("That role doesn't exist");

  const [already] = await db
    .select({ id: member.id })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(
        eq(member.organizationId, orgId),
        sql`lower(${user.email}) = ${address}`,
      ),
    );
  if (already) throw new ValidationError(`${address} is already on the team`);

  const [pending] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, orgId),
        sql`lower(${invitation.email}) = ${address}`,
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    );
  if (pending)
    throw new ValidationError(`${address} already has a pending invitation`);

  const [row] = await db
    .insert(invitation)
    .values({
      id: randomUUID(),
      organizationId: orgId,
      email: address,
      role: roleSlug,
      status: "pending",
      expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
      inviterId: userId,
    })
    .returning();
  await recordAudit(db, {
    orgId,
    actorId: userId,
    action: "invitation.created",
    targetType: "invitation",
    targetId: row.id,
    targetLabel: address,
    detail: { email: address, role: roleSlug },
  });

  const emailed = await emailInvitation(orgId, userId, row);
  return { ...row, emailed };
}

/** Best-effort: the invite exists either way, and the caller is told whether the email went. */
async function emailInvitation(
  orgId: string,
  inviterId: string,
  inv: { id: string; email: string; role: string | null },
) {
  const roleSlug = inv.role ?? "member";
  const [[org], [inviter], [roleRow]] = await Promise.all([
    db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, orgId)),
    db.select({ name: user.name }).from(user).where(eq(user.id, inviterId)),
    db
      .select({ name: orgRole.name })
      .from(orgRole)
      .where(and(eq(orgRole.orgId, orgId), eq(orgRole.slug, roleSlug))),
  ]);
  const sent = await sendEmail({
    to: inv.email,
    ...invitationEmail({
      inviterName: inviter?.name ?? "A teammate",
      orgName: org?.name ?? "a workspace",
      roleName: roleRow?.name ?? roleSlug,
      link: appLink(`/accept-invitation/${inv.id}`),
    }),
  });
  return sent.sent;
}

/** Sends the email again and gives the invite a fresh 7 days — also revives one that lapsed unaccepted. */
export async function resendInvitation(
  userId: string,
  orgId: string,
  invitationId: string,
) {
  await requireCapability(userId, orgId, "invite_members");
  const [row] = await db
    .update(invitation)
    .set({
      expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
    })
    .where(
      and(
        eq(invitation.id, invitationId),
        eq(invitation.organizationId, orgId),
        eq(invitation.status, "pending"),
      ),
    )
    .returning();
  if (!row) throw new NotFoundError("That invitation is no longer pending");
  await recordAudit(db, {
    orgId,
    actorId: userId,
    action: "invitation.resent",
    targetType: "invitation",
    targetId: row.id,
    targetLabel: row.email,
    detail: { email: row.email, role: row.role },
  });
  return { emailed: await emailInvitation(orgId, userId, row) };
}

export async function cancelInvitation(
  userId: string,
  orgId: string,
  invitationId: string,
) {
  await requireCapability(userId, orgId, "invite_members");
  const [cancelled] = await db
    .update(invitation)
    .set({ status: "canceled" })
    .where(
      and(
        eq(invitation.id, invitationId),
        eq(invitation.organizationId, orgId),
        eq(invitation.status, "pending"),
      ),
    )
    .returning({ email: invitation.email, role: invitation.role });
  if (cancelled)
    await recordAudit(db, {
      orgId,
      actorId: userId,
      action: "invitation.cancelled",
      targetType: "invitation",
      targetId: invitationId,
      targetLabel: cancelled.email,
      detail: { email: cancelled.email, role: cancelled.role },
    });
}

/** A still-usable invitation (pending and not expired), or null. Public: the link is the lookup key. */
export async function getPendingInvitation(id: string) {
  const [row] = await db
    .select({
      id: invitation.id,
      organizationId: invitation.organizationId,
      email: invitation.email,
      role: invitation.role,
      roleName: orgRole.name,
      orgName: organization.name,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .leftJoin(
      orgRole,
      and(
        eq(orgRole.orgId, invitation.organizationId),
        eq(orgRole.slug, invitation.role),
      ),
    )
    .where(
      and(
        eq(invitation.id, id),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    );
  return row ?? null;
}

/**
 * Joins the org the invitation is for. Only the invited email may use it — holding the link
 * isn't enough (links get forwarded) — and only once.
 */
export async function acceptInvitation(
  userId: string,
  userEmail: string,
  invitationId: string,
) {
  const inv = await getPendingInvitation(invitationId);
  if (!inv) throw new NotFoundError("This invitation is no longer valid");
  if (inv.email.trim().toLowerCase() !== userEmail.trim().toLowerCase()) {
    throw new ForbiddenError(
      `This invitation is for ${inv.email}. Sign in with that email to accept it.`,
    );
  }

  await db.transaction(async (tx) => {
    const [used] = await tx
      .update(invitation)
      .set({ status: "accepted" })
      .where(and(eq(invitation.id, inv.id), eq(invitation.status, "pending")))
      .returning({ id: invitation.id });
    if (!used) throw new NotFoundError("This invitation is no longer valid");
    await tx
      .insert(member)
      .values({
        id: `${inv.organizationId}-${userId}`,
        organizationId: inv.organizationId,
        userId,
        role: inv.role || "member",
        createdAt: new Date(),
      })
      .onConflictDoNothing();
    await recordAudit(tx, {
      orgId: inv.organizationId,
      actorId: userId,
      action: "invitation.accepted",
      targetType: "invitation",
      targetId: inv.id,
      targetLabel: inv.email,
      detail: { email: inv.email, role: inv.role || "member" },
    });
    // A session created before joining (sign-up) has no workspace; give it this one.
    await tx
      .update(session)
      .set({ activeOrganizationId: inv.organizationId })
      .where(
        and(eq(session.userId, userId), isNull(session.activeOrganizationId)),
      );
  });
  return { organizationId: inv.organizationId };
}

/** Admin view: invitations that can still be accepted, newest first. */
export async function listPendingInvitations(userId: string, orgId: string) {
  await requireCapability(userId, orgId, "invite_members");
  return db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, orgId),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(invitation.createdAt));
}
