import { and, count, desc, eq, inArray, max, or } from "drizzle-orm";
import { db } from "@/db";
import {
  member,
  organization,
  orgRole,
  project,
  projectMember,
  task,
  user,
} from "@/db/schema";
import {
  capabilitiesOf,
  requireCapability,
  requireMember,
  requireProject,
  requireProjectCapability,
} from "./access";
import { recordAudit } from "./audit";
import { ensureDeveloperWorkLedger } from "./documents";
import { ValidationError } from "./errors";

export function listOrganizations(userId: string) {
  return db
    .select({ id: organization.id, name: organization.name, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId));
}

/**
 * Lists projects with strict developer & agent isolation:
 * - Org Owners & Admins see all projects in their organization.
 * - Regular Members & External Agents see ONLY projects where they are explicitly
 *   assigned in `project_member` or hold assigned tasks.
 */
export async function listProjects(userId: string, orgId?: string) {
  // 1. Fetch user's org roles
  const orgMemberships = await db
    .select({ orgId: member.organizationId, role: member.role })
    .from(member)
    .where(
      and(
        eq(member.userId, userId),
        orgId ? eq(member.organizationId, orgId) : undefined,
      ),
    );

  if (orgMemberships.length === 0) return [];

  const adminOrgIds: string[] = [];
  for (const m of orgMemberships)
    if ((await capabilitiesOf(m.orgId, m.role)).has("access_all_projects"))
      adminOrgIds.push(m.orgId);

  // 2. Fetch projects where user is explicitly in project_member
  const assignedProjectRows = await db
    .select({ projectId: projectMember.projectId })
    .from(projectMember)
    .where(eq(projectMember.userId, userId));
  const assignedProjectIds = new Set(
    assignedProjectRows.map((r) => r.projectId),
  );

  // 3. Fetch projects where user has an assigned/claimed task
  const taskProjectRows = await db
    .select({ projectId: task.projectId })
    .from(task)
    .where(or(eq(task.assigneeId, userId), eq(task.claimedBy, userId)));
  for (const r of taskProjectRows) {
    assignedProjectIds.add(r.projectId);
  }

  const allVisibleOrgIds = orgMemberships.map((m) => m.orgId);

  const projects = await db
    .select({
      id: project.id,
      name: project.name,
      description: project.description,
      orgId: project.orgId,
      orgName: organization.name,
      githubRepo: project.githubRepo,
      createdAt: project.createdAt,
    })
    .from(project)
    .innerJoin(organization, eq(organization.id, project.orgId))
    .where(
      and(
        inArray(project.orgId, allVisibleOrgIds),
        orgId ? eq(project.orgId, orgId) : undefined,
      ),
    )
    .orderBy(desc(project.createdAt));

  // Filter: org admins see all in their admin orgs; otherwise must be assigned
  return projects.filter((p) => {
    if (adminOrgIds.includes(p.orgId)) return true;
    return assignedProjectIds.has(p.id);
  });
}

export async function getProject(userId: string, projectId: string) {
  await requireProject(userId, projectId);
  const [row] = await db
    .select()
    .from(project)
    .where(eq(project.id, projectId));
  return row;
}

export async function createProject(
  userId: string,
  orgId: string,
  input: { name: string; description?: string },
) {
  await requireCapability(userId, orgId, "create_projects");
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(project)
      .values({
        orgId,
        createdBy: userId,
        name: input.name,
        description: input.description,
      })
      .returning();

    // Automatically record creator as project lead
    await tx.insert(projectMember).values({
      orgId,
      projectId: created.id,
      userId,
      role: "lead",
    });
    await recordAudit(tx, {
      orgId,
      projectId: created.id,
      actorId: userId,
      action: "project.created",
      targetType: "project",
      targetId: created.id,
      targetLabel: created.name,
    });

    return created;
  });

  // Auto-provision initial work ledger for project lead after transaction commit
  await ensureDeveloperWorkLedger(row.id, userId);

  return row;
}

