"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DomainError } from "@/lib/errors";
import { deleteProject, updateProject } from "@/lib/projects";
import { requireSession } from "@/lib/session";

export type FormState = { error?: string; ok?: boolean } | undefined;

const nameField = z.string().trim().min(1).max(120);

export async function updateProjectAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  const projectId = String(form.get("projectId"));
  const parsed = nameField.safeParse(form.get("name"));
  if (!parsed.success) return { error: "Give the project a name" };
  try {
    await updateProject(user.id, projectId, {
      name: parsed.data,
      description: String(form.get("description") ?? "") || undefined,
    });
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteProjectAction(
  projectId: string,
): Promise<{ error?: string }> {
  const { user } = await requireSession();
  try {
    await deleteProject(user.id, projectId);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  redirect("/");
}
