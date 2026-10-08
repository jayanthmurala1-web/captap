import { eq } from "drizzle-orm";
import { db } from "@/db";
import { roleSkillRoute, type TaskRole } from "@/db/schema";
import { requireCapability, requireMember } from "./access";

export const TASK_ROLES: TaskRole[] = ["product", "developer", "qa", "devops"];

/** The old hardcoded routing (pre spec 025) — the fallback for any org that hasn't configured its
 * own routes yet, so nobody's behavior changes just because this feature now exists. */
export const DEFAULT_ROLE_SKILLS: Record<TaskRole, string[]> = {
  product: ["prd-writing"],
  developer: ["code-review"],
  qa: ["qa-review"],
  devops: ["deployment", "ci-cd"],
};

/** All of an org's configured routes, for rendering the canvas. Empty means "using the defaults". */
export async function listRoleRoutes(userId: string, orgId: string) {
  await requireMember(userId, orgId);
  return db
    .select({ role: roleSkillRoute.role, skillName: roleSkillRoute.skillName })
    .from(roleSkillRoute)
    .where(eq(roleSkillRoute.orgId, orgId));
}

/**
 * The routing the server actually applies, as flat role→skill pairs: the org's configured routes,
 * or — if it has configured none — the built-in defaults. `configured` says which. This is what the
 * Flow canvas draws and what MCP agents are told, so neither shows "nothing" while defaults quietly
 * apply behind the scenes.
 */
export async function getEffectiveRoleRoutes(userId: string, orgId: string) {
  const rows = await listRoleRoutes(userId, orgId);
  if (rows.length > 0) return { configured: true, routes: rows };
  return {
    configured: false,
    routes: TASK_ROLES.flatMap((role) =>
      DEFAULT_ROLE_SKILLS[role].map((skillName) => ({ role, skillName })),
    ),
  };
}

/** What `matchSkillsForTask` should actually use for one role: the org's configured routes if it has
 * any at all, otherwise the hardcoded default — a configured empty set (deliberately zero skills for
 * a role) is a real choice, so "has any rows for this org" gates the fallback, not "has rows for this role". */
export async function effectiveRoleSkills(orgId: string, role: TaskRole) {
  const rows = await db
    .select({ role: roleSkillRoute.role, skillName: roleSkillRoute.skillName })
    .from(roleSkillRoute)
    .where(eq(roleSkillRoute.orgId, orgId));
  if (rows.length === 0) return DEFAULT_ROLE_SKILLS[role] ?? [];
  return rows.filter((r) => r.role === role).map((r) => r.skillName);
}

/** Replaces every route for the org in one transaction — the canvas sends its full current edge
 * list on save, simpler than diffing adds/removes client-side. */
export async function setRoleRoutes(
  userId: string,
  orgId: string,
  routes: { role: TaskRole; skillName: string }[],
) {
  await requireCapability(userId, orgId, "manage_org_settings");
  await db.transaction(async (tx) => {
    await tx.delete(roleSkillRoute).where(eq(roleSkillRoute.orgId, orgId));
    if (routes.length > 0) {
      await tx
        .insert(roleSkillRoute)
        .values(
          routes.map((r) => ({ orgId, role: r.role, skillName: r.skillName })),
        );
    }
  });
}
