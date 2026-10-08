"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  checkConnection,
  createConnection,
  deleteConnection,
  updateConnection,
} from "@/lib/connections";
import { DomainError } from "@/lib/errors";
import { requireSession } from "@/lib/session";

export type FormState = { error?: string } | undefined;

const fields = z.object({
  kind: z.enum(["slack_webhook", "github_pat", "custom_mcp"]),
  label: z.string().min(1),
  url: z.string().optional(),
  secret: z.string().optional(),
});

export async function createConnectionAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user, session } = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return { error: "No active organization" };
  const parsed = fields.safeParse({
    kind: form.get("kind"),
    label: form.get("label"),
    url: form.get("url") || undefined,
    secret: form.get("secret") || undefined,
  });
  if (!parsed.success) return { error: "Fill in the required fields" };
  try {
    await createConnection(user.id, orgId, parsed.data);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath("/connections");
}

const updateFields = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  url: z.string().optional(),
  secret: z.string().optional(),
});

export async function updateConnectionAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  const parsed = updateFields.safeParse({
    id: form.get("id"),
    label: form.get("label") || undefined,
    url: form.get("url") || undefined,
    secret: form.get("secret") || undefined,
  });
  if (!parsed.success) return { error: "Invalid connection" };
  const { id, ...rest } = parsed.data;
  try {
    await updateConnection(user.id, id, rest);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath("/connections");
}

export async function deleteConnectionAction(form: FormData) {
  const { user } = await requireSession();
  await deleteConnection(user.id, String(form.get("id")));
  revalidatePath("/connections");
}

export async function checkConnectionAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  try {
    await checkConnection(user.id, String(form.get("id")));
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath("/connections");
}
