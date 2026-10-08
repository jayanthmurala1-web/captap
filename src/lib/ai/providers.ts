import { ChatAnthropic } from "@langchain/anthropic";
import { ChatCohere } from "@langchain/cohere";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenAI } from "@langchain/openai";
import { ChatXAI } from "@langchain/xai";

/**
 * The one place a chat model is constructed (spec 021). Consult, the persona reviews and the drift
 * check all come through `createChatModel`, so what the UI says is what runs.
 */
export const PROVIDERS = [
  "groq",
  "openai",
  "anthropic",
  "google",
  "xai",
  "cohere",
] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_INFO: Record<
  Provider,
  { label: string; env: readonly string[]; keyUrl: string }
> = {
  groq: {
    label: "Groq",
    env: ["GROQ_API_KEY"],
    keyUrl: "https://console.groq.com/keys",
  },
  openai: {
    label: "OpenAI",
    env: ["OPENAI_API_KEY"],
    keyUrl: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    label: "Anthropic (Claude)",
    env: ["ANTHROPIC_API_KEY"],
    keyUrl: "https://platform.claude.com/settings/keys",
  },
  google: {
    label: "Google (Gemini)",
    env: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    keyUrl: "https://aistudio.google.com/apikey",
  },
  xai: {
    label: "xAI (Grok)",
    env: ["XAI_API_KEY"],
    keyUrl: "https://console.x.ai",
  },
  cohere: {
    label: "Cohere",
    env: ["COHERE_API_KEY"],
    keyUrl: "https://dashboard.cohere.com/api-keys",
  },
};

export const isProvider = (v: string): v is Provider =>
  (PROVIDERS as readonly string[]).includes(v);

/**
 * Providers proven with a real round trip (a chat with a tool call and a review) against a real key.
 * A provider is added here only after that passes (spec 021: the previous picker offered models that
 * never ran). Until then it can be tried by setting AI_UNVERIFIED_PROVIDERS=openai,anthropic,...
 */
export const VERIFIED_PROVIDERS: readonly Provider[] = ["groq"];

export function enabledProviders(): Provider[] {
  const extra = (process.env.AI_UNVERIFIED_PROVIDERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isProvider);
  return PROVIDERS.filter(
    (p) => VERIFIED_PROVIDERS.includes(p) || extra.includes(p),
  );
}

/** The instance's own key for a provider (env), if any. */
export function envKey(provider: Provider): string | undefined {
  for (const name of PROVIDER_INFO[provider].env) {
    const v = process.env[name];
    if (v) return v;
  }
  return undefined;
}

export function createChatModel(o: {
  provider: Provider;
  model: string;
  apiKey: string;
  streaming?: boolean;
  temperature?: number;
  /** Bounds a single call's spend (spec 021). */
  maxOutputTokens?: number;
}): BaseChatModel {
  const { apiKey, model, streaming = false, temperature = 0.2 } = o;
  const maxTokens = o.maxOutputTokens;
  switch (o.provider) {
    case "groq":
      return new ChatGroq({ apiKey, model, streaming, temperature, maxTokens });
    case "openai":
      return new ChatOpenAI({
        apiKey,
        model,
        streaming,
        temperature,
        maxTokens,
      });
    case "anthropic":
      return new ChatAnthropic({
        apiKey,
        model,
        streaming,
        temperature,
        maxTokens,
      });
    case "google":
      return new ChatGoogleGenerativeAI({
        apiKey,
        model,
        streaming,
        temperature,
        maxOutputTokens: maxTokens,
      });
    case "xai":
      return new ChatXAI({ apiKey, model, streaming, temperature, maxTokens });
    case "cohere":
      return new ChatCohere({ apiKey, model, streaming, temperature });
  }
}

/** Removes a secret from text before it is stored, logged or shown (provider errors sometimes echo keys). */
export function scrub(text: string, ...secrets: (string | undefined)[]) {
  let out = text;
  for (const s of secrets)
    if (s && s.length >= 6) out = out.split(s).join("[key]");
  return out;
}

/**
 * Token counts the provider itself reported for a call, or null if it reported none.
 * Providers disagree on where they put them: LangChain's standard `usage_metadata` (Anthropic, OpenAI,
 * Google), or the raw `response_metadata.usage` / `tokenUsage` (Groq puts its real counts only there).
 * Cost metering must use these; a text-length guess is only ever a flagged fallback.
 */
export function extractUsage(
  message: unknown,
): { input: number; output: number } | null {
  const m = message as {
    usage_metadata?: { input_tokens?: number; output_tokens?: number };
    response_metadata?: {
      usage?: Record<string, number>;
      tokenUsage?: Record<string, number>;
    };
  } | null;
  const std = m?.usage_metadata;
  if (std && (std.input_tokens || std.output_tokens))
    return { input: std.input_tokens ?? 0, output: std.output_tokens ?? 0 };
  const raw = m?.response_metadata?.usage ?? m?.response_metadata?.tokenUsage;
  const input =
    raw?.prompt_tokens ?? raw?.promptTokens ?? raw?.input_tokens ?? 0;
  const output =
    raw?.completion_tokens ?? raw?.completionTokens ?? raw?.output_tokens ?? 0;
  return input || output ? { input, output } : null;
}

