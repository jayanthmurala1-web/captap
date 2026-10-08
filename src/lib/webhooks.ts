import crypto from "node:crypto";
import { and, desc, eq, getTableColumns, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  type WebhookDelivery,
  type WebhookEventType,
  type WebhookSubscription,
  webhookDelivery,
  webhookEventType,
  webhookSubscription,
} from "@/db/schema";
import { requireCapability, requireProjectCapability } from "./access";
import { recordAudit } from "./audit";
import { NotFoundError, ValidationError } from "./errors";
import {
  formatDiscordMessage,
  formatSlackMessage,
} from "./notifications/bridge";

export const webhookInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().trim().url(),
  events: z.array(z.enum(webhookEventType.enumValues)).min(1),
  secret: z.string().trim().min(8).max(128).optional(),
  active: z.boolean().optional(),
  projectId: z.string().optional(),
  orgId: z.string().optional(),
});

export type CreateWebhookInput = z.input<typeof webhookInputSchema>;

export function computeWebhookSignature(
  payload: unknown,
  secret: string,
): string {
  const content =
    typeof payload === "string" ? payload : JSON.stringify(payload);
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(content)
    .digest("hex");
  return `sha256=${hmac}`;
}

function validateWebhookUrl(urlStr: string) {
  try {
    const parsed = new URL(urlStr);
    const isDev =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname.endsWith(".local");
    if (parsed.protocol !== "https:" && !isDev) {
      throw new ValidationError(
        "Webhook endpoints must use HTTPS in production environments.",
      );
    }
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(`Invalid webhook URL: ${urlStr}`);
  }
}

/**
 * Creates a new webhook subscription.
 */
export async function createWebhookSubscription(
  userId: string,
  rawInput: CreateWebhookInput,
): Promise<WebhookSubscription> {
  const input = webhookInputSchema.parse(rawInput);
  validateWebhookUrl(input.url);

  let targetOrgId: string;
  let targetProjectId: string | undefined;

  if (input.projectId) {
    // Admin-only: an endpoint receives every project event.
    const p = await requireProjectCapability(
      userId,
      input.projectId,
      "manage_project_settings",
    );
    targetOrgId = p.orgId;
    targetProjectId = p.projectId;
  } else if (input.orgId) {
    await requireCapability(userId, input.orgId, "manage_org_settings");
    targetOrgId = input.orgId;
  } else {
    throw new ValidationError("Either projectId or orgId must be provided");
  }

  const secret = input.secret || crypto.randomBytes(24).toString("hex");

  const [sub] = await db
    .insert(webhookSubscription)
    .values({
      orgId: targetOrgId,
      projectId: targetProjectId,
      name: input.name,
      url: input.url,
      secret,
      events: input.events as WebhookEventType[],
      active: input.active ?? true,
      createdBy: userId,
    })
    .returning();
  await recordAudit(db, {
    orgId: targetOrgId,
    projectId: targetProjectId,
    actorId: userId,
    action: "webhook.created",
    targetType: "webhook",
    targetId: sub.id,
    targetLabel: sub.name,
    detail: { events: sub.events, url: sub.url }, // never the signing secret
  });

  return sub;
}

/**
 * Lists webhook subscriptions for a project or organization.
 */
export async function listWebhookSubscriptions(
  userId: string,
  scope: { projectId?: string; orgId?: string },
) {
  // The signing secret is returned once, at creation — never in listings.
  const { secret: _secret, ...columns } = getTableColumns(webhookSubscription);
  if (scope.projectId) {
    const p = await requireProjectCapability(
      userId,
      scope.projectId,
      "manage_project_settings",
    );
    return db
      .select(columns)
      .from(webhookSubscription)
      .where(
        or(
          eq(webhookSubscription.projectId, p.projectId),
          and(
            eq(webhookSubscription.orgId, p.orgId),
            isNull(webhookSubscription.projectId),
          ),
        ),
      )
      .orderBy(desc(webhookSubscription.createdAt));
  }

  if (scope.orgId) {
    await requireCapability(userId, scope.orgId, "manage_org_settings");
    return db
      .select(columns)
      .from(webhookSubscription)
      .where(eq(webhookSubscription.orgId, scope.orgId))
      .orderBy(desc(webhookSubscription.createdAt));
  }

  throw new ValidationError("Pass projectId or orgId to list webhooks");
}

