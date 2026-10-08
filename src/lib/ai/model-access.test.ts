import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from "vitest";
import { db } from "@/db";
import {
  agentExecutionTelemetry,
  aiProviderKey,
  orgAiSettings,
} from "@/db/schema";
import { listAuditEvents } from "../audit";
import { ForbiddenError } from "../errors";
import { SecretsUnavailableError } from "../secrets";
import { fixtures } from "../test-fixtures";
import {
  AiAccessError,
  aiProviderStatus,
  describeModelAccess,
  removeProviderKey,
  resolveModelAccess,
  saveProviderKey,
  setAiDefaults,
} from "./model-access";

const f = fixtures();
let owner: string;
let member: string;
let org: string;

const ENV_KEYS = [
  "CAPTAP_CLOUD",
  "GROQ_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "AI_UNVERIFIED_PROVIDERS",
  "SECRETS_ENCRYPTION_KEY",
] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  owner = await f.user("ai-owner");
  member = await f.user("ai-member");
  org = await f.org("ai", { [owner]: "owner", [member]: "member" });
});
afterAll(async () => {
  await f.cleanup();
});
beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await db.delete(aiProviderKey).where(eq(aiProviderKey.orgId, org));
  await db.delete(orgAiSettings).where(eq(orgAiSettings.orgId, org)); // plan/defaults must not leak between tests
  await db
    .delete(agentExecutionTelemetry)
    .where(eq(agentExecutionTelemetry.orgId, org));
});

const listOk = (ids: string[]) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), {
          status: 200,
        }),
    ),
  );

const spend = (usd: string, keySource = "platform", createdAt?: Date) =>
  db.insert(agentExecutionTelemetry).values({
    orgId: org,
    modelProvider: "groq",
    modelName: "openai/gpt-oss-120b",
    estimatedCostUsd: usd,
    keySource,
    ...(createdAt && { createdAt }),
  });

test("self-hosted: the instance's env key is used for everyone, uncapped; no key means a clear error", async () => {
  process.env.GROQ_API_KEY = "instance-groq-key";
  const a = await resolveModelAccess(org);
  expect(a).toMatchObject({
    provider: "groq",
    model: "openai/gpt-oss-120b",
    keySource: "platform",
    apiKey: "instance-groq-key",
  });
  await spend("999.000000"); // spend is irrelevant when self-hosted
  await expect(resolveModelAccess(org)).resolves.toBeTruthy();

  delete process.env.GROQ_API_KEY;
  await expect(resolveModelAccess(org)).rejects.toThrow(/Connect a Groq key/);
});

test("an org's own key beats the platform key, is decrypted server-side, and is not metered by us", async () => {
  process.env.AI_UNVERIFIED_PROVIDERS = "openai";
  process.env.GROQ_API_KEY = "instance-groq-key";
  listOk(["gpt-5-mini", "text-embedding-3-small"]);
  const r = await saveProviderKey(owner, org, "openai", "sk-org-secret-9999");
  expect(r.keyHint).toBe("9999");
  expect(r.models.map((m) => m.id)).toEqual(["gpt-5-mini"]); // embeddings filtered out

  const a = await resolveModelAccess(org, {
    provider: "openai",
    model: "gpt-5-mini",
  });
  expect(a).toMatchObject({
    provider: "openai",
    model: "gpt-5-mini",
    keySource: "org",
    apiKey: "sk-org-secret-9999",
  });
});

test("there is never a silent substitute: asking for a provider you can't use fails, it does not answer with Groq", async () => {
  process.env.GROQ_API_KEY = "instance-groq-key";
  process.env.AI_UNVERIFIED_PROVIDERS = "openai";
  await expect(
    resolveModelAccess(org, { provider: "openai", model: "gpt-5-mini" }),
  ).rejects.toThrow(/Connect an? OpenAI key/);
  // a provider that isn't verified yet is not selectable at all
  await expect(
    resolveModelAccess(org, { provider: "cohere", model: "command-r" }),
  ).rejects.toThrow(/not enabled/);
  delete process.env.AI_UNVERIFIED_PROVIDERS;
  await expect(
    resolveModelAccess(org, { provider: "openai", model: "gpt-5-mini" }),
  ).rejects.toThrow(/not enabled/);
});

