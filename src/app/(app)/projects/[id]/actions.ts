"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { WebhookEventType } from "@/db/schema";
import { DomainError } from "@/lib/errors";
import { addProjectMember, removeProjectMember } from "@/lib/projects";
import { requireSession } from "@/lib/session";

export type FormState = { error?: string; success?: boolean } | undefined;

export async function addProjectMemberAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  const input = z
    .object({
      projectId: z.string().uuid(),
      targetUserId: z.string().min(1),
      role: z.string().min(1).default("developer"),
    })
    .parse(Object.fromEntries(form));

  try {
    await addProjectMember(
      user.id,
      input.projectId,
      input.targetUserId,
      input.role,
    );
    revalidatePath(`/projects/${input.projectId}`);
    return { success: true };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function removeProjectMemberAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireSession();
  const input = z
    .object({
      projectId: z.string().uuid(),
      targetUserId: z.string().min(1),
    })
    .parse(Object.fromEntries(form));

  try {
    await removeProjectMember(user.id, input.projectId, input.targetUserId);
    revalidatePath(`/projects/${input.projectId}`);
    return { success: true };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function createWebhookAction(
  projectId: string,
  data: {
    name: string;
    url: string;
    events: (
      | "task.created"
      | "task.claimed"
      | "task.submitted"
      | "task.approved"
      | "task.rejected"
      | "task.handoff"
      | "worktree.provisioned"
      | "pr.synthesized"
      | "doc.published"
      | "ping"
    )[];
    secret?: string;
  },
): Promise<{ ok: boolean; error?: string; subscription?: unknown }> {
  const { user } = await requireSession();
  try {
    const { createWebhookSubscription } = await import("@/lib/webhooks");
    const sub = await createWebhookSubscription(user.id, {
      projectId,
      ...data,
    });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, subscription: sub };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to create webhook",
    };
  }
}

export async function updateWebhookAction(
  projectId: string,
  subscriptionId: string,
  patch: {
    name?: string;
    url?: string;
    events?: WebhookEventType[];
    active?: boolean;
  },
): Promise<{ ok: boolean; error?: string }> {
  const { user } = await requireSession();
  try {
    const { updateWebhookSubscription } = await import("@/lib/webhooks");
    await updateWebhookSubscription(user.id, subscriptionId, patch);
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to update webhook",
    };
  }
}

export async function deleteWebhookAction(
  projectId: string,
  subscriptionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { user } = await requireSession();
  try {
    const { deleteWebhookSubscription } = await import("@/lib/webhooks");
    await deleteWebhookSubscription(user.id, subscriptionId);
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to delete webhook",
    };
  }
}

export async function testWebhookAction(
  subscriptionId: string,
): Promise<{ ok: boolean; error?: string; message?: string }> {
  const { user } = await requireSession();
  try {
    const { testWebhookSubscription } = await import("@/lib/webhooks");
    const res = await testWebhookSubscription(user.id, subscriptionId);
    return { ok: res.success, message: res.message };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to test webhook",
    };
  }
}

export async function runFleetHealthAuditAction(
  projectId: string,
): Promise<{ ok: boolean; audit?: unknown; error?: string }> {
  const { user } = await requireSession();
  try {
    const { runFleetHealthAudit } = await import("@/lib/fleet/maintenance");
    const audit = await runFleetHealthAudit(user.id, projectId);
    return { ok: true, audit };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error ? e.message : "Failed to run fleet health audit",
    };
  }
}

export async function pruneStaleWorktreesAction(
  projectId: string,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const { user } = await requireSession();
  try {
    const { pruneStaleWorktrees } = await import("@/lib/fleet/maintenance");
    const result = await pruneStaleWorktrees(user.id, projectId);
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, result };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to prune stale worktrees",
    };
  }
}
