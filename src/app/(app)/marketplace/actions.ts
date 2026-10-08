"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DomainError } from "@/lib/errors";
import {
  adoptMarketplaceSkill,
  publishSkill,
  seedMarketplaceSkills,
  unpublishSkill,
} from "@/lib/marketplace";
import { requireSession } from "@/lib/session";
import { getSkillById } from "@/lib/skills";

export type FormState = { error?: string } | undefined;

export async function publishSkillAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  const skillId = String(form.get("skillId"));
  const title = String(form.get("title") ?? "").trim();
  const pitch = String(form.get("pitch") ?? "").trim();
  const githubRepo = String(form.get("githubRepo") ?? "").trim();
  if (!title || !pitch) return { error: "Title and pitch are required" };
  try {
    const skill = await getSkillById(user.id, skillId);
    if (skill.projectId)
      return { error: "Only workspace-wide agents can be published" };
    await publishSkill(user.id, skill.orgId, {
      source: skill.source,
      kind: skill.kind,
      title,
      pitch,
      githubRepo: githubRepo || undefined,
    });
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath("/marketplace");
  revalidatePath(`/skills/${skillId}`);
  redirect("/marketplace");
}

export async function unpublishSkillAction(form: FormData) {
  const { user } = await requireSession();
  await unpublishSkill(user.id, String(form.get("id")));
  revalidatePath("/marketplace");
}

const adoptFields = z.object({ marketplaceSkillId: z.string() });

export async function adoptMarketplaceSkillAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user, session } = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return { error: "No active organization" };
  const { marketplaceSkillId } = adoptFields.parse({
    marketplaceSkillId: form.get("marketplaceSkillId"),
  });
  try {
    await adoptMarketplaceSkill(user.id, orgId, marketplaceSkillId);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath("/flow");
  redirect("/flow");
}

export async function seedMarketplaceAction() {
  const { user, session } = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return;
  await seedMarketplaceSkills(user.id, orgId);
  revalidatePath("/marketplace");
}
