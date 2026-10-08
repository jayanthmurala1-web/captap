import { expect, test, vi } from "vitest";
import {
  createChatModel,
  enabledProviders,
  extractUsage,
  friendlyProviderError,
  listProviderModels,
  PROVIDERS,
  rateLimitWaitMs,
  scrub,
} from "./providers";

test("every provider builds a real chat model with tool support (no fake picker)", () => {
  for (const provider of PROVIDERS) {
    const m = createChatModel({
      provider,
      model: "some-model",
      apiKey: "k-123456",
    });
    expect(typeof m.bindTools, provider).toBe("function");
    expect(m._llmType().length, provider).toBeGreaterThan(0);
  }
});

test("only verified providers are enabled unless the operator opts others in", () => {
  const before = process.env.AI_UNVERIFIED_PROVIDERS;
  delete process.env.AI_UNVERIFIED_PROVIDERS;
  expect(enabledProviders()).toEqual(["groq"]);
  process.env.AI_UNVERIFIED_PROVIDERS = "openai, cohere,bogus";
  expect(enabledProviders()).toEqual(["groq", "openai", "cohere"]);
  if (before === undefined) delete process.env.AI_UNVERIFIED_PROVIDERS;
  else process.env.AI_UNVERIFIED_PROVIDERS = before;
});

test("scrub removes a key from any text; friendlyProviderError explains rate limits", () => {
  expect(scrub("bad key sk-abcdef123456 here", "sk-abcdef123456")).toBe(
    "bad key [key] here",
  );
  expect(
    friendlyProviderError(
      '429 {"message":"Rate limit reached ... Please try again in 7.64s."}',
    ),
  ).toMatch(/rate limiting.*8 seconds/);
  expect(friendlyProviderError("Rate limit reached")).toMatch(
    /Try again in a moment/,
  );
  expect(friendlyProviderError("Model not found")).toBe("Model not found");
  expect(
    friendlyProviderError(
      '400 {"error":{"message":"`tool calling` is not supported with this model"}}',
    ),
  ).toMatch(/can't use tools/);
});

test("extractUsage finds the provider's own token counts wherever that provider puts them", () => {
  // Groq (real shape observed 2026-09-29): nothing in usage_metadata, counts in response_metadata.usage
  expect(
    extractUsage({
      response_metadata: {
        usage: { prompt_tokens: 77, completion_tokens: 152, total_tokens: 458 },
      },
    }),
  ).toEqual({ input: 77, output: 152 });
  // LangChain standard (Anthropic / OpenAI / Google)
  expect(
    extractUsage({
      usage_metadata: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    }),
  ).toEqual({ input: 10, output: 20 });
  // older tokenUsage shape
  expect(
    extractUsage({
      response_metadata: {
        tokenUsage: { promptTokens: 5, completionTokens: 6 },
      },
    }),
  ).toEqual({ input: 5, output: 6 });
  // nothing reported: null, never a made-up number
  expect(extractUsage({ response_metadata: {} })).toBeNull();
  expect(extractUsage(null)).toBeNull();
});

test("rateLimitWaitMs reads the provider's own wait, and ignores everything that isn't a rate limit", () => {
  expect(
    rateLimitWaitMs("429 Rate limit reached. Please try again in 750ms."),
  ).toBe(750);
  expect(rateLimitWaitMs("429 ... Please try again in 7.642499999s.")).toBe(
    7643,
  );
  expect(rateLimitWaitMs("too many requests, try again in 2m")).toBe(120_000);
  expect(rateLimitWaitMs("rate limit exceeded")).toBe(5000);
  expect(rateLimitWaitMs("401 invalid api key")).toBeNull();
});

test("each provider's model list is read from its own endpoint with its own auth style, chat models only", async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const respond: Record<string, unknown> = {
    "api.groq.com": {
      data: [
        { id: "openai/gpt-oss-120b" },
        { id: "whisper-large-v3" },
        { id: "meta-llama/llama-prompt-guard-2-22m" },
      ],
    },
    "api.openai.com": {
      data: [
        { id: "gpt-5-mini" },
        { id: "text-embedding-3-small" },
        { id: "gpt-4o-mini-tts" },
        { id: "o3" },
        { id: "dall-e-3" },
      ],
    },
    "api.anthropic.com": { data: [{ id: "claude-haiku-4-5-20251001" }] },
    "generativelanguage.googleapis.com": {
      models: [
        {
          name: "models/gemini-2.5-flash",
          supportedGenerationMethods: ["generateContent"],
        },
        {
          name: "models/text-embedding-004",
          supportedGenerationMethods: ["embedContent"],
        },
      ],
    },
    "api.x.ai": { data: [{ id: "grok-4" }, { id: "grok-2-image" }] },
    "api.cohere.com": {
      models: [{ name: "command-a-03-2025" }, { name: "embed-v4.0" }],
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      seen.push({ url, headers: init.headers });
      const host = new URL(url).host;
      return new Response(JSON.stringify(respond[host]), { status: 200 });
    }),
  );
  const ids = async (p: Parameters<typeof listProviderModels>[0]) =>
    (await listProviderModels(p, "key-abcdef")).map((m) => m.id);
  expect(await ids("groq")).toEqual(["openai/gpt-oss-120b"]);
  expect(await ids("openai")).toEqual(["gpt-5-mini", "o3"]);
  expect(await ids("anthropic")).toEqual(["claude-haiku-4-5-20251001"]);
  expect(await ids("google")).toEqual(["gemini-2.5-flash"]);
  expect(await ids("xai")).toEqual(["grok-4"]);
  expect(await ids("cohere")).toEqual(["command-a-03-2025"]);
  vi.unstubAllGlobals();

  const by = (host: string) => seen.find((s) => new URL(s.url).host === host);
  expect(by("api.openai.com")?.headers.Authorization).toBe("Bearer key-abcdef");
  expect(by("api.anthropic.com")?.headers["x-api-key"]).toBe("key-abcdef");
  expect(by("api.anthropic.com")?.headers["anthropic-version"]).toBeTruthy();
  expect(
    by("generativelanguage.googleapis.com")?.headers["x-goog-api-key"],
  ).toBe("key-abcdef");
  // the key is never put in a URL (URLs get logged)
  expect(seen.some((s) => s.url.includes("key-abcdef"))).toBe(false);
});
