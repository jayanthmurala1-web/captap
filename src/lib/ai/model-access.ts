import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  agentExecutionTelemetry,
  aiProviderKey,
  orgAiSettings,
} from "@/db/schema";
import { requireCapability, requireMember } from "../access";
import { recordAudit } from "../audit";
import { DomainError } from "../errors";
import { decryptSecret, encryptSecret, secretsConfigured } from "../secrets";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_PROVIDER,
  PLANS,
  PLATFORM_MODELS,
  type Plan,
  platformModel,
} from "./catalog";
import {
  enabledProviders,
  envKey,
  isProvider,
  listProviderModels,
  PROVIDER_INFO,
  PROVIDERS,
  type Provider,
  scrub,
} from "./providers";

/** Something the user can fix (connect a key, wait for the allowance, pick another model). */
export class AiAccessError extends DomainError {}

export type ModelAccess = {
  provider: Provider;
  model: string;
  apiKey: string;
  /** org = their own key (their bill); platform = our key or the instance's env key. */
  keySource: "org" | "platform";
};

const isCloud = () => process.env.CAPTAP_CLOUD === "1";
const aad = (orgId: string, provider: string) => `${orgId}:${provider}`;
const label = (p: Provider) => PROVIDER_INFO[p].label;

export async function getAiSettings(orgId: string) {
  const [row] = await db
    .select()
    .from(orgAiSettings)
    .where(eq(orgAiSettings.orgId, orgId));
  return {
    plan: (row?.plan === "paid" ? "paid" : "free") as Plan,
    defaultProvider: row?.defaultProvider ?? null,
    defaultModel: row?.defaultModel ?? null,
  };
}

/** USD of platform-key usage this calendar month (UTC). Their own keys are not our cost and never count. */
export async function platformSpendThisMonth(orgId: string) {
  const [row] = await db
    .select({
      usd: sql<string>`coalesce(sum(${agentExecutionTelemetry.estimatedCostUsd}::numeric), 0)`,
    })
    .from(agentExecutionTelemetry)
    .where(
      and(
        eq(agentExecutionTelemetry.orgId, orgId),
        eq(agentExecutionTelemetry.keySource, "platform"),
        sql`${agentExecutionTelemetry.createdAt} >= date_trunc('month', now() at time zone 'utc')`,
      ),
    );
  return Number(row?.usd ?? 0);
}

/**
 * Decides which provider, model and key a call uses (spec 021). It either returns exactly what was
 * asked for or throws a message the user can act on. It never falls back to a different provider.
 */
export async function resolveModelAccess(
  orgId: string,
  req: { provider?: string; model?: string } = {},
): Promise<ModelAccess> {
  const settings = await getAiSettings(orgId);
  const providerName =
    req.provider ?? settings.defaultProvider ?? DEFAULT_PROVIDER;
  if (!isProvider(providerName))
    throw new AiAccessError(`Unknown provider "${providerName}".`);
  const provider = providerName;
  if (!enabledProviders().includes(provider))
    throw new AiAccessError(
      `${label(provider)} is not enabled yet: it has not been verified with a real key on this server.`,
    );

  const model =
    req.model ??
    (provider === settings.defaultProvider ? settings.defaultModel : null) ??
    (provider === DEFAULT_PROVIDER ? DEFAULT_MODEL_ID : null) ??
    PLATFORM_MODELS.find((m) => m.provider === provider)?.id;
  if (!model) throw new AiAccessError(`Choose a ${label(provider)} model.`);

  // 1. The org's own key: their bill, no cap, any plan.
  const [own] = await db
    .select({ ciphertext: aiProviderKey.ciphertext })
    .from(aiProviderKey)
    .where(
      and(eq(aiProviderKey.orgId, orgId), eq(aiProviderKey.provider, provider)),
    );
  if (own) {
    try {
      return {
        provider,
        model,
        apiKey: decryptSecret(own.ciphertext, aad(orgId, provider)),
        keySource: "org",
      };
    } catch {
      throw new AiAccessError(
        `The saved ${label(provider)} key can't be read. Enter it again in AI settings.`,
      );
    }
  }

  const instanceKey = envKey(provider);
  const connect = `Connect ${/^[aeiou]/i.test(label(provider)) ? "an" : "a"} ${label(provider)} key in AI settings to use ${label(provider)}.`;

  // 2. Self-hosted: the operator's own keys, uncapped (they pay).
  if (!isCloud()) {
    if (!instanceKey) throw new AiAccessError(connect);
    return { provider, model, apiKey: instanceKey, keySource: "platform" };
  }

  // 3. Cloud: Captap's key, within the plan.
  const m = platformModel(provider, model);
  if (!instanceKey || !m)
    throw new AiAccessError(
      m || !instanceKey
        ? connect
        : `${model} isn't available on Captap's keys. Pick one of the included models or connect your own ${label(provider)} key in AI settings.`,
    );
  const plan = PLANS[settings.plan];
  if (plan.models !== "all" && !plan.models.includes(model))
    throw new AiAccessError(
      `The ${settings.plan} plan includes ${plan.models
        .map((id) => platformModel("groq", id)?.name ?? id)
        .join(
          ", ",
        )}. Upgrade, or connect your own ${label(provider)} key in AI settings.`,
    );
  const spent = await platformSpendThisMonth(orgId);
  if (spent >= plan.budgetUsd)
    throw new AiAccessError(
      `You've used your $${plan.budgetUsd} monthly AI allowance. It resets on the 1st, or connect your own provider key in AI settings.`,
    );
  return { provider, model, apiKey: instanceKey, keySource: "platform" };
}

