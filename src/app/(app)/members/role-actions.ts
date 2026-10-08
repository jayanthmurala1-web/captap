"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { listOrganizations } from "@/lib/projects";
import {
  createRole,
  deleteRole,
  removeMember,
  renameOrganization,
  setMemberRole,
  updateRole,
} from "@/lib/roles";
import { requireSession } from "@/lib/session";

export type RoleResult = { error?: string } | undefined;

/** Runs a roles change as the signed-in user; domain errors become form messages. */
async function run(
  fn: (userId: string, orgId: string) => Promise<unknown>,
): Promise<RoleResult> {
  const { user, session } = await requireSession();
  if (!session.activeOrganizationId) return { error: "No active workspace" };
  try {
    await fn(user.id, session.activeOrganizationId);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
}

export async function createRoleAction(name: string, capabilities: string[]) {
  return run((u, o) => createRole(u, o, { name, capabilities }));
}

export async function updateRoleAction(
  roleId: string,
  patch: { name: string; capabilities: string[] },
) {
  return run((u) => updateRole(u, roleId, patch));
}

export async function deleteRoleAction(roleId: string) {
  return run((u) => deleteRole(u, roleId));
}

export async function setMemberRoleAction(targetUserId: string, slug: string) {
  return run((u, o) => setMemberRole(u, o, targetUserId, slug));
}

export async function removeMemberAction(targetUserId: string) {
  return run((u, o) => removeMember(u, o, targetUserId));
}

export async function renameOrganizationAction(name: string) {
  return run((u, o) => renameOrganization(u, o, name));
}

/** Leaving is removeMember on yourself, plus pointing the session at another org you belong to
 * (or clearing it) so the next request doesn't try to load membership in the org you just left. */
export async function leaveOrganizationAction(): Promise<RoleResult> {
  const { user, session } = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return { error: "No active workspace" };
  try {
    await removeMember(user.id, orgId, user.id);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  const remaining = await listOrganizations(user.id);
  if (remaining[0]) {
    await auth.api.setActiveOrganization({
      body: { organizationId: remaining[0].id },
      headers: await headers(),
    });
  }
  // No org left: session.activeOrganizationId stays pointed at the one just left. The layout
  // handles that defensively (falls back to the "create a workspace" screen) rather than crash.
  revalidatePath("/", "layout");
}