/**
 * Gets a specific webhook subscription.
 */
export async function getWebhookSubscription(
  userId: string,
  subscriptionId: string,
): Promise<WebhookSubscription> {
  const [sub] = await db
    .select()
    .from(webhookSubscription)
    .where(eq(webhookSubscription.id, subscriptionId))
    .limit(1);

  if (!sub) throw new NotFoundError("Webhook subscription not found");

  if (sub.projectId) {
    await requireProjectCapability(
      userId,
      sub.projectId,
      "manage_project_settings",
    );
  } else {
    await requireCapability(userId, sub.orgId, "manage_org_settings");
  }

  return sub;
}

const webhookPatchSchema = webhookInputSchema
  .pick({ name: true, url: true, events: true, active: true })
  .partial();

/**
 * Edits an endpoint or pauses/resumes it (`active`). The signing secret is deliberately not
 * editable here — rotating it means deleting and re-adding, so the receiver is never left guessing
 * which secret is live.
 */
export async function updateWebhookSubscription(
  userId: string,
  subscriptionId: string,
  rawPatch: z.input<typeof webhookPatchSchema>,
): Promise<{ success: boolean }> {
  const sub = await getWebhookSubscription(userId, subscriptionId);
  const patch = webhookPatchSchema.parse(rawPatch);
  if (patch.url !== undefined) validateWebhookUrl(patch.url);
  if (Object.keys(patch).length === 0)
    throw new ValidationError("Nothing to change");

  await db
    .update(webhookSubscription)
    .set({
      ...patch,
      events: patch.events as WebhookEventType[] | undefined,
    })
    .where(eq(webhookSubscription.id, sub.id));

  const paused = patch.active !== undefined && patch.active !== sub.active;
  await recordAudit(db, {
    orgId: sub.orgId,
    projectId: sub.projectId,
    actorId: userId,
    action: paused
      ? patch.active
        ? "webhook.resumed"
        : "webhook.paused"
      : "webhook.updated",
    targetType: "webhook",
    targetId: sub.id,
    targetLabel: patch.name ?? sub.name,
    detail: { changed: Object.keys(patch) }, // never the URL's query string or the secret
  });
  return { success: true };
}

/**
 * Deletes a webhook subscription.
 */
export async function deleteWebhookSubscription(
  userId: string,
  subscriptionId: string,
): Promise<{ success: boolean }> {
  const sub = await getWebhookSubscription(userId, subscriptionId);

  await db
    .delete(webhookSubscription)
    .where(eq(webhookSubscription.id, sub.id));
  await recordAudit(db, {
    orgId: sub.orgId,
    projectId: sub.projectId,
    actorId: userId,
    action: "webhook.deleted",
    targetType: "webhook",
    targetId: sub.id,
    targetLabel: sub.name,
  });

  return { success: true };
}

/**
 * Dispatches an event to all subscribed webhooks.
 * Runs asynchronously and never throws so caller operations remain resilient.
 */