/** Remember how a key last did, so the settings page can say "rejected" instead of failing silently. */
export async function recordKeyOutcome(
  orgId: string,
  provider: Provider,
  error?: string,
) {
  await db
    .update(aiProviderKey)
    .set(
      error
        ? { lastError: error.slice(0, 300) }
        : { lastError: null, lastUsedAt: new Date() },
    )
    .where(
      and(eq(aiProviderKey.orgId, orgId), eq(aiProviderKey.provider, provider)),
    );
}

/** Validates the key against the provider, then stores it encrypted (replacing any earlier one). */
export async function saveProviderKey(
  userId: string,
  orgId: string,
  providerName: string,
  rawKey: string,
) {
  await requireCapability(userId, orgId, "manage_ai_keys");
  if (!isProvider(providerName))
    throw new AiAccessError(`Unknown provider "${providerName}".`);
  const provider = providerName;
  if (!enabledProviders().includes(provider))
    throw new AiAccessError(`${label(provider)} is not enabled yet.`);
  const key = rawKey.trim();
  if (key.length < 8)
    throw new AiAccessError("That doesn't look like an API key.");
  if (!secretsConfigured()) encryptSecret("x", "probe"); // throws the explanatory SecretsUnavailableError

  let models: { id: string }[];
  try {
    models = await listProviderModels(provider, key);
  } catch (e) {
    throw new AiAccessError(
      scrub(e instanceof Error ? e.message : String(e), key),
    );
  }

  const hint = key.slice(-4);
  const ciphertext = encryptSecret(key, aad(orgId, provider));
  await db
    .insert(aiProviderKey)
    .values({ orgId, provider, ciphertext, keyHint: hint, createdBy: userId })
    .onConflictDoUpdate({
      target: [aiProviderKey.orgId, aiProviderKey.provider],
      set: { ciphertext, keyHint: hint, lastError: null, lastUsedAt: null },
    });
  await recordAudit(db, {
    orgId,
    actorId: userId,
    action: "ai.key_saved",
    targetType: "ai_key",
    targetLabel: label(provider),
    detail: { provider, hint },
  });
  return { keyHint: hint, models };
}

export async function removeProviderKey(
  userId: string,
  orgId: string,
  provider: string,
) {
  await requireCapability(userId, orgId, "manage_ai_keys");
  const removed = await db
    .delete(aiProviderKey)
    .where(
      and(eq(aiProviderKey.orgId, orgId), eq(aiProviderKey.provider, provider)),
    )
    .returning({ hint: aiProviderKey.keyHint });
  if (removed.length)
    await recordAudit(db, {
      orgId,
      actorId: userId,
      action: "ai.key_removed",
      targetType: "ai_key",
      targetLabel: isProvider(provider) ? label(provider) : provider,
      detail: { provider, hint: removed[0].hint },
    });
}

export async function setAiDefaults(
  userId: string,
  orgId: string,
  patch: { provider?: string; model?: string },
) {
  await requireCapability(userId, orgId, "manage_ai_keys");
  if (patch.provider !== undefined) {
    if (!isProvider(patch.provider))
      throw new AiAccessError(`Unknown provider "${patch.provider}".`);
    if (!enabledProviders().includes(patch.provider))
      throw new AiAccessError(`${label(patch.provider)} is not enabled yet.`);
  }
  const values = {
    ...(patch.provider !== undefined && { defaultProvider: patch.provider }),
    ...(patch.model !== undefined && { defaultModel: patch.model }),
    updatedBy: userId,
  };
  await db
    .insert(orgAiSettings)
    .values({ orgId, ...values })
    .onConflictDoUpdate({ target: orgAiSettings.orgId, set: values });
  await recordAudit(db, {
    orgId,
    actorId: userId,
    action: "ai.settings_changed",
    targetType: "ai_settings",
    detail: { provider: patch.provider ?? null, model: patch.model ?? null },
  });
}

