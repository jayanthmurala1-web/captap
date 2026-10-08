# 021 — Consult: chat with a specific agent, on a model your org actually controls

**Status: BUILT (2026-09-29).** Founder decisions: name **Consult**; free plan **$0.50**/month, paid **$15**/month; providers **Groq, OpenAI, Anthropic, Google, xAI (Grok) and Cohere** (xAI and Cohere added at the founder's request). Only Groq is verified with a real key; the others are implemented but switched off until verified (`provider-verify.live.test.ts`). See ADR-024 for evidence and known limits.

**Problem:** (1) The in-app "Copilot" is one generic assistant: `SYSTEM_PROMPT` in `src/lib/ai/harness.ts:~296`. The Agents system (skills = SKILL.md playbooks, learned rules, `assignedSkill`) that already steers MCP agents (`getTaskExecutionBundle` → `matchSkillsForTask`) and the persona reviews (`persona-review.ts` injects `skill.source` as the system prompt) does not touch the chat at all: `agentName` in `CopilotModelOptions` is only a telemetry label. (2) The model picker was fake (logged in STATUS). Today `resolveModelProvider` (`ai/models.ts`) silently falls back to Groq when a provider isn't configured, only `@langchain/groq` is installed, and `ChatGroq` is hard-coded in two places: the chat (`harness.ts:341`) and the reviews/drift check (`persona-review.ts:128`). There is no per-org key, no ownership of cost, and the reviews (the core product check) are not metered at all (`recordAgentTelemetry` is called only by the chat).
**Who pays / why it matters to revenue:** Agencies pay for agents that follow *their* playbooks and for not depending on one vendor's uptime, quota or price (the 2026-09-27 quota exhaustion and the retired-model 404 both hit the product). Self-hosters need to use their own provider keys or the product is unusable for them. The cloud tier needs a way to give a free taste without an open-ended bill.
**Success metric:** In a demo: pick `qa-review`, ask it to write a PRD → it stays in role and points to `prd-writing`; pick `prd-writing`, same ask → it produces a PRD in the org's own playbook structure. An org connects an OpenAI/Anthropic/Google/Groq key and the *very next* chat and review run on that provider, with a real round-trip to prove it. No path where the UI says provider X and provider Y answers.

## Name: **Consult** (runner-up: Huddle) — DECIDE
Agencies think in consulting. "Consult `code-review`", panel title "Consult · code-review", shortcut stays Ctrl/Cmd+K. It says what happens (you consult a specialist) and doesn't collide with Slack's "Huddle". Files/labels rename from copilot → consult (`ai-copilot-drawer.tsx`, `copilot-events.ts`, "Copilot" strings, telemetry default `copilot-agent`).

## 1. How choosing an agent changes what the chat does
Reuse, don't reinvent. The mechanism is the one MCP and the reviews already use: *the agent's `skill.source` is the system prompt, project learned rules ride along, task context comes from the bundle.*
- **Resolve the agent.** Extract the "available skills" merge already inside `matchSkillsForTask` (org skills overlaid by project skills, plus `DEFAULT_SKILLS` fallback) into one exported `resolveAgent(userId, scope, name)`; `matchSkillsForTask`, `listAgentNames` and Consult all call it. Unknown name → error. **There is no generic fallback agent.**
- **System prompt (server-built, never client-supplied)** = short fixed frame (who you talk to, what tools do, "you cannot approve work") + `=== AGENT PLAYBOOK: <name> ===` + full `skill.source` (same format `persona-review.ts` already uses) + that agent's learned rules `listLearnedRules(user, project, agentName)`. Client-sent `system` messages are dropped (today `ChatMessageInput` accepts them). Playbook injection is capped at 60 KB (limit is 100 KB per skill) with a visible "playbook truncated" notice.
- **From a task page** (`taskId` passed, default agent = `task.assignedSkill`, the same "assigned agent comes first" rule): also inject the task, its linked PRD requirements (`R-n` text), dependencies and latest review notes from `getTaskExecutionBundle`, **but only the chosen agent's playbook** (the bundle's other matched playbooks are left out so the agent keeps one identity).
- **Tools by agent kind (already in the schema):** `kind: review` agents get read-only tools (status, list/get documents, tasks, members, skills). `kind: guide` agents get the full set the chat has today (create/update document, create tasks, assign). All tools still run as the signed-in user through the existing capability checks; no approve tool exists.
- **Picker UX:** header dropdown of the project's agents (name + description, specialists first). Remembers the last agent per user (localStorage). On a task page it preselects the task's agent. Without a project only org-level agents are listed. Empty state explains what each agent is; there is no "just chat".
- **Request shape:** `POST /api/chat { messages(user|assistant only), projectId?, taskId?, agentName (required), provider?, model? }`. Existing rate limit (`copilot`, 20/min) and `use_ai` capability apply (§3).
- Fixes on the way: telemetry uses the *active* org, not `listOrganizations()[0]` (wrong for multi-org users); telemetry rows record the real `agentName` and `userId`.