export async function updateProject(
  userId: string,
  projectId: string,
  input: { name?: string; description?: string },
) {
  const { orgId, projectId: resolvedId } = await requireProjectCapability(
    userId,
    projectId,
    "manage_project_settings",
  );
  const name = input.name?.trim();
  if (input.name !== undefined && !name)
    throw new ValidationError("Project name is required");

  const [row] = await db
    .update(project)
    .set({
      ...(name ? { name } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
    })
    .where(eq(project.id, resolvedId))
    .returning();
  await recordAudit(db, {
    orgId,
    projectId: resolvedId,
    actorId: userId,
    action: "project.updated",
    targetType: "project",
    targetId: resolvedId,
    targetLabel: row.name,
  });
  return row;
}

/** Deletes a project and everything in it — tasks, documents, requirements, skills, worktrees,
 * webhooks — every table referencing project.id cascades (schema.ts). Irreversible. */
export async function deleteProject(userId: string, projectId: string) {
  const { orgId, projectId: resolvedId } = await requireProjectCapability(
    userId,
    projectId,
    "manage_project_settings",
  );
  const [row] = await db
    .select({ name: project.name })
    .from(project)
    .where(eq(project.id, resolvedId));
  // One transaction: a project must never vanish without its audit record (audit_event has no FK
  // to project, so the record outlives it).
  await db.transaction(async (tx) => {
    await tx.delete(project).where(eq(project.id, resolvedId));
    await recordAudit(tx, {
      orgId,
      projectId: resolvedId,
      actorId: userId,
      action: "project.deleted",
      targetType: "project",
      targetId: resolvedId,
      targetLabel: row?.name ?? resolvedId,
    });
  });
  return { id: resolvedId, deleted: true };
}

/**
 * Assigns a developer, tester, or agent to a specific project.
 * Automatically provisions their daily work & KT ledger (developer/{name}/work).
 */
export async function addProjectMember(
  adminUserId: string,
  projectId: string,
  targetUserId: string,
  role = "developer",
) {
  const { orgId, projectId: resolvedId } = await requireProjectCapability(
    adminUserId,
    projectId,
    "manage_project_settings",
  );

  // Verify target user is in the organization
  await requireMember(targetUserId, orgId);
  const [known] = await db
    .select({ id: orgRole.id })
    .from(orgRole)
    .where(and(eq(orgRole.orgId, orgId), eq(orgRole.slug, role)));
  if (!known)
    throw new ValidationError(`No role called "${role}" in this workspace`);

  // Check if already assigned
  const [existing] = await db
    .select({ id: projectMember.id, role: projectMember.role })
    .from(projectMember)
    .where(
      and(
        eq(projectMember.projectId, resolvedId),
        eq(projectMember.userId, targetUserId),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.role !== role) {
      await db
        .update(projectMember)
        .set({ role })
        .where(eq(projectMember.id, existing.id));
    }
    await ensureDeveloperWorkLedger(resolvedId, targetUserId);
    await recordAudit(db, {
      orgId,
      projectId: resolvedId,
      actorId: adminUserId,
      action: "project.member_added",
      targetType: "member",
      targetId: targetUserId,
      detail: { userId: targetUserId, role, changed: true },
    });
    return { ...existing, role };
  }

  const [created] = await db
    .insert(projectMember)
    .values({
      orgId,
      projectId: resolvedId,
      userId: targetUserId,
      role,
    })
    .returning();

  // Auto-provision developer work ledger folder
  await ensureDeveloperWorkLedger(resolvedId, targetUserId);
  await recordAudit(db, {
    orgId,
    projectId: resolvedId,
    actorId: adminUserId,
    action: "project.member_added",
    targetType: "member",
    targetId: targetUserId,
    detail: { userId: targetUserId, role },
  });

  return created;
}

export async function removeProjectMember(
  adminUserId: string,
  projectId: string,
  targetUserId: string,
) {
  const { orgId, projectId: resolvedId } = await requireProjectCapability(
    adminUserId,
    projectId,
    "manage_project_settings",
  );

  const removed = await db
    .delete(projectMember)
    .where(
      and(
        eq(projectMember.projectId, resolvedId),
        eq(projectMember.userId, targetUserId),
      ),
    )
    .returning({ role: projectMember.role });
  if (removed.length)
    await recordAudit(db, {
      orgId,
      projectId: resolvedId,
      actorId: adminUserId,
      action: "project.member_removed",
      targetType: "member",
      targetId: targetUserId,
      detail: { userId: targetUserId, role: removed[0].role },
    });
  return removed;
}

export async function listProjectMembers(userId: string, projectId: string) {
  const p = await requireProject(userId, projectId);

  return db
    .select({
      id: projectMember.id,
      userId: projectMember.userId,
      name: user.name,
      email: user.email,
      image: user.image,
      role: projectMember.role,
      assignedAt: projectMember.createdAt,
    })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .where(eq(projectMember.projectId, p.projectId))
    .orderBy(desc(projectMember.createdAt));
}

/** Name of an org the user belongs to (null if they aren't a member). */
export async function getOrgName(userId: string, orgId: string) {
  const [row] = await db
    .select({ name: organization.name })
    .from(organization)
    .innerJoin(
      member,
      and(
        eq(member.organizationId, organization.id),
        eq(member.userId, userId),
      ),
    )
    .where(eq(organization.id, orgId));
  return row?.name ?? null;
}

/** Projects home (portfolio view): each visible project with progress and its review queue. */
export async function listProjectSummaries(userId: string, orgId: string) {
  const projects = await listProjects(userId, orgId);
  if (projects.length === 0) return [];
  const rows = await db
    .select({
      projectId: task.projectId,
      status: task.status,
      n: count().mapWith(Number),
      lastActivity: max(task.updatedAt),
    })
    .from(task)
    .where(
      inArray(
        task.projectId,
        projects.map((p) => p.id),
      ),
    )
    .groupBy(task.projectId, task.status);

  return projects.map((p) => {
    const mine = rows.filter((r) => r.projectId === p.id);
    const of = (s: string) => mine.find((r) => r.status === s)?.n ?? 0;
    const total = mine.reduce((sum, r) => sum + r.n, 0);
    const last = mine
      .map((r) => r.lastActivity)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      ...p,
      total,
      done: of("done"),
      inReview: of("in_review"),
      inProgress: of("in_progress"),
      percentDone: total ? Math.round((of("done") / total) * 100) : 0,
      lastActivity: last ?? null,
    };
  });
}
