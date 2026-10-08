import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { marketplaceSkill, organization, skill } from "@/db/schema";
import {
  isUuid,
  NotFoundError,
  requireCapability,
  requireMember,
} from "./access";
import { MARKETPLACE_SEED_SKILLS } from "./default-skills";
import { parseSkill } from "./skill-parser";
import { createSkill, updateSkill } from "./skills";

/** Anyone signed in can browse — adopting a strong org's process is the point of the marketplace. */
export async function listMarketplaceSkills(q?: string) {
  const rows = await db
    .select({
      id: marketplaceSkill.id,
      name: marketplaceSkill.name,
      title: marketplaceSkill.title,
      pitch: marketplaceSkill.pitch,
      kind: marketplaceSkill.kind,
      githubRepo: marketplaceSkill.githubRepo,
      publisherLabel: marketplaceSkill.publisherLabel,
      updatedAt: marketplaceSkill.updatedAt,
    })
    .from(marketplaceSkill)
    .where(
      q
        ? or(
            ilike(marketplaceSkill.title, `%${q}%`),
            ilike(marketplaceSkill.name, `%${q}%`),
            ilike(marketplaceSkill.pitch, `%${q}%`),
          )
        : undefined,
    )
    .orderBy(desc(marketplaceSkill.updatedAt));
  return rows;
}

export async function getMarketplaceSkill(id: string) {
  if (!isUuid(id)) throw new NotFoundError("Marketplace agent not found");
  const [row] = await db
    .select()
    .from(marketplaceSkill)
    .where(eq(marketplaceSkill.id, id));
  if (!row) throw new NotFoundError("Marketplace agent not found");
  return row;
}

/**
 * Publishes one of the caller's org-level skills. A second publish of the same (org, name) updates
 * the existing listing instead of creating a duplicate — the unique index enforces this.
 */
export async function publishSkill(
  userId: string,
  orgId: string,
  input: {
    source: string;
    kind: "guide" | "review";
    title: string;
    pitch: string;
    githubRepo?: string;
  },
) {
  await requireCapability(userId, orgId, "manage_org_settings");
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, orgId));
  const parsed = parseSkill(input.source);
  const [row] = await db
    .insert(marketplaceSkill)
    .values({
      orgId,
      publisherLabel: org?.name ?? "Unknown org",
      name: parsed.name,
      title: input.title.trim(),
      pitch: input.pitch.trim(),
      githubRepo: input.githubRepo?.trim() || undefined,
      kind: input.kind,
      source: parsed.source,
      publishedBy: userId,
    })
    .onConflictDoUpdate({
      target: [marketplaceSkill.orgId, marketplaceSkill.name],
      set: {
        title: input.title.trim(),
        pitch: input.pitch.trim(),
        githubRepo: input.githubRepo?.trim() || undefined,
        kind: input.kind,
        source: parsed.source,
        publishedBy: userId,
      },
    })
    .returning();
  return row;
}

export async function unpublishSkill(userId: string, id: string) {
  const row = await getMarketplaceSkill(id);
  if (!row.orgId) throw new NotFoundError("Marketplace agent not found");
  await requireCapability(userId, row.orgId, "manage_org_settings");
  await db.delete(marketplaceSkill).where(eq(marketplaceSkill.id, id));
  return row;
}

/** Copies a marketplace agent into the caller's org as an org-level skill, overwriting any skill of
 * the same name — the same outcome a human editing that skill by hand would produce. */
export async function adoptMarketplaceSkill(
  userId: string,
  orgId: string,
  marketplaceSkillId: string,
) {
  // Same gate as editing the org skill directly (createSkill/updateSkill) — adopting one from
  // the marketplace is the same mutation by a different door, so it needs the same permission,
  // not just membership.
  await requireCapability(userId, orgId, "manage_org_settings");
  const listing = await getMarketplaceSkill(marketplaceSkillId);
  const [existing] = await db
    .select({ id: skill.id })
    .from(skill)
    .where(
      and(
        eq(skill.orgId, orgId),
        isNull(skill.projectId),
        eq(skill.name, listing.name),
      ),
    );
  if (existing) {
    return updateSkill(userId, existing.id, {
      source: listing.source,
      kind: listing.kind,
    });
  }
  return createSkill(
    userId,
    { orgId },
    { source: listing.source, kind: listing.kind },
  );
}

/** Publishes Captap's own seed skills (orgId null) so the marketplace isn't empty on day one.
 * Idempotent: the (orgId, name) unique index with nullsNotDistinct makes a repeat call a no-op.
 * Requires real org membership — this used to be callable by anyone signed in, regardless of
 * org, to write globally-visible rows attributed to "Captap". */
export async function seedMarketplaceSkills(userId: string, orgId: string) {
  await requireMember(userId, orgId);
  await db
    .insert(marketplaceSkill)
    .values(
      MARKETPLACE_SEED_SKILLS.map((s) => {
        const parsed = parseSkill(s.source);
        return {
          orgId: null,
          publisherLabel: "Captap",
          name: parsed.name,
          title: s.title,
          pitch: s.pitch,
          githubRepo: s.githubRepo,
          kind: s.kind,
          source: parsed.source,
          publishedBy: userId,
        };
      }),
    )
    .onConflictDoNothing();
}