/** What the AI settings page shows: per provider, how (if at all) this org can use it. Never any key material. */
export async function aiProviderStatus(userId: string, orgId: string) {
  await requireCapability(userId, orgId, "manage_ai_keys");
  const rows = await db
    .select({
      provider: aiProviderKey.provider,
      keyHint: aiProviderKey.keyHint,
      lastUsedAt: aiProviderKey.lastUsedAt,
      lastError: aiProviderKey.lastError,
    })
    .from(aiProviderKey)
    .where(eq(aiProviderKey.orgId, orgId));
  const enabled = enabledProviders();
  return PROVIDERS.map((provider) => {
    const own = rows.find((r) => r.provider === provider);
    return {
      provider,
      label: label(provider),
      keyUrl: PROVIDER_INFO[provider].keyUrl,
      enabled: enabled.includes(provider),
      connected: own
        ? ("org" as const)
        : envKey(provider)
          ? ("platform" as const)
          : null,
      keyHint: own?.keyHint ?? null,
      lastUsedAt: own?.lastUsedAt ?? null,
      lastError: own?.lastError ?? null,
    };
  });
}

/**
 * What this org can actually call right now, and what it has used. Members can read it (it fills the
 * model picker); it carries no key material.
 */
export async function describeModelAccess(userId: string, orgId: string) {
  await requireMember(userId, orgId);
  const settings = await getAiSettings(orgId);
  const cloud = isCloud();
  const plan = PLANS[settings.plan];
  const [spent, own] = await Promise.all([
    platformSpendThisMonth(orgId),
    db
      .select({ provider: aiProviderKey.provider })
      .from(aiProviderKey)
      .where(eq(aiProviderKey.orgId, orgId)),
  ]);
  const enabled = enabledProviders();
  return {
    cloud,
    plan: settings.plan,
    budgetUsd: cloud ? plan.budgetUsd : null,
    spentUsd: spent,
    defaultProvider: settings.defaultProvider ?? DEFAULT_PROVIDER,
    defaultModel: settings.defaultModel ?? DEFAULT_MODEL_ID,
    providers: PROVIDERS.filter((p) => enabled.includes(p)).map((provider) => ({
      provider,
      label: label(provider),
      ownKey: own.some((r) => r.provider === provider),
      platformKey: Boolean(envKey(provider)),
    })),
    platformModels: PLATFORM_MODELS.filter(
      (m) => enabled.includes(m.provider) && Boolean(envKey(m.provider)),
    ).map((m) => ({
      provider: m.provider,
      id: m.id,
      name: m.name,
      inputPer1M: m.inputPer1M,
      outputPer1M: m.outputPer1M,
      includedInPlan:
        !cloud || plan.models === "all" || plan.models.includes(m.id),
    })),
  };
}

/**
 * The chat models each of the org's own keys can call, live from the providers. Fills the model picker.
 * A key that fails is skipped here and its error is remembered for the settings page.
 */
export async function listOrgKeyModels(userId: string, orgId: string) {
  await requireCapability(userId, orgId, "use_ai");
  const rows = await db
    .select({
      provider: aiProviderKey.provider,
      ciphertext: aiProviderKey.ciphertext,
    })
    .from(aiProviderKey)
    .where(eq(aiProviderKey.orgId, orgId));
  const enabled = enabledProviders();
  const out = await Promise.all(
    rows
      .filter(
        (r): r is typeof r & { provider: Provider } =>
          isProvider(r.provider) && enabled.includes(r.provider),
      )
      .map(async (r) => {
        let key = "";
        try {
          key = decryptSecret(r.ciphertext, aad(orgId, r.provider));
          const models = await listProviderModels(r.provider, key);
          return {
            provider: r.provider,
            label: label(r.provider),
            models: models.map((m) => m.id),
          };
        } catch (e) {
          await recordKeyOutcome(
            orgId,
            r.provider,
            scrub(e instanceof Error ? e.message : String(e), key),
          ).catch(() => {});
          return null;
        }
      }),
  );
  return out.filter((x): x is NonNullable<typeof x> => x !== null);
}
