"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { acceptInvitation, getPendingInvitation } from "@/lib/invitations";

export type InviteFormState = { error?: string } | undefined;

async function joinAndOpen(
  userId: string,
  email: string,
  invitationId: string,
) {
  const reqHeaders = await headers();
  const { organizationId } = await acceptInvitation(
    userId,
    email,
    invitationId,
  );
  await auth.api.setActiveOrganization({
    body: { organizationId },
    headers: reqHeaders,
  });
}

export async function acceptInvitationAction(
  invitationId: string,
): Promise<InviteFormState> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Sign in first" };
  try {
    await joinAndOpen(session.user.id, session.user.email, invitationId);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  redirect("/");
}

export async function registerAndAcceptInvitationAction(
  invitationId: string,
  _: InviteFormState,
  form: FormData,
): Promise<InviteFormState> {
  const input = z
    .object({
      name: z.string().trim().min(1, "Enter your name").max(120),
      password: z.string().min(8, "Password must be at least 8 characters"),
    })
    .safeParse({ name: form.get("name"), password: form.get("password") });
  if (!input.success) return { error: input.error.issues[0].message };

  // Check before creating an account, so a dead link doesn't leave an orphan account behind.
  const inv = await getPendingInvitation(invitationId);
  if (!inv) return { error: "This invitation is no longer valid" };

  let userId: string;
  try {
    const res = await auth.api.signUpEmail({
      body: {
        email: inv.email,
        password: input.data.password,
        name: input.data.name,
      },
      headers: await headers(),
    });
    userId = res.user.id;
  } catch {
    return {
      error: `An account for ${inv.email} may already exist. Sign in to accept the invitation.`,
    };
  }
  try {
    // Not joinAndOpen: this request's headers don't carry the new session yet, and
    // acceptInvitation already activates the workspace on the fresh session.
    await acceptInvitation(userId, inv.email, invitationId);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  redirect("/");
}