test("cloud, free plan: one platform model only, and only within the monthly budget", async () => {
  process.env.CAPTAP_CLOUD = "1";
  process.env.GROQ_API_KEY = "captap-groq-key";
  const ok = await resolveModelAccess(org);
  expect(ok).toMatchObject({
    keySource: "platform",
    model: "openai/gpt-oss-120b",
  });

  await expect(
    resolveModelAccess(org, { provider: "groq", model: "openai/gpt-oss-20b" }),
  ).rejects.toThrow(/free plan/i);
  await expect(
    resolveModelAccess(org, { provider: "groq", model: "not-a-real-model" }),
  ).rejects.toThrow(/isn't available/);

  await spend("0.499999");
  await expect(resolveModelAccess(org)).resolves.toBeTruthy(); // just under $0.50
  await spend("0.000002");
  await expect(resolveModelAccess(org)).rejects.toThrow(/monthly AI allowance/);
});

test("the budget counts platform usage this month only, not the org's own keys or last month", async () => {
  process.env.CAPTAP_CLOUD = "1";
  process.env.GROQ_API_KEY = "captap-groq-key";
  await spend("40.000000", "org"); // their own key: not our cost
  const lastMonth = new Date();
  lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
  await spend("40.000000", "platform", lastMonth);
  await expect(resolveModelAccess(org)).resolves.toBeTruthy();
});

test("cloud, paid plan: the whole platform catalog, up to $15", async () => {
  process.env.CAPTAP_CLOUD = "1";
  process.env.GROQ_API_KEY = "captap-groq-key";
  process.env.ANTHROPIC_API_KEY = "captap-anthropic-key";
  process.env.AI_UNVERIFIED_PROVIDERS = "anthropic";
  await setAiDefaults(owner, org, {}); // creates the settings row
  await db.execute(
    (await import("drizzle-orm"))
      .sql`update org_ai_settings set plan = 'paid' where org_id = ${org}`,
  );
  const a = await resolveModelAccess(org, {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
  });
  expect(a).toMatchObject({
    provider: "anthropic",
    keySource: "platform",
    apiKey: "captap-anthropic-key",
  });
  await spend("15.000000");
  await expect(
    resolveModelAccess(org, {
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
    }),
  ).rejects.toThrow(/\$15/);
  // ...but their own key still works when the allowance is gone
  process.env.AI_UNVERIFIED_PROVIDERS = "anthropic,openai";
  listOk(["gpt-5-mini"]);
  await saveProviderKey(owner, org, "openai", "sk-own-key-1234");
  await expect(
    resolveModelAccess(org, { provider: "openai", model: "gpt-5-mini" }),
  ).resolves.toMatchObject({ keySource: "org" });
});

test("saving a key: permission, server secret, live validation, and nothing readable stored", async () => {
  process.env.AI_UNVERIFIED_PROVIDERS = "openai";
  listOk(["gpt-5-mini"]);
  await expect(
    saveProviderKey(member, org, "openai", "sk-x-1111111"),
  ).rejects.toBeInstanceOf(ForbiddenError);

  delete process.env.SECRETS_ENCRYPTION_KEY;
  await expect(
    saveProviderKey(owner, org, "openai", "sk-x-1111111"),
  ).rejects.toBeInstanceOf(SecretsUnavailableError);
  process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("bad key sk-bad-2222222", { status: 401 })),
  );
  await expect(
    saveProviderKey(owner, org, "openai", "sk-bad-2222222"),
  ).rejects.toThrow(/rejected this key/);
  expect(
    await db.select().from(aiProviderKey).where(eq(aiProviderKey.orgId, org)),
  ).toHaveLength(0);

  listOk(["gpt-5-mini"]);
  await saveProviderKey(owner, org, "openai", "sk-good-secret-3333");
  await saveProviderKey(owner, org, "openai", "sk-newer-secret-4444"); // replace, not duplicate
  const rows = await db
    .select()
    .from(aiProviderKey)
    .where(eq(aiProviderKey.orgId, org));
  expect(rows).toHaveLength(1);
  expect(rows[0].keyHint).toBe("4444");
  expect(JSON.stringify(rows)).not.toContain("secret");

  const status = await aiProviderStatus(owner, org);
  expect(JSON.stringify(status)).not.toContain("sk-");
  expect(status.find((s) => s.provider === "openai")).toMatchObject({
    connected: "org",
    keyHint: "4444",
  });

  await removeProviderKey(owner, org, "openai");
  expect(
    await db.select().from(aiProviderKey).where(eq(aiProviderKey.orgId, org)),
  ).toHaveLength(0);
});

