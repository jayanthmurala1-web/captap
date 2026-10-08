import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { connection } from "@/db/schema";
import { NotFoundError, requireCapability, requireMember } from "./access";
import { ConflictError, isUniqueViolation, ValidationError } from "./errors";
import { decryptSecret, encryptSecret } from "./secrets";

export type ConnectionKind = (typeof connection.$inferSelect)["kind"];

const aad = (orgId: string, id: string) => `${orgId}:${id}`;
const hint = (secret: string) => secret.slice(-4);

/** Every live check is real: a bad token/URL/server is rejected here, before anything is stored. */
async function verify(
  kind: ConnectionKind,
  input: { url?: string; secret?: string },
) {
  if (kind === "slack_webhook") {
    if (!input.secret) throw new ValidationError("Webhook URL is required");
    const res = await fetch(input.secret, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Captap connected to this channel." }),
    });
    if (!res.ok)
      throw new ValidationError(
        `Slack rejected the webhook: ${res.status} ${await res.text()}`,
      );
    return;
  }
  if (kind === "github_pat") {
    if (!input.secret) throw new ValidationError("Token is required");
    const res = await fetch("https://api.github.com/user", {
      headers: { authorization: `Bearer ${input.secret}` },
    });
    if (!res.ok)
      throw new ValidationError(`GitHub rejected the token: ${res.status}`);
    return;
  }
  if (kind === "custom_mcp") {
    if (!input.url) throw new ValidationError("Server URL is required");
    const client = new Client({ name: "captap", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(input.url), {
      requestInit: input.secret
        ? { headers: { authorization: `Bearer ${input.secret}` } }
        : undefined,
    });
    try {
      await client.connect(transport);
    } catch (e) {
      throw new ValidationError(
        `Could not reach that MCP server: ${(e as Error).message}`,
      );
    } finally {
      await client.close().catch(() => {});
    }
  }
}

export async function listConnections(userId: string, orgId: string) {
  await requireMember(userId, orgId);
  const rows = await db
    .select({
      id: connection.id,
      kind: connection.kind,
      label: connection.label,
      url: connection.url,
      secretHint: connection.secretHint,
      createdAt: connection.createdAt,
      verifiedAt: connection.verifiedAt,
    })
    .from(connection)
    .where(eq(connection.orgId, orgId))
    .orderBy(desc(connection.createdAt));
  return rows;
}

/** Shared by the manual form (after `verify()`) and the OAuth callbacks (already proven live by
 * the provider's own token exchange — re-POSTing to Slack here would just send a duplicate message). */
async function storeConnection(
  userId: string,
  orgId: string,
  input: { kind: ConnectionKind; label: string; url?: string; secret?: string },
) {
  const id = crypto.randomUUID();
  const secret = input.secret?.trim();
  try {
    const [row] = await db
      .insert(connection)
      .values({
        id,
        orgId,
        kind: input.kind,
        label: input.label.trim(),
        url: input.kind === "custom_mcp" ? input.url?.trim() : undefined,
        ciphertext: secret ? encryptSecret(secret, aad(orgId, id)) : undefined,
        secretHint: secret ? hint(secret) : undefined,
        createdBy: userId,
        verifiedAt: new Date(),
      })
      .returning();
    return row;
  } catch (e) {
    if (isUniqueViolation(e))
      throw new ConflictError(
        `A ${input.kind.replace("_", " ")} connection named "${input.label}" already exists`,
      );
    throw e;
  }
}

export async function createConnection(
  userId: string,
  orgId: string,
  input: {
    kind: ConnectionKind;
    label: string;
    url?: string;
    secret?: string;
  },
) {
  await requireCapability(userId, orgId, "manage_org_settings");
  if (!input.label.trim()) throw new ValidationError("Label is required");
  await verify(input.kind, { url: input.url, secret: input.secret });
  return storeConnection(userId, orgId, input);
}

/** Called only from the OAuth callback routes, after a real token exchange with the provider —
 * that exchange is the live check, so this skips `verify()` (and skips re-posting to Slack). */