/**
 * How long a provider says to wait after a rate limit ("Please try again in 7.64s" / "750ms"), in ms.
 * null = not a rate limit. A rate limit with no stated wait returns 5000.
 */
export function rateLimitWaitMs(message: string): number | null {
  if (!/429|rate.?limit|too many requests/i.test(message)) return null;
  const m = message.match(/try again in ([\d.]+)\s*(ms|s|m)\b/i);
  if (!m) return 5000;
  const n = Number(m[1]);
  return Math.ceil(
    n *
      (m[2].toLowerCase() === "ms"
        ? 1
        : m[2].toLowerCase() === "m"
          ? 60_000
          : 1000),
  );
}

/** Turns a provider's raw failure into something a person can act on. Rate limits are the common one. */
export function friendlyProviderError(message: string) {
  if (
    /tool.?calling.*not supported|does not support tool|tools? (is|are) not supported/i.test(
      message,
    )
  )
    return "That model can't use tools, which Consult needs to read and change your project. Pick another model.";
  if (/429|rate.?limit|too many requests|quota/i.test(message)) {
    const wait = message.match(/try again in ([\d.]+)\s*(ms|s|m)/i);
    const secs = wait
      ? Math.ceil(
          Number(wait[1]) *
            (wait[2] === "ms" ? 0.001 : wait[2] === "m" ? 60 : 1),
        )
      : null;
    return `The AI provider is rate limiting requests right now. ${secs ? `Try again in about ${secs} seconds.` : "Try again in a moment."}`;
  }
  return message;
}

const NOT_CHAT =
  /(embed|whisper|tts|audio|realtime|transcribe|image|imagine|moderation|dall|orpheus|guard|safeguard|rerank|speech|vision-preview)/i;

type ModelList = { id: string }[];

/**
 * The chat models an API key can actually call, straight from the provider's own list endpoint.
 * Also the "test this key" check: it throws with a scrubbed message when the key is rejected.
 * URLs are fixed; nothing here takes a host from a user.
 */
export async function listProviderModels(
  provider: Provider,
  apiKey: string,
): Promise<ModelList> {
  const bearer = { Authorization: `Bearer ${apiKey}` };
  const get = async (url: string, headers: Record<string, string>) => {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = scrub(
        (await res.text().catch(() => "")).slice(0, 200),
        apiKey,
      );
      throw new Error(
        res.status === 401 || res.status === 403
          ? `${PROVIDER_INFO[provider].label} rejected this key (${res.status}).`
          : `${PROVIDER_INFO[provider].label} returned ${res.status}${body ? `: ${body}` : ""}`,
      );
    }
    return (await res.json()) as Record<string, unknown>;
  };
  const ids = (
    xs: unknown,
    pick: (x: Record<string, unknown>) => string | undefined,
  ) =>
    ((xs as Record<string, unknown>[]) ?? [])
      .map(pick)
      .filter((id): id is string => Boolean(id));

  let found: string[];
  switch (provider) {
    case "groq": {
      const j = await get("https://api.groq.com/openai/v1/models", bearer);
      found = ids(j.data, (m) => m.id as string);
      break;
    }
    case "openai": {
      const j = await get("https://api.openai.com/v1/models", bearer);
      found = ids(j.data, (m) => m.id as string).filter((id) =>
        /^(gpt-|o\d|chatgpt-)/.test(id),
      );
      break;
    }
    case "anthropic": {
      const j = await get("https://api.anthropic.com/v1/models?limit=100", {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      });
      found = ids(j.data, (m) => m.id as string);
      break;
    }
    case "google": {
      const j = await get(
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
        {
          "x-goog-api-key": apiKey,
        },
      );
      found = ids(j.models, (m) =>
        Array.isArray(m.supportedGenerationMethods) &&
        (m.supportedGenerationMethods as string[]).includes("generateContent")
          ? String(m.name).replace(/^models\//, "")
          : undefined,
      );
      break;
    }
    case "xai": {
      const j = await get("https://api.x.ai/v1/models", bearer);
      found = ids(j.data, (m) => m.id as string).filter((id) =>
        id.startsWith("grok"),
      );
      break;
    }
    case "cohere": {
      const j = await get(
        "https://api.cohere.com/v1/models?endpoint=chat&page_size=100",
        bearer,
      );
      found = ids(j.models, (m) => m.name as string);
      break;
    }
  }
  return [...new Set(found)]
    .filter((id) => !NOT_CHAT.test(id))
    .sort()
    .map((id) => ({ id }));
}
