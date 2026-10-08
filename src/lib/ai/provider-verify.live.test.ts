import { tool } from "@langchain/core/tools";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { DEFAULT_MODEL_ID, DEFAULT_PROVIDER } from "./catalog";
import {
  createChatModel,
  extractUsage,
  listProviderModels,
  PROVIDERS,
  type Provider,
} from "./providers";

/**
 * The real round trip a provider must pass before it goes in VERIFIED_PROVIDERS (spec 021).
 * Skipped unless you give it a key:
 *
 *   VERIFY_OPENAI_KEY=sk-... pnpm vitest run src/lib/ai/provider-verify.live.test.ts
 *   (optional) VERIFY_OPENAI_MODEL=<model id>   otherwise the first chat model the key lists is used
 *
 * Keys: VERIFY_GROQ_KEY, VERIFY_OPENAI_KEY, VERIFY_ANTHROPIC_KEY, VERIFY_GOOGLE_KEY, VERIFY_XAI_KEY, VERIFY_COHERE_KEY.
 * It spends a few hundred tokens per provider.
 */
for (const provider of PROVIDERS) {
  const key = process.env[`VERIFY_${provider.toUpperCase()}_KEY`];
  describe.skipIf(!key)(`provider round trip: ${provider}`, () => {
    test("lists its chat models, streams an answer that calls a tool, and reports real token usage", async () => {
      const apiKey = key as string;
      const models = await listProviderModels(provider as Provider, apiKey);
      expect(
        models.length,
        "the key should list at least one chat model",
      ).toBeGreaterThan(0);
      // A provider's list includes models that can't call tools (Groq's first entry doesn't), so prefer
      // a known-good default and let VERIFY_<PROVIDER>_MODEL override.
      const model =
        process.env[`VERIFY_${provider.toUpperCase()}_MODEL`] ??
        (provider === DEFAULT_PROVIDER ? DEFAULT_MODEL_ID : models[0].id);
      console.log(
        `${provider}: ${models.length} chat models; testing ${model}`,
      );

      let called: unknown = null;
      const echo = tool(
        async ({ text }) => {
          called = text;
          return text;
        },
        {
          name: "echo",
          description:
            "Repeats text back. Always call this when asked to echo.",
          schema: z.object({ text: z.string() }),
        },
      );
      const llm = createChatModel({
        provider: provider as Provider,
        model,
        apiKey,
        streaming: true,
        maxOutputTokens: 1024,
      });
      if (!llm.bindTools) throw new Error("no tool support");
      let full = null as Awaited<ReturnType<typeof llm.invoke>> | null;
      for await (const chunk of await llm.bindTools([echo]).stream([
        {
          role: "user",
          content: "Call the echo tool with the text 'hello'.",
        },
      ])) {
        full = full
          ? (full as never as { concat: (c: unknown) => typeof full }).concat(
              chunk,
            )
          : chunk;
      }
      const calls =
        (
          full as unknown as {
            tool_calls?: { name: string; args: { text?: string } }[];
          }
        )?.tool_calls ?? [];
      expect(
        calls.map((c) => c.name),
        "the model should have called the echo tool",
      ).toContain("echo");
      await echo.invoke(calls[0].args as { text: string });
      expect(called).toBeTruthy();

      const usage = extractUsage(full);
      expect(
        usage,
        "the provider should report token usage on a streamed call",
      ).not.toBeNull();
      expect((usage?.input ?? 0) + (usage?.output ?? 0)).toBeGreaterThan(0);
    }, 90_000);
  });
}
