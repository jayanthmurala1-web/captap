"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DomainError } from "@/lib/errors";
import { requireSession } from "@/lib/session";
import { composeSkill } from "@/lib/skill-parser";
import {
  createSkill,
  deleteSkill,
  getSkillById,
  updateSkill,
} from "@/lib/skills";

export type AgentFormState =
  | { error?: string; ok?: boolean; id?: string }
  | undefined;

const fields = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().min(1),
  body: z.string(),
  kind: z.enum(["guide", "review"]),
});

/** Org-level only — the Flow canvas is org scope (spec 025/026). Project-level skill overrides
 * still go through the project settings page, unchanged. Never redirects: the canvas stays put
 * and just adds/updates the node client-side. */
export async function saveAgentFromFlowAction(
  _: AgentFormState,
  form: FormData,
): Promise<AgentFormState> {
  const { user, session } = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return { error: "No active organization" };
  const parsed = fields.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Fill in the required fields" };
  const { id, name, description, body, kind } = parsed.data;

  const previous = id ? (await getSkillById(user.id, id)).source : undefined;
  const source = composeSkill({ name, description, body }, previous);

  try {
    const row = id
      ? await updateSkill(user.id, id, { source, kind })
      : await createSkill(user.id, { orgId }, { source, kind });
    revalidatePath("/flow");
    return { ok: true, id: row.id };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function deleteAgentFromFlowAction(
  id: string,
): Promise<AgentFormState> {
  const { user } = await requireSession();
  try {
    await deleteSkill(user.id, id);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath("/flow");
  return { ok: true };
}