## 2. Real multi-provider support
- **One factory, used everywhere:** `createChatModel({provider, model, apiKey, streaming, maxOutputTokens})` in `src/lib/ai/providers.ts`, called by the chat **and** `persona-review.ts` (reviews + drift). Providers: `groq`, `openai`, `anthropic`, `google`, `xai`, `cohere`. New deps (all MIT, server-only, same LangChain family as today): `@langchain/openai` 1.6.0 (2.1 MB unpacked), `@langchain/anthropic` 1.5.11 (1.1 MB), `@langchain/google-genai` 2.3.2 (0.5 MB); all peer on `@langchain/core ^1.2.x` — **`@langchain/openai` needs ≥1.2.13, installed is 1.2.12, so core gets a patch bump**. ADR-024 records this. Rejected: Vercel AI SDK (would replace the LangGraph harness), raw `fetch` to four APIs (reinventing streaming + tool-calling four times), OpenAI-compatible-only (no native Anthropic/Google).
- **No silent fallback, ever.** `resolveModelProvider`'s fallback chain is deleted. The resolver returns `{provider, model, apiKey, keySource}` or throws `AiAccessError` with a fixable message ("Connect an OpenAI key in Settings → AI", "Monthly free budget used", "Model not in your plan"). The UI shows the provider and model that actually answered (already partly there via the telemetry event).
- **Which models an org can pick:** *BYO key* → fetched live from that provider's list-models endpoint with the org's key, filtered to chat families (`gemini-*`, `claude-*`, `gpt-*`/`o*`, Groq minus whisper/guard/tts); cached per request only, not stored. *Platform key* → a small curated catalog in code (id, provider, price per 1M in/out, `tier`). Prices come from each provider's pricing page **at build time and are verified then**; they are not fixed by approving this spec (the current table still lists the retired `llama-3.3-70b-versatile` as default, which is exactly the rot this avoids).
- **Reviews and drift** use the org's *default* provider/model (`org_ai_settings`), default = Groq `openai/gpt-oss-120b`: today's behavior, prompts untouched. Changing it shows a warning: review and drift quality was only evaluated on the default (their JSON output and drift verdicts are model-sensitive; the existing parser degrades to a LOW finding rather than failing).
- **Verification rule (the lesson of the fake picker):** a provider ships only after **one real round trip per provider** (chat with a tool call + a review) passes with a real key; the PR states which providers were verified. I have a Groq key; **OpenAI, Anthropic and Google need small test keys from you**, otherwise those providers stay behind a flag as "unverified" and are not offered in the UI.

## 3. Storing org provider keys (exact schema)
```ts
// New capabilities in capabilities.ts: use_ai (org; granted to every seeded role), manage_ai_keys (org; owner+admin).
export const aiProviderKey = pgTable("ai_provider_key", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: text("org_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),          // 'groq' | 'openai' | 'anthropic' | 'google'
  ciphertext: text("ciphertext").notNull(),      // "v1.<iv>.<tag>.<data>" (base64url)
  keyHint: text("key_hint").notNull(),           // last 4 chars, shown in the UI
  createdBy: text("created_by").notNull().references(() => user.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  lastUsedAt: timestamp("last_used_at"),
  lastError: text("last_error"),                 // sanitized provider error, no key material
}, (t) => [unique("ai_provider_key_org_provider_uq").on(t.orgId, t.provider)]);

export const orgAiSettings = pgTable("org_ai_settings", {
  orgId: text("org_id").primaryKey().references(() => organization.id, { onDelete: "cascade" }),
  plan: text("plan").notNull().default("free"),  // 'free' | 'paid' — cloud only; ignored when self-hosted
  defaultProvider: text("default_provider"),     // used by reviews, drift and as the chat's preselection
  defaultModel: text("default_model"),
  updatedBy: text("updated_by").references(() => user.id),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});
// agent_execution_telemetry gains: key_source text ('platform'|'org') default 'platform', user_id text,
// purpose text ('consult'|'review'|'drift') default 'consult'. Its model_name default (retired llama) is fixed.
```
- **Encryption** (`src/lib/secrets.ts`, Node built-in `crypto`, no dependency): AES-256-GCM, random 12-byte IV per secret, key from new env `SECRETS_ENCRYPTION_KEY` (32 bytes base64; `openssl rand -base64 32`), **AAD = `orgId:provider`** so a ciphertext copied to another org/row fails to decrypt. The `v1` prefix leaves room for rotation (re-encrypt tool is out of scope). Missing/invalid env key → the BYO feature is disabled with a clear message; it never stores plaintext and never crashes the app.
- **Handling:** decrypted only inside the resolver, only server-side, for the duration of a call. Never returned to the browser (only `provider`, `keyHint`, `lastUsedAt`, `lastError`), never written to logs, audit or telemetry; provider errors are scrubbed of the key string before being stored or shown. Saving runs a live check against the provider's list-models endpoint and rejects a key that fails. Replace = overwrite; remove = delete row.
- **Access:** `manage_ai_keys` to add/replace/remove; `use_ai` to chat. Audit events `ai_key.saved | ai_key.removed | ai.settings_changed` (provider + hint only). Settings → AI page also shows this month's usage (sum of telemetry) by model and agent.