test("key changes are audited without the key", async () => {
  process.env.AI_UNVERIFIED_PROVIDERS = "openai";
  listOk(["gpt-5-mini"]);
  await saveProviderKey(owner, org, "openai", "sk-audit-secret-5555");
  await removeProviderKey(owner, org, "openai");
  await setAiDefaults(owner, org, {
    provider: "groq",
    model: "openai/gpt-oss-120b",
  });
  // the log is append-only, so earlier tests' events are still here: look at this test's key only
  const events = (
    await listAuditEvents(owner, org, { area: "ai", limit: 100 })
  ).filter((e) => (e.detail as { hint?: string }).hint === "5555");
  expect(events.map((e) => e.action).sort()).toEqual([
    "ai.key_removed",
    "ai.key_saved",
  ]);
  expect(JSON.stringify(events)).not.toContain("sk-audit");
  expect(events.find((e) => e.action === "ai.key_saved")?.detail).toMatchObject(
    { provider: "openai", hint: "5555" },
  );
  expect(
    (await listAuditEvents(owner, org, { area: "ai", limit: 50 })).some(
      (e) => e.action === "ai.settings_changed",
    ),
  ).toBe(true);
});

test("defaults must be a real, enabled provider; only key managers can change them", async () => {
  await expect(
    setAiDefaults(member, org, { provider: "groq", model: "x" }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  await expect(
    setAiDefaults(owner, org, { provider: "openai", model: "gpt-5-mini" }),
  ).rejects.toBeInstanceOf(AiAccessError);
  await expect(
    setAiDefaults(owner, org, { provider: "nope", model: "x" }),
  ).rejects.toBeInstanceOf(AiAccessError);
  process.env.GROQ_API_KEY = "k";
  await setAiDefaults(owner, org, {
    provider: "groq",
    model: "openai/gpt-oss-20b",
  });
  expect(await resolveModelAccess(org)).toMatchObject({
    provider: "groq",
    model: "openai/gpt-oss-20b",
  });
});

test("describeModelAccess tells any member what is usable: plan models only, no key material, no unverified providers", async () => {
  process.env.CAPTAP_CLOUD = "1";
  process.env.GROQ_API_KEY = "instance-key-abc123";
  process.env.ANTHROPIC_API_KEY = "instance-anthropic-key"; // set, but anthropic is not verified/enabled
  const d = await describeModelAccess(member, org);
  expect(d).toMatchObject({ cloud: true, plan: "free", budgetUsd: 0.5 });
  expect(
    d.platformModels.filter((m) => m.includedInPlan).map((m) => m.id),
  ).toEqual(["openai/gpt-oss-120b"]);
  expect(
    d.platformModels.find((m) => m.id === "openai/gpt-oss-20b")?.includedInPlan,
  ).toBe(false);
  expect(d.platformModels.some((m) => m.provider === "anthropic")).toBe(false);
  expect(JSON.stringify(d)).not.toContain("instance-");
  delete process.env.CAPTAP_CLOUD;
  expect((await describeModelAccess(member, org)).budgetUsd).toBeNull(); // self-hosted: no budget
});