export async function dispatchWebhookEvent(
  event: WebhookEventType,
  payload: Record<string, unknown>,
  scope: { projectId?: string; orgId: string },
): Promise<{ dispatchedCount: number }> {
  try {
    const subs = await db
      .select()
      .from(webhookSubscription)
      .where(
        and(
          eq(webhookSubscription.orgId, scope.orgId),
          eq(webhookSubscription.active, true),
        ),
      );

    const eligible = subs.filter((s) => {
      // Check event match
      if (!s.events.includes(event)) return false;
      // Check project match if subscription is project-scoped
      if (s.projectId && scope.projectId && s.projectId !== scope.projectId) {
        return false;
      }
      return true;
    });

    if (eligible.length === 0) return { dispatchedCount: 0 };

    const eventPayload = {
      event,
      timestamp: new Date().toISOString(),
      projectId: scope.projectId,
      orgId: scope.orgId,
      data: payload,
    };

    const bodyString = JSON.stringify(eventPayload);

    // Deliver to each endpoint asynchronously
    await Promise.allSettled(
      eligible.map(async (sub) => {
        const start = Date.now();
        const signature = computeWebhookSignature(bodyString, sub.secret);

        let statusCode: number | null = null;
        let errorMessage: string | null = null;
        let status: "success" | "failed" = "failed";

        let outboundBody = bodyString;
        if (sub.url.includes("hooks.slack.com")) {
          outboundBody = JSON.stringify(formatSlackMessage(event, payload));
        } else if (sub.url.includes("discord.com/api/webhooks")) {
          outboundBody = JSON.stringify(formatDiscordMessage(event, payload));
        }

        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);

          const res = await fetch(sub.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "ProjectOS-Webhook-Dispatcher/1.0",
              "X-ProjectOS-Event": event,
              "X-ProjectOS-Signature-256": signature,
            },
            body: outboundBody,
            signal: controller.signal,
          });
          clearTimeout(timer);

          statusCode = res.status;
          status = res.ok ? "success" : "failed";
          if (!res.ok) {
            errorMessage = `HTTP status ${res.status}: ${res.statusText}`;
          }
        } catch (err) {
          status = "failed";
          errorMessage =
            err instanceof Error ? err.message : "Network delivery error";
        }

        const durationMs = Date.now() - start;

        // Record delivery audit
        try {
          await db.insert(webhookDelivery).values({
            subscriptionId: sub.id,
            eventType: event,
            payload: eventPayload,
            statusCode: statusCode ?? undefined,
            durationMs,
            status,
            errorMessage: errorMessage ?? undefined,
          });
        } catch (auditErr) {
          console.warn("Failed to record webhook delivery audit:", auditErr);
        }
      }),
    );

    return { dispatchedCount: eligible.length };
  } catch (dispatchErr) {
    console.warn("Failed in dispatchWebhookEvent loop:", dispatchErr);
    return { dispatchedCount: 0 };
  }
}

/**
 * Sends a test 'ping' event to a webhook endpoint.
 */
export async function testWebhookSubscription(
  userId: string,
  subscriptionId: string,
): Promise<{
  success: boolean;
  statusCode?: number | null;
  durationMs: number;
  message: string;
}> {
  const sub = await getWebhookSubscription(userId, subscriptionId);

  const start = Date.now();
  const testPayload = {
    event: "ping",
    timestamp: new Date().toISOString(),
    projectId: sub.projectId,
    orgId: sub.orgId,
    data: {
      message: "Project OS Webhook connectivity test",
      subscriptionId: sub.id,
      subscriptionName: sub.name,
    },
  };

  const bodyString = JSON.stringify(testPayload);
  const signature = computeWebhookSignature(bodyString, sub.secret);

  let statusCode: number | null = null;
  let errorMsg: string | null = null;
  let success = false;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(sub.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ProjectOS-Webhook-Dispatcher/1.0",
        "X-ProjectOS-Event": "ping",
        "X-ProjectOS-Signature-256": signature,
      },
      body: bodyString,
      signal: controller.signal,
    });
    clearTimeout(timer);

    statusCode = res.status;
    success = res.ok;
    if (!res.ok) {
      errorMsg = `HTTP status ${res.status}: ${res.statusText}`;
    }
  } catch (err) {
    success = false;
    errorMsg = err instanceof Error ? err.message : "Connection failed";
  }

  const durationMs = Date.now() - start;

  await db.insert(webhookDelivery).values({
    subscriptionId: sub.id,
    eventType: "ping",
    payload: testPayload,
    statusCode: statusCode ?? undefined,
    durationMs,
    status: success ? "success" : "failed",
    errorMessage: errorMsg ?? undefined,
  });

  return {
    success,
    statusCode,
    durationMs,
    message: success
      ? `Ping delivered successfully in ${durationMs}ms (HTTP ${statusCode})`
      : `Ping failed: ${errorMsg}`,
  };
}

/**
 * Lists the latest delivery records for a webhook subscription.
 */
export async function listWebhookDeliveries(
  userId: string,
  subscriptionId: string,
  limit = 20,
): Promise<WebhookDelivery[]> {
  await getWebhookSubscription(userId, subscriptionId);

  return db
    .select()
    .from(webhookDelivery)
    .where(eq(webhookDelivery.subscriptionId, subscriptionId))
    .orderBy(desc(webhookDelivery.deliveredAt))
    .limit(limit);
}
