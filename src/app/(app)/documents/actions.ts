"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { docTypeValues, visibilityValues } from "@/db/schema";
import { createDocumentShare, revokeDocumentShare } from "@/lib/document-share";
import { createDocument, updateDocument } from "@/lib/documents";
import { DomainError } from "@/lib/errors";
import { checkLimit } from "@/lib/rate-limit";
import { numberPrdRequirements } from "@/lib/requirements";
import { requireSession } from "@/lib/session";

export type FormState = { error?: string } | undefined;

const _optional = (v: FormDataEntryValue | null) => (v ? String(v) : undefined);

export async function createDocumentAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  const input = z
    .object({
      projectId: z.string(),
      title: z.string(),
      kind: z.enum(["prd", "doc"]).optional(),
      docType: z.enum(docTypeValues).optional(),
      visibility: z.enum(visibilityValues).optional(),
      content: z.string(),
    })
    .parse(Object.fromEntries(form));
  let id: string;
  try {
    id = (
      await createDocument(user.id, input.projectId, {
        ...input,
        note: "Created in web app",
      })
    ).id;
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/projects/${input.projectId}`);
  redirect(`/documents/${id}`);
}

export async function saveDocumentDirectAction(input: {
  id: string;
  baseVersion: number;
  title?: string;
  content: string;
  note?: string;
  visibility?: "draft" | "published";
}): Promise<{ ok: boolean; newVersion?: number; error?: string }> {
  const { user } = await requireSession();
  try {
    const updated = await updateDocument(user.id, input.id, {
      content: input.content,
      baseVersion: input.baseVersion,
      title: input.title,
      note: input.note || "Updated via inline document editor",
      visibility: input.visibility,
    });
    revalidatePath(`/documents/${input.id}`);
    revalidatePath(`/projects/${updated.projectId}`);
    return { ok: true, newVersion: updated.currentVersion };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to save document",
    };
  }
}

export async function deleteDocumentAction(
  documentId: string,
): Promise<{ ok: boolean; projectId?: string; error?: string }> {
  const { user } = await requireSession();
  try {
    const { deleteDocument } = await import("@/lib/documents");
    const result = await deleteDocument(user.id, documentId);
    revalidatePath(`/projects/${result.projectId}`);
    return { ok: true, projectId: result.projectId };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to delete document",
    };
  }
}

export async function createShareLinkAction(
  documentId: string,
): Promise<{ ok: boolean; url?: string; shareId?: string; error?: string }> {
  const { user } = await requireSession();
  try {
    const share = await createDocumentShare(user.id, documentId);
    return {
      ok: true,
      shareId: share.id,
      url: `/approve/${share.token}`,
    };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function revokeShareLinkAction(
  shareId: string,
  documentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { user } = await requireSession();
  try {
    await revokeDocumentShare(user.id, shareId);
    revalidatePath(`/documents/${documentId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Editor image upload (documents, tasks, agent playbooks). */
export async function uploadImageAction(
  form: FormData,
): Promise<{ url?: string; error?: string }> {
  const { user, session } = await requireSession();
  if (!session.activeOrganizationId) return { error: "No active workspace" };
  const file = form.get("file");
  if (!(file instanceof File)) return { error: "No image received" };
  const limit = await checkLimit("upload", user.id);
  if (!limit.ok)
    return { error: `Too many uploads. Try again in ${limit.retryAfter}s.` };
  try {
    const { uploadImage } = await import("@/lib/cloudinary");
    return {
      url: await uploadImage(user.id, session.activeOrganizationId, file),
    };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    return { error: e instanceof Error ? e.message : "Upload failed" };
  }
}

/** Writes R-n keys into a PRD written before spec 017, as a normal versioned save. */
export async function numberRequirementsAction(
  documentId: string,
): Promise<{ error?: string }> {
  const { user } = await requireSession();
  try {
    await numberPrdRequirements(user.id, documentId);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/documents/${documentId}`);
  return {};
}
