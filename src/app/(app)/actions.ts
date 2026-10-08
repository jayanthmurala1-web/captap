"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import {
  cancelInvitation,
  createInvitation,
  resendInvitation,
} from "@/lib/invitations";
import { createProject } from "@/lib/projects";
import { createSampleProject } from "@/lib/sample-project";
import { requireSession } from "@/lib/session";

const name = z.string().trim().min(1).max(120);

export type FormState = { error?: string } | undefined;

export async function createOrgAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  await requireSession();
  const parsed = name.safeParse(form.get("name"));
  if (!parsed.success) return { error: "Enter your agency's name" };
  const slug = `${parsed.data
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)}-${randomUUID().slice(0, 6)}`;
  try {
    // Better Auth makes the creator the owner and sets it as the active org.
    await auth.api.createOrganization({
      body: { name: parsed.data, slug },
      headers: await headers(),
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Couldn't create the workspace",
    };
  }
  revalidatePath("/", "layout");
}

export async function createProjectAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user, session } = await requireSession();
  if (!session.activeOrganizationId) return { error: "No active workspace" };
  const input = z
    .object({ name, description: z.string().trim().max(2000).optional() })
    .safeParse({
      name: form.get("name"),
      description: form.get("description") || undefined,
    });
  if (!input.success) return { error: "Give the project a name" };
  let id: string;
  try {
    id = (
      await createProject(user.id, session.activeOrganizationId, input.data)
    ).id;
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(`/projects/${id}`);
}

const inviteInput = z.object({
  email: z.string().trim().email(),
  role: z.string().min(1),
});

export type InviteState =
  | { error?: string; inviteId?: string; email?: string; emailed?: boolean }
  | undefined;

export async function inviteMemberAction(
  _: InviteState,
  form: FormData,
): Promise<InviteState> {
  const { user, session } = await requireSession();
  if (!session.activeOrganizationId) return { error: "No active workspace" };
  const parsed = inviteInput.safeParse({
    email: form.get("email"),
    role: form.get("role") || "member",
  });
  if (!parsed.success) return { error: "Enter a valid email address" };
  try {
    const inv = await createInvitation(
      user.id,
      session.activeOrganizationId,
      parsed.data.email,
      parsed.data.role,
    );
    revalidatePath("/members");
    return { inviteId: inv.id, email: parsed.data.email, emailed: inv.emailed };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function cancelInvitationAction(form: FormData) {
  const { user, session } = await requireSession();
  if (!session.activeOrganizationId) throw new Error("No active organization");
  await cancelInvitation(
    user.id,
    session.activeOrganizationId,
    z.string().min(1).parse(form.get("invitationId")),
  );
  revalidatePath("/members");
}

export type ResendState = { error?: string; emailed?: boolean } | undefined;

export async function resendInvitationAction(
  _: ResendState,
  form: FormData,
): Promise<ResendState> {
  const { user, session } = await requireSession();
  if (!session.activeOrganizationId) return { error: "No active workspace" };
  try {
    const res = await resendInvitation(
      user.id,
      session.activeOrganizationId,
      z.string().min(1).parse(form.get("invitationId")),
    );
    revalidatePath("/members");
    return res;
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

/** Creates (or reopens) the sample project and lands on the task where the agent's work misses a requirement. */
export async function createSampleProjectAction(): Promise<FormState> {
  const { user, session } = await requireSession();
  if (!session.activeOrganizationId) return { error: "No active workspace" };
  let target: string;
  try {
    const { projectId, taskId } = await createSampleProject(
      user.id,
      session.activeOrganizationId,
    );
    target = taskId ? `/tasks/${taskId}` : `/projects/${projectId}`;
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  redirect(target);
}
