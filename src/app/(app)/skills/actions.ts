"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DomainError } from "@/lib/errors";
import { requireSession } from "@/lib/session";
import { composeSkill, MAX_SKILL_BYTES } from "@/lib/skill-parser";
import {
  createSkill,
  deleteSkill,
  getSkillById,
  updateSkill,
} from "@/lib/skills";

export type FormState = { error?: string } | undefined;

const fields = z.object({
  id: z.string().optional(),
  projectId: z.string().optional(),
  kind: z.enum(["guide", "review"]),
});

const back = (projectId?: string | null) =>
  projectId ? `/projects/${projectId}` : "/flow";

/** Create or edit an agent from the form fields, or from an uploaded .md/.txt SKILL.md (file wins). */
export async function saveSkillAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user, session } = await requireSession();
  const { id, projectId, kind } = fields.parse({
    id: form.get("id") || undefined,
    projectId: form.get("projectId") || undefined,
    kind: form.get("kind"),
  });
  const file = form.get("file");
  if (file instanceof File && file.size > MAX_SKILL_BYTES)
    return { error: "File is larger than 100 KB" };
  let source: string;
  if (file instanceof File && file.size > 0) {
    source = await file.text();
  } else {
    // The agent form: plain name/description fields + the playbook body from the editor.
    const previous = id ? (await getSkillById(user.id, id)).source : undefined;
    source = composeSkill(
      {
        name: String(form.get("name") ?? ""),
        description: String(form.get("description") ?? ""),
        body: String(form.get("body") ?? ""),
      },
      previous,
    );
  }

  let target: string;
  try {
    if (id) {
      target = back(
        (await updateSkill(user.id, id, { source, kind })).projectId,
      );
    } else {
      const orgId = session.activeOrganizationId;
      if (!projectId && !orgId) return { error: "No active organization" };
      await createSkill(
        user.id,
        projectId ? { projectId } : { orgId: orgId as string },
        { source, kind },
      );
      target = back(projectId);
    }
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath(target);
  redirect(target); // outside try: redirect() throws by design
}

export async function deleteSkillAction(form: FormData) {
  const { user } = await requireSession();
  const removed = await deleteSkill(user.id, String(form.get("id")));
  revalidatePath(back(removed.projectId));
  redirect(back(removed.projectId));
}
