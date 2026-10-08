import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimit } from "@/db/schema";

/** Every limit in one place. Per user id when signed in, else per IP. */
export const LIMITS = {
  mcp: { max: 120, windowSec: 60 },
  consult: { max: 20, windowSec: 60 }, // each call spends model budget
  api: { max: 120, windowSec: 60 },
  stream: { max: 12, windowSec: 60 }, // connects to the live task stream
  upload: { max: 30, windowSec: 60 },
  approve: { max: 10, windowSec: 60 * 60 }, // the public, no-account client form
} as const;

export type LimitName = keyof typeof LIMITS;

/**
 * Counts one request against `key` in a fixed window, atomically (one statement), so parallel
 * requests can't both slip under the limit. If the database call itself fails the request is
 * allowed and the error is logged: a limiter outage must not take the product down.
 */
export async function hit(key: string, max: number, windowSec: number) {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  try {
    const expired = sql`${rateLimit.lastRequest} <= ${now - windowMs}`;
    const [row] = await db
      .insert(rateLimit)
      .values({ id: randomUUID(), key, count: 1, lastRequest: now })
      .onConflictDoUpdate({
        target: rateLimit.key,
        set: {
          count: sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimit.count} + 1 END`,
          lastRequest: sql`CASE WHEN ${expired} THEN ${now} ELSE ${rateLimit.lastRequest} END`,
        },
      })
      .returning({ count: rateLimit.count, start: rateLimit.lastRequest });
    if (row.count <= max) return { ok: true, retryAfter: 0 };
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((row.start + windowMs - now) / 1000)),
    };
  } catch (e) {
    console.error("rate limiter unavailable, allowing request:", e);
    return { ok: true, retryAfter: 0 };
  }
}

export async function checkLimit(name: LimitName, subject: string) {
  const { max, windowSec } = LIMITS[name];
  return hit(`api:${name}:${subject}`, max, windowSec);
}

/** A 429 response when `subject` is over the `name` limit, else null. For route handlers. */
export async function limitResponse(name: LimitName, subject: string) {
  const r = await checkLimit(name, subject);
  if (r.ok) return null;
  return Response.json(
    { error: "rate_limited", retryAfter: r.retryAfter },
    { status: 429, headers: { "Retry-After": String(r.retryAfter) } },
  );
}

/** Best-effort client IP behind Vercel's proxy (it overwrites x-forwarded-for). */
export function clientIp(headers: Headers) {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}
