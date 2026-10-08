import type { Provider } from "./providers";

/**
 * Models Captap itself pays for on the cloud deployment (spec 021). Prices are USD per 1M tokens,
 * read from the providers' own pages on 2026-09-29 (Groq: console.groq.com/docs/models; Anthropic:
 * platform.claude.com/docs/en/about-claude/pricing) and IDs from Groq's live /models list. Re-check
 * both before changing this file; a stale entry here is how the old picker rotted (it kept offering a
 * retired Llama). OpenAI, Google, xAI and Cohere have no platform models yet: they are bring-your-own-key
 * only until someone verifies a platform key and current prices for them.
 */
export type PlatformModel = {
  provider: Provider;
  id: string;
  name: string;
  inputPer1M: number;
  outputPer1M: number;
};

export const PLATFORM_MODELS: PlatformModel[] = [
  {
    provider: "groq",
    id: "openai/gpt-oss-120b",
    name: "GPT-OSS 120B (Groq)",
    inputPer1M: 0.15,
    outputPer1M: 0.6,
  },
  {
    provider: "groq",
    id: "openai/gpt-oss-20b",
    name: "GPT-OSS 20B (Groq)",
    inputPer1M: 0.075,
    outputPer1M: 0.3,
  },
  {
    provider: "groq",
    id: "qwen/qwen3.8-27b",
    name: "Qwen3.8 27B (Groq)",
    inputPer1M: 0.8,
    outputPer1M: 4,
  },
  {
    provider: "anthropic",
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    inputPer1M: 1,
    outputPer1M: 5,
  },
  {
    provider: "anthropic",
    id: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    inputPer1M: 2,
    outputPer1M: 10,
  },
  {
    provider: "anthropic",
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    inputPer1M: 4,
    outputPer1M: 20,
  },
];

/** Same model the persona reviews used before Consult; the only one proven working end to end. */
export const DEFAULT_PROVIDER: Provider = "groq";
export const DEFAULT_MODEL_ID = "openai/gpt-oss-120b";

export type Plan = "free" | "paid";

/** Founder decision 2026-09-29: free = $0.50 of platform usage a month on one model; paid = $15 across the catalog. */
export const PLANS: Record<
  Plan,
  { budgetUsd: number; models: "all" | string[] }
> = {
  free: { budgetUsd: 0.5, models: [DEFAULT_MODEL_ID] },
  paid: { budgetUsd: 15, models: "all" },
};

/** Ceiling for one call's output, so a single call can't overshoot a budget by much. */
export const MAX_OUTPUT_TOKENS = 4096;
/** Reviews return structured JSON (findings per criterion), so they get more room. */
export const REVIEW_MAX_OUTPUT_TOKENS = 8192;

export const platformModel = (provider: string, id: string) =>
  PLATFORM_MODELS.find((m) => m.provider === provider && m.id === id);

/** USD for a call. Unknown models (bring-your-own key, self-hosted env keys) cost us nothing we can price: "0". */
export function callCostUsd(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
) {
  const m = platformModel(provider, model);
  if (!m) return "0.000000";
  return (
    (inputTokens / 1_000_000) * m.inputPer1M +
    (outputTokens / 1_000_000) * m.outputPer1M
  ).toFixed(6);
}