export async function storeOAuthConnection(
  userId: string,
  orgId: string,
  input: {
    kind: "slack_webhook" | "github_pat";
    label: string;
    secret: string;
  },
) {
  await requireCapability(userId, orgId, "manage_org_settings");
  return storeConnection(userId, orgId, input);
}

/** Rotating a secret (e.g. a leaked Slack webhook or an expired GitHub token) used to mean
 * delete-and-recreate, losing the row's id/createdAt and leaving the integration dead in between.
 * Re-verifies live exactly like createConnection when a new secret/url is actually provided. */
export async function updateConnection(
  userId: string,
  id: string,
  input: { label?: string; url?: string; secret?: string },
) {
  const [row] = await db.select().from(connection).where(eq(connection.id, id));
  if (!row) throw new NotFoundError("Connection not found");
  await requireCapability(userId, row.orgId, "manage_org_settings");

  const label = input.label?.trim() || row.label;
  if (!label) throw new ValidationError("Label is required");
  const url = input.url?.trim() ?? row.url ?? undefined;
  const secret = input.secret?.trim();

  if (secret || (row.kind === "custom_mcp" && input.url !== undefined)) {
    await verify(row.kind, { url, secret });
  }

  try {
    const [updated] = await db
      .update(connection)
      .set({
        label,
        url: row.kind === "custom_mcp" ? url : undefined,
        ...(secret || input.url !== undefined
          ? { verifiedAt: new Date() }
          : {}),
        ...(secret
          ? {
              ciphertext: encryptSecret(secret, aad(row.orgId, row.id)),
              secretHint: hint(secret),
            }
          : {}),
      })
      .where(eq(connection.id, id))
      .returning();
    return updated;
  } catch (e) {
    if (isUniqueViolation(e))
      throw new ConflictError(
        `A ${row.kind.replace("_", " ")} connection named "${label}" already exists`,
      );
    throw e;
  }
}

/** Re-runs the live check against what's stored, so "connected" reflects now rather than the day it
 * was added. A failure throws and leaves verifiedAt alone — the UI then shows how stale it is.
 * Slack webhooks are excluded: the only way to test one is to post a message to the channel. */
export async function checkConnection(userId: string, id: string) {
  const [row] = await db.select().from(connection).where(eq(connection.id, id));
  if (!row) throw new NotFoundError("Connection not found");
  await requireCapability(userId, row.orgId, "manage_org_settings");
  if (row.kind === "slack_webhook")
    throw new ValidationError(
      "Slack webhooks can only be tested by posting to the channel",
    );
  await verify(row.kind, {
    url: row.url ?? undefined,
    secret: row.ciphertext
      ? decryptSecret(row.ciphertext, aad(row.orgId, row.id))
      : undefined,
  });
  const [updated] = await db
    .update(connection)
    .set({ verifiedAt: new Date() })
    .where(eq(connection.id, id))
    .returning({ verifiedAt: connection.verifiedAt });
  return updated;
}

export async function deleteConnection(userId: string, id: string) {
  const [row] = await db.select().from(connection).where(eq(connection.id, id));
  if (!row) throw new NotFoundError("Connection not found");
  await requireCapability(userId, row.orgId, "manage_org_settings");
  await db.delete(connection).where(eq(connection.id, id));
  return row;
}

/**
 * Posts to every Slack channel the org connected — each one is a channel they chose on purpose.
 * (An earlier `.limit(1)` with no ORDER BY picked an arbitrary one once an org had two.)
 * Best-effort: never throws into the caller, and one dead webhook never blocks the others.
 */
export async function notifySlack(orgId: string, text: string) {
  let rows: { id: string; ciphertext: string | null }[];
  try {
    rows = await db
      .select({ id: connection.id, ciphertext: connection.ciphertext })
      .from(connection)
      .where(
        and(eq(connection.orgId, orgId), eq(connection.kind, "slack_webhook")),
      )
      .orderBy(connection.createdAt);
  } catch (e) {
    console.error("could not load Slack connections:", e);
    return;
  }
  await Promise.all(
    rows.map(async (row) => {
      if (!row.ciphertext) return;
      try {
        await fetch(decryptSecret(row.ciphertext, aad(orgId, row.id)), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
      } catch (e) {
        console.error("could not post to Slack:", e);
      }
    }),
  );
}
