import { randomUUID } from "node:crypto";
import { like } from "drizzle-orm";
import { afterAll, expect, test, vi } from "vitest";
import { db } from "@/db";
import { rateLimit } from "@/db/schema";
import { hit } from "./rate-limit";

const run = randomUUID().slice(0, 8);
const key = (n: string) => `test:${run}:${n}`;

afterAll(async () => {
  await db.delete(rateLimit).where(like(rateLimit.key, `test:${run}:%`));
});

test("allows exactly `max` calls per window, then blocks with a retry time", async () => {
  const k = key("basic");
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await hit(k, 3, 60));
  expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
  expect(results[3].retryAfter).toBeGreaterThan(0);
  expect(results[3].retryAfter).toBeLessThanOrEqual(60);
});

test("keys are independent", async () => {
  await hit(key("a"), 1, 60);
  expect((await hit(key("a"), 1, 60)).ok).toBe(false);
  expect((await hit(key("b"), 1, 60)).ok).toBe(true);
});

test("the window resets", async () => {
  const k = key("reset");
  expect((await hit(k, 1, 1)).ok).toBe(true);
  expect((await hit(k, 1, 1)).ok).toBe(false);
  await new Promise((r) => setTimeout(r, 1200));
  expect((await hit(k, 1, 1)).ok).toBe(true);
});

test("parallel calls cannot slip past the limit", async () => {
  const k = key("parallel");
  const results = await Promise.all(
    Array.from({ length: 10 }, () => hit(k, 5, 60)),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(5);
});

test("if the limiter's own database call fails, the request is allowed and the error is logged", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const insert = vi.spyOn(db, "insert").mockImplementation(() => {
    throw new Error("db down");
  });
  const r = await hit(key("down"), 1, 60);
  insert.mockRestore();
  expect(r.ok).toBe(true);
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});