## 4. "Free" vs "paid", concretely
There is no plan or billing concept in the code today (ADR-006 deferred it; custom payments are banned). So:
- **Key resolution per call:** (1) the org's own key for the chosen provider → used, **not metered by us, no cap** (their bill) — allowed on every plan; (2) else, *cloud deployment only*, the platform key (our env keys) if the org's plan allows that model and budget remains; (3) else `AiAccessError`. **Self-hosted** (no `CAPTAP_CLOUD=1`): instance env keys act as fallback for every org, uncapped (the operator pays); plans are ignored.
- **Free plan (proposal — DECIDE the numbers):** platform key for exactly one model (Groq `openai/gpt-oss-120b`, the only one proven working), **USD 0.50 of platform usage per org per month**. At its published $0.15/$0.60 per 1M that is at least ~800k tokens, so a real trial, and our worst-case cost per free org is $0.50.
- **Paid plan (proposal):** platform key for the curated catalog, **USD 15 included per org per month**, hard stop when used up (no overage billing until payments exist), then "connect your own key or wait for reset".
- **Metering (uses what exists):** every platform-key call writes `agent_execution_telemetry` (now including reviews and drift, `purpose` set) with provider-reported token usage; `estimated_cost_usd` × catalog price. The budget check is `sum(cost) this calendar month (UTC) for key_source='platform'` before each call, plus a per-call output cap (`maxOutputTokens` 4096) so one call cannot blow far past the limit. Where a provider returns no usage, the call is charged a conservative estimate and flagged `metadata.estimated = true` (today's chars/4 guess is kept only for that flag, never silently for billing).
- **How a plan gets set:** manually in `org_ai_settings.plan` by the founder (SQL) until payments are built; a separate spec.

## Acceptance criteria
- [ ] Chatting with `prd-writing` vs `qa-review` sends different system prompts: the chosen agent's full playbook + its learned rules, verified by unit test on the assembled prompt; unknown agent → error, no fallback; client `system` messages dropped.
- [ ] Review agents get only read-only tools; guide agents the full set (test on the tool list). No tool can approve.
- [ ] On a task page the chat preselects the task's assigned agent and includes task + requirements context.
- [ ] `resolveAgent` is shared by `matchSkillsForTask`, `listAgentNames` and Consult (no duplicate merge logic); existing tests stay green.
- [ ] One factory builds all chat models; `ChatGroq` is constructed in exactly one place; reviews and drift use it.
- [ ] Resolver matrix tested: own key beats platform; platform allowed/blocked by plan and budget; self-hosted env fallback; missing key → clear error; **no provider substitution**.
- [ ] Key storage: round-trip, tamper fails, wrong `orgId:provider` (AAD) fails, plaintext never in DB/log/audit/telemetry (tested by scanning rows and captured logs), missing `SECRETS_ENCRYPTION_KEY` disables BYO without crashing.
- [ ] Budget enforcement: usage at the cap is refused; reviews/drift usage counts; monthly reset.
- [ ] **Per-provider real round trip** (chat with a tool call, and a review) with a real key, recorded in the PR; unverified providers are not selectable.
- [ ] Browser check: pick an agent, converse, see provider/model that answered; add and remove a key; usage shown.
- [ ] Eval set (below) recorded before the frame prompt is finalized.

## Evals (project rule: LLM features get an eval set before prompts)
`src/lib/ai/consult.eval.test.ts`, live Groq, gated `skipIf(!GROQ_API_KEY)`, graded by simple deterministic checks, run on the default model, ≥ 5/6 to ship: (1) `prd-writing` + "draft a PRD for a booking form" → has Problem, Non-Goals and Acceptance Criteria sections; (2) `qa-review` + same → does not produce a full PRD, mentions handing off; (3) `code-review` (read-only) + "create a task for X" → no `create_tasks` tool call; (4) `task-breakdown` + a PRD with `R-1..R-3` → every created task cites an `R-n`; (5) a learned rule "always ask for a rollback plan" attached to `prd-writing` shows up in its next PRD; (6) claims about features that don't exist ("comment thread on tasks", found earlier) do not appear when asked "what can I do on a task?".

## Out of scope
Saving chat history/threads; several agents in one conversation or agent-to-agent handoff; custom OpenAI-compatible base URLs (Azure, OpenRouter, Ollama: server-side request to an org-chosen URL is an SSRF risk, needs its own design after spec 014's webhook lesson); payment, plans purchase or invoicing; per-user quotas; key rotation tooling; org-specific price overrides; embeddings, images, voice, file attachments; MCP-connected external agents (they bring their own model); honoring the agentskills `allowed-tools` frontmatter (kind-based tool sets first).

## Research (decision points)
Grounded in code: `harness.ts:341`, `persona-review.ts:128`, `models.ts` fallback chain, `skills.ts` `matchSkillsForTask` / `listAgentNames` / `listLearnedRules`, `skill.kind`, `telemetry.ts`, `default-skills.ts`. Registry facts checked 2026-09-29: package versions, sizes, licenses and `@langchain/core` peer ranges above. Not yet checked (build-time): each provider's current model IDs and prices, and list-models endpoint filters; they are to be read from the live endpoints/pricing pages, not from memory.
