import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { db } from "@/db";
import { user } from "@/db/schema";

// A real-looking domain: reserved test domains (.local/.test) are never "sent" by sendEmail.
const email = `verify-${Date.now()}@captap-verification-test.dev`;
const password = "Verify-Pass-Word-1234!";
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
  ok: true,
  json: async () => ({ id: "email-1" }),
}));
const resendBodies = () =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).includes("api.resend.com"))
    .map(([, init]) => JSON.parse(String(init?.body)));

let auth: typeof import("./auth").auth;

beforeAll(async () => {
  vi.stubEnv("REQUIRE_EMAIL_VERIFICATION", "1");
  vi.stubEnv("RESEND_API_KEY", "re_test_not_a_real_key");
  vi.stubGlobal("fetch", fetchMock); // the DB driver uses websockets, so only Resend calls land here
  vi.resetModules();
  ({ auth } = await import("./auth"));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  await db.delete(user).where(eq(user.email, email));
});

test("with verification on, sign-up creates no session and emails a confirmation link", async () => {
  const res = await auth.api.signUpEmail({
    body: { email, password, name: "Verify Me" },
  });
  expect(res.token).toBeNull();
  const [sent] = resendBodies();
  expect(sent.to).toEqual([email]);
  expect(sent.subject).toMatch(/Confirm your email/);
  expect(sent.text).toMatch(/verify-email\?token=/);
});

test("an unverified account can't sign in, and gets a fresh link instead of being stuck", async () => {
  fetchMock.mockClear();
  await expect(
    auth.api.signInEmail({ body: { email, password } }),
  ).rejects.toThrow(/not verified/i);
  expect(resendBodies()).toHaveLength(1);
  expect(resendBodies()[0].to).toEqual([email]);
});

test("the server refuses to start with verification on but no way to send email", async () => {
  vi.stubEnv("RESEND_API_KEY", "");
  vi.resetModules();
  await expect(import("./auth")).rejects.toThrow(/needs RESEND_API_KEY/);
});
