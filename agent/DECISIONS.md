# Decisions (append-only)

Format: `## ADR-NNN — Title (date)` → Context · Decision · Alternatives rejected · Consequences.

## ADR-001 — Development framework (2026-09-15)
**Context:** Two-person founding team (founder + AI agent), vibe-coded, production from day one.
**Decision:** Spec-driven + eval/test-first loop (see `CONTRIBUTING.md`). Eval-Driven Development for any LLM feature. Trunk-based git, small commits, CI before first deploy.
**Alternatives rejected:** Scrum (ceremony for a 2-person team), pure vibe coding without specs (drift, rewrites), big-company process (built for 1000 engineers).
**Consequences:** Every feature costs a 1-page spec up front; saves rework.

## ADR-002 — Who pays for AI (2026-09-15)
**Decision:** MCP flows run on the customer's own AI tool and subscription; our server only serves Skills and stores results. In-app AI calls our LLM, metered with per-org usage limits.
**Consequences:** Near-zero AI cost for the core flow. In-app AI must be priced in.

## ADR-003 — Personas run client-side (2026-09-15)
**Decision:** Persona review Skills are served over MCP and executed inside the developer's agent. No GitHub integration in V1.
**Consequences:** Free to us, but skippable. Mitigated by ADR-004: a missing review result is visible to the approver.

## ADR-004 — Evidence-based completion (2026-09-15)
**Decision:** The agent cannot set Done. It calls `submit_task(evidence)` → status In Review → a human approves → Done. Evidence = branch, commit SHA, files changed, test command + exit code + output summary, persona review results, summary.
**Limitation (ADR-004):** Evidence is agent-reported, not independently verified, and the UI labels it that way. Upgrade path: GitHub integration verifies the SHA exists and CI passed.

## ADR-005 — Standalone task system (2026-09-15)
**Context:** The product is built for agent-first work; legacy PM tools are designed around humans.
**Decision:** We own the task data and ship a minimal board (projects, tasks, status, assignee, dependencies, comments). No Jira/Linear sync in V1.
**Guardrail:** Every board feature must make Skills or the agent flow better, or it's rejected.
**Consequences:** Customers switch tools to adopt us. We add one connector later, only when customers demand it.

## ADR-006 — Tech stack (2026-09-15)
**Context:** 2-person team, TypeScript-first, needs a web app, a remote MCP server with OAuth, multi-tenant data, Skills storage and in-app AI.
**Decision:**
| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) everywhere | One language across UI, API, MCP |
| App | Next.js App Router, **one app** | Web + API + MCP in one deploy |
| MCP | MCP SDK v2 `createMcpHandler` at `/api/mcp` (stateless; serves 2025 and 2026 clients) | The SDK has the handler built in, so `mcp-handler` was dropped (one less dependency) |
| Auth | Better Auth (+ organization plugin, MCP/OAuth plugin) | Only auth library with native MCP OAuth. Users live in our DB. Orgs, invites and roles built in |
| DB | Postgres + Drizzle ORM | Relational data (org→project→task→deps). Row-level atomic claim via `UPDATE … WHERE status='ready' RETURNING` |
| Skills format | Agent Skills standard (`SKILL.md` + YAML frontmatter) | Open standard adopted by Claude Code, Codex, Cursor, Gemini CLI and 30+ tools. Zero lock-in for customers |
| In-app AI | Vercel AI SDK + Claude (model-swappable) | Chat + tool calls + streaming UI, TS-native, can reuse our MCP tools. LangChain/LangGraph rejected: we run no server-side agent workflows (ADR-002), so the graph orchestration would be unused weight. Revisit if we ever run long-lived agents server-side. |
| UI | Tailwind; shadcn/ui added when the board needs real components | 3 utility classes cover spec 001 |
| Tests / lint | Vitest, Biome | One fast test runner, one lint+format tool |
| DB host | Neon (serverless Postgres), one branch per environment (dev / prod) | Founder choice: cloud is fine. Branching gives a throwaway dev DB. No Docker. |
| Hosting | Vercel | Native Next.js target |
| Payments | Stripe, added when pricing is validated | YAGNI now |
**Tenant isolation:** every tenant table has `org_id`. All queries go through one scoped data-access layer, with a test that proves cross-org reads fail. Postgres RLS gets added before the first paying customer.
**Rejected:** Supabase Auth (MCP OAuth not native), Clerk (per-MAU cost, users outside our DB), separate MCP service (two deploys for no gain), Python backend (two languages).

## ADR-007 — MCP client registration (2026-09-15)
**Decision:** Advertise CIMD (Claude Code 2.1.81+ prefers it) and keep DCR enabled for clients without CIMD.
**Issue:** Better Auth defaults DCR clients to `application_type: "web"`, which rejects `http://localhost` redirects.
**Fix (spec 002):** A before-hook sets `application_type: "native"` when a registration omits it and every redirect is loopback (RFC 8252). Verified: localhost and 127.0.0.1 clients now register without the field.

## ADR-008 — Skills storage + `yaml` dependency (2026-09-15)
**Decision:** Store each SKILL.md verbatim (`source`) and index `name`/`description` from its frontmatter. Scope = org or project (project overrides org by name). `kind` (guide/review) is our column, not part of the file. Frontmatter is parsed with `yaml` (maintained, zero dependencies), because hand-parsing untrusted YAML is a bug farm.
**Deferred:** versioning/history, multi-file skills (`scripts/`, `references/`).

## ADR-009 — Documents: append-only versions + optimistic concurrency (2026-09-15)
**Decision:** `document` (header + `current_version`) and immutable `document_version` rows. Updates must pass `base_version`; a compare-and-swap on `current_version` inside a transaction rejects stale writes with a conflict telling the agent to re-read and merge. Rendered with `react-markdown` + `remark-gfm` (no raw HTML, so it's XSS-safe without a sanitizer).
**Why:** Multiple agents and humans edit the same PRD. Silent last-write-wins would destroy requirements, and history is the project memory.
**Also:** Domain errors now share one `DomainError` base (`src/lib/errors.ts`); MCP and forms map it to readable errors, and anything else is a 500.

## ADR-010 — Task engine (2026-09-15)
**Decision:**
- Claims are single atomic SQL statements. `claim_next_task` uses `FOR UPDATE SKIP LOCKED` (the standard Postgres job-queue pattern), so parallel agents grab different tasks without waiting or colliding.
- Agents are identified by user + agent name, since one human can run several terminals.
- Dependencies may only reference existing tasks or earlier batch items, so they are acyclic by construction and need no cycle detection.
- T-numbers are reserved from an atomic `project.task_seq` counter, so a failed batch consumes no numbers.
- Approve/reject exist only in the web app. They are never MCP tools, so an agent cannot approve its own work (ADR-004).
**Verified:** 10 concurrent claims on 8 tasks gave 8 distinct tasks and 2 nulls.
**Deferred:** editing dependencies after creation, priorities, GitHub-verified evidence (founder adding GitHub next).

## ADR-011 — CI + deterministic project status (2026-09-15)
**CI:** GitHub Actions runs lint + typecheck on every push/PR. Integration tests run once the `CI_DATABASE_URL` secret (a dedicated Neon branch, never prod) exists; until then they're skipped, not failed. Actions pinned to current majors (checkout v7, setup-node v7, pnpm v6).
**Status:** "Where are we?" is computed from data (counts, review queue, blocked, stale > 24h, sent back, next up, recent changes), not generated by an LLM. It's free, instant and can't hallucinate. An AI narrative can be layered on top later (in-app AI spec).

## ADR-012 — Scope correction: reverse the post-review drift (2026-09-27)
**Context:** an internal product review (2026-09-15) explicitly recommended cutting the board, agent orchestration, multiple personas, autonomy levels, and analytics — because GitHub Agent HQ and Linear already own that ground — in favor of a narrow wedge: PRD/spec ingestion with structural validation, task decomposition, an MCP context gateway, PR-to-requirement alignment checking, and a project resume page. `agent/MASTER_ROADMAP.md` Phases 3.1–4.1 built almost exactly the cut list anyway (sprints/burndown, swarm orchestration, L0–L4 fleet autonomy, webhooks/Slack/Discord bridge, multi-model benchmarking, a "self-healing CI" feature) with no ADR logging the override at the time. Two of those features (`src/lib/worktree/self-heal.ts`, `src/lib/ai/benchmark.ts`) were also found to fabricate their own success data — they write fake commit SHAs and fake test results into the same evidence system ADR-004 exists to keep honest, rather than doing the thing they claim to do.
**Decision:** Reaffirm the original an internal product review wedge as the actual roadmap. Documentation corrected first (the internal status log, `agent/MASTER_ROADMAP.md` rewritten; `COMPETITIVE_ANALYSIS_PLANE_SO.md` and `ENTERPRISE_STAGE_EXPANSION_PLAN.md` deleted — both contained fabricated file references or premature enterprise scope for a pre-revenue, no-customer-conversation product). Code for the scope-creep features and the two fabricating features is left in place for now, untouched, pending a separate decision.
**Next required before further building:** get real conversations with agency owners and check the original kill signal (fewer than 3 of 10 would pay) — this has never been done. Build the document/PRD structural linter next, as the smallest piece closest to the actual differentiator.
**Consequences:** No new scope-creep features get built until the linter exists and customer validation happens. the internal status log must be updated at the end of every session going forward — it was skipped for the last 4 feature commits before this ADR.

## ADR-013 — `rehype-raw` + `rehype-sanitize` for rendering shared documents (2026-09-28)
**Context:** The web editor saves documents as HTML (`innerHTML`), MCP/agents write markdown. The public `/approve/[token]` page rendered HTML docs as escaped tags. Any HTML shown to an outside party must be sanitized.
**Decision:** Render via `react-markdown` + `rehype-raw` (parse embedded HTML) + `rehype-sanitize` (GitHub allowlist schema). Server component only — zero client bundle cost. Both are unified-collective packages, actively maintained, the standard pairing for react-markdown.
**Alternatives:** DOMPurify (needs a DOM on the server → jsdom, heavier); converting HTML→markdown on save (right long-term, but a data migration — spec 014 screen 4).
**Known debt:** `interactive-document-viewer.tsx` still assigns unsanitized content to `innerHTML` (stored XSS inside the app). Fixed in spec 014 screen 4 with the same sanitizer.

## ADR-014 — shadcn/ui (Radix base) + theme via cookie (2026-09-28)
**Context:** Spec 014 needs accessible dialogs/menus/sheets/tooltips. Hand-rolling them is the "custom design system" the project's engineering rules ban; the old `ui/` components only mimicked shadcn's API.
**Decision:** `shadcn` CLI init (style `radix-nova`, `components.json` committed). Runtime deps it brings: `radix-ui`, `class-variance-authority`, `tw-animate-css`; `shadcn` itself is a devDependency (only its CSS entry is used, at build time). Theme is a `.dark` class on `<html>` rendered server-side from a `theme` cookie (dark default) — no `next-themes`, no flash, no extra dependency.
**Rejected:** the CLI also installs `cn` (a 6-day-old package duplicating `clsx` + `tailwind-merge`, which we already have) and rewrote `src/lib/utils.ts`, deleting our date helpers. Reverted; generated components import `cn` from `@/lib/utils`. **After any `shadcn add`, run `pnpm remove cn` and re-point imports** — the CLI re-adds it every time.

## ADR-015 — The board can't approve work (2026-09-28)
**Context:** `moveTaskStatus` (Kanban drag) let any project member set Done — auto-approving pending submissions — or move tasks into In review without evidence, bypassing ADR-004.
**Decision:** Board moves are limited to To do ↔ In progress. In review only via `submitTask` (evidence); Done / sent back only via `decideTask` (human, with a note when sending back). Enforced in `moveTaskStatus`, the single path all callers use.

## ADR-016 — No auto-approval, ever (2026-09-28)
**Context:** Fleet "autonomy" (L3/L4) auto-approved every submission whose agent-reported tests exited 0 and that had no blocking reviews — including when no review had run yet (it evaluated at submit time, racing the async reviews; an empty review list counted as clean). The level was settable over MCP, so an agent with an admin's token could raise it and approve its own work.
**Decision:** Removed: the auto-approval trigger in `submitTask`, `lib/fleet/autonomy.ts` (+ test), the two MCP autonomy tools, and its server action. `decideTask` is now called only from the human task page. The `project.autonomy_level` column is left inert (dropping it needs a migration). Reinforces ADR-004 and the consent screen's "it can't approve work".

## ADR-017 — Tiptap editor, markdown storage, Cloudinary via REST (2026-09-28)
**Context:** Founder: people can't write markdown; editing must feel like Notion/Word with tables and images (spec 015). The previous contentEditable editor saved HTML, which broke the PRD linter and allowed stored XSS.
**Decision:** Tiptap 3 (`@tiptap/react`, `starter-kit`, `markdown`, `extension-table`, `extension-image`, `extension-task-list/item`, `extension-placeholder`; MIT, active, 2026-09). Storage stays markdown via the official `@tiptap/markdown` (round-trip tested; a `tidyMarkdown` step undoes the serializer's `&amp;`, which otherwise broke PRD headings). Images: Cloudinary signed upload over REST with `node:crypto` (no SDK); PNG/JPEG/GIF/WebP only (no SVG), 10 MB cap; server-action body limit raised to 11 MB.
**Alternatives:** BlockNote (lossy markdown export), Milkdown (smaller ecosystem), Cloudinary SDK (unneeded for one signed POST).

## ADR-018 — React Flow for the ERD canvas; the layout lives in the mermaid block (2026-09-28)
**Context:** Founder: the database diagram was static; they want to move tables, edit visually, and have the layout saved for the whole team (spec 015).
**Decision:** `@xyflow/react` 12 (MIT, active, ~200 KB with styles) for the canvas. The mermaid `erDiagram` block stays the source of truth (agents write it, the drift check reads it). The canvas parses it, edits it, and writes it back through the normal versioned save. Table positions are stored as a `%% captap-layout {json}` comment inside the block, so there's no new table and no migration. Removed `mermaid` and `marked` (the old read-only viewer).
**Alternatives:** tldraw/Excalidraw (freeform drawing, not structured tables); a separate layout table (a second source of truth that isn't versioned with the doc); keeping mermaid rendering (can't drag).

## ADR-019 — Org-defined roles as capability flags in our own table (2026-09-29)
**Context:** Founder wants agencies to define their own roles (spec 016). Roles were hardcoded (org text `owner|admin|member`, project enum) and nothing gated approving work beyond membership.
**Decision:** One `org_role` table (`slug`, `name`, `capabilities text[]`), used for both org roles (`member.role`) and project roles (`project_member.role`, enum dropped). Effective project access = org role ∪ project role. `owner` is locked in code (always every capability) so an org can't lock itself out. Better Auth's mutating org endpoints are added to `disabledPaths`: they only understand its 3 built-in roles and would bypass ours. No new dependency.
**Alternatives:** Better Auth `dynamicAccessControl` (org-level only, resource/action model, enforced only inside its own endpoints which the app doesn't use for logic); keep enums and add flags (two permission systems).
**Consequence:** `approve_tasks` is a new gate: developer/devops/plain member can no longer approve (founder-approved). A migration seeds 8 system roles per existing org; existing role strings are already valid slugs.

## ADR-020 — Requirements replace Epic/Story; keys live in the PRD text (2026-09-29)
**Context:** Founder does not want a copy of Jira/Linear's hierarchy; work should trace to what the client approved (spec 017).
**Decision:** Project → PRD → requirement (one per Acceptance Criteria bullet) → task. The PRD is the grouping; `epic`/`story` are dropped. A requirement's key (`R-4`) is written into the versioned PRD text on save (`- R-4: …`), mirrored in a `requirement` table (keys never reused; deleted bullets get `removed_at`). Tasks link many-to-many (`task_requirement`) and carry `prd_document_id`. Requirement state (no work / not started / in progress / in review / done) is derived from linked tasks, never stored. Old epic/story titles survive as `task.legacy_group`. No new dependency.
**Alternatives:** hash-of-text matching (any rewording orphans tasks); DB-only ids (invisible to agents, the linter and the client); keeping `epic` as a wrapper around a PRD (the generic layer the founder ruled out).
**Consequence:** Numbering changes the PRD text, so a PRD written before this needs one explicit versioned "Number requirements" save; a client who approved the earlier version sees it as changed (the UI says so first). Migrations 0020 (additive + data) and 0021 (drops) — 0021 breaks pre-017 code, so deploy code and migrations together.

## ADR-021 — Audit log is append-only in the database, written with the change (2026-09-29)
**Context:** Agencies must be able to prove who approved/changed what (spec 018).
**Decision:** `audit_event` table; a Postgres trigger rejects every UPDATE and DELETE except the cascade when the whole organization is deleted; no update/delete code exists. `recordAudit(tx, …)` runs inside the change's transaction where there is one, so a rolled-back change leaves no record. The actor's name is snapshotted by the insert itself (one round trip). Only `org_id` is a foreign key. New capability `view_audit_log` (Owner/Admin). No dependency.
**Alternatives:** app-level "we never update it" (a bug or a future contributor breaks the promise silently); a hash chain (tamper-evidence against a DB admin — real value later, not for 5–20 person agencies now).
**Consequence:** each audited write costs one extra query; the first version cost two and pushed two slow tests past their timeout, which is how it was noticed.

## ADR-022 — Rate limits: fixed-window counters in Postgres, Better Auth's limiter for /api/auth (2026-09-29)
**Context:** No limits existed on the API, MCP, copilot (costs Groq quota), sign-in or the public client-approval form (spec 019).
**Decision:** One `rate_limit` table shared by both limiters. Ours is a single atomic upsert per check (`src/lib/rate-limit.ts`, limits in one `LIMITS` object). Better Auth's built-in limiter is enabled in every environment with `storage: "database"`. If the limiter's own DB call fails the request is allowed and the error is logged. No dependency.
**Alternatives:** in-memory (useless across serverless instances), Upstash/Redis (a second paid service for a 5–20 person agency product), Vercel's edge firewall (still worth turning on for volumetric attacks; doesn't know users or tokens).
**Consequence:** each guarded request costs one small write; counters are per user id (signed in) or IP. Fail-open means no limiting while the database is failing.

## ADR-023 — Transactional email through Resend's REST API, no SDK (2026-09-29)
**Context:** Captap sent no email; invites were pasted links, and neither task decisions nor the client's approval reached anyone unless they opened the app (spec 020).
**Decision:** Resend (founder-chosen), called with `fetch` from `src/lib/email.ts`. No dependency added (the SDK is a thin wrapper over one POST). Sender is `EMAIL_FROM`, currently on the founder's own verified domain; switching to the real Captap domain is changing that one variable and verifying the new domain in Resend. Key is `RESEND_API_KEY` (gitignored `.env`; must also be set in Vercel). Sending is best-effort and never throws into the caller; failures are logged and surfaced where the user can act (the invite screen). Reserved/test addresses are never emailed.
**Alternatives:** Postmark/SES (more setup, no advantage at this volume); SMTP via nodemailer (a dependency plus connection handling on serverless); building on Better Auth's email hooks (they cover its own verification/reset mails, not our three events).
**Consequence:** three transactional emails only, no preferences or unsubscribe; no bounce handling; deliverability depends on the sender domain's DNS.

## ADR-024 — Consult, six LangChain provider clients, encrypted per-org keys, plan budgets (2026-09-29)
**Context:** The chat was one generic assistant and its model picker was fake (spec 021). `ChatGroq` was hard-coded in the chat and the reviews; the reviews were unmetered; nothing stored a customer's key.
**Decision:**
- *Providers:* `@langchain/openai` 1.6.0, `@langchain/anthropic` 1.5.11, `@langchain/google-genai` 2.3.2, `@langchain/xai` 1.4.15, `@langchain/cohere` 1.1.0 next to the existing `@langchain/groq` (all MIT, server-only, ~0.3-2 MB each, updated within the last four months; `@langchain/core` bumped 1.2.12 -> 1.2.13 because openai needs >=1.2.13). One factory, `createChatModel`, builds every model; Consult and the persona reviews/drift check both use it.
- *No silent fallback:* `resolveModelAccess` returns the provider/model/key asked for or throws a fixable message. Only providers in `VERIFIED_PROVIDERS` (today: groq) are enabled; the rest are opt-in via `AI_UNVERIFIED_PROVIDERS` until `provider-verify.live.test.ts` passes with a real key.
- *Keys:* `ai_provider_key`, AES-256-GCM via Node `crypto` (no dependency), key from `SECRETS_ENCRYPTION_KEY`, bound to `orgId:provider` by AAD, shown only as the last 4 characters, validated against the provider's list-models endpoint on save.
- *Plans:* key resolution is own key (any plan, unmetered) -> Captap's key on the cloud deployment within the plan (free $0.50/month on one model, paid $15/month across the catalog; founder decision) -> otherwise a fixable error. Self-hosted: the operator's env keys, uncapped. Metering reuses `agent_execution_telemetry` and now also covers the reviews and drift check.
- *Agent routing:* the chosen agent's SKILL.md becomes the server-built system prompt (same mechanism as the MCP bundle and the reviews); reviewers get read-only tools; client-sent system messages are dropped.
**Alternatives:** Vercel AI SDK (replaces the LangGraph harness), raw fetch to four APIs (reinvents streaming and tool calling), OpenAI-compatible base URLs (SSRF, out of scope), reusing `BETTER_AUTH_SECRET` as the encryption key (couples two rotations).
**Consequence:** Only Groq is proven. Groq's on-demand tier allows ~8k tokens/minute per model and one Consult request is 3-6k (the playbook and tools are re-sent on every step of a tool loop), so the hosted free tier needs a paid Groq tier before launch; Consult retries short rate-limit waits and otherwise says so plainly. Groq reports token usage only in `response_metadata.usage`, which is why `extractUsage` exists; guessing from text length is a flagged last resort.

## ADR-025 — Connections: `@modelcontextprotocol/sdk` client, token/webhook-based (not OAuth) (2026-10-01)
**Context:** Captap only accepted inbound MCP connections (coding agents connecting to it). Founder asked for outbound connectors to external tools (Slack, GitHub, "and custom add" for anything else) — spec 023.
**Decision:** `@modelcontextprotocol/sdk` 1.31.0 (official, MIT, client half of the same protocol Captap's own MCP server already speaks) — used only to live-validate a `custom_mcp` connection via a real `initialize` handshake, not to call tools yet (that's a later spec). The other two kinds need no new dependency: `slack_webhook` is a plain `fetch` POST to an Incoming Webhook URL the org pastes from their own Slack workspace; `github_pat` is a plain `fetch` to `GET /user`. Secrets reuse `src/lib/secrets.ts` (spec 021's AES-256-GCM, no new crypto dependency).
**Alternatives:** Per-vendor OAuth apps (Slack App, GitHub App) — rejected for v1: needs the founder to register and maintain an app with each vendor, with no payer asking for it yet; a pasted token/webhook is immediately usable and needs zero vendor-side setup. A generic HTTP-only "custom webhook" instead of real MCP — rejected: loses tool discovery, and Captap already depends on the MCP protocol for its own inbound server, so speaking it outbound too is the smaller surface, not a new one.
**Consequence:** `custom_mcp` connections are stored and live-validated but not yet usable by any Captap feature (no code calls tools on them) — storage-and-handshake only until a feature spec says what uses it. OAuth-based connectors (more features: channel picker instead of one fixed webhook, PR creation instead of read-only PAT calls) are a deliberate v2, not a scope miss.

## ADR-026 — `@xyflow/react` for the role→skill routing canvas, config only (2026-10-01)
**Context:** Founder asked for an n8n/ElevenLabs-Flow-style node canvas to control which skill
routes to which task role — currently hardcoded (`roleSkillMap` in `skills.ts`), and `devops` maps to
two skills (`"deployment"`, `"ci-cd"`) that have never existed, so devops tasks get no guidance.
**Decision:** Before building, surfaced the real fork to the founder: a visual canvas that only
*configures* existing routing data vs. one that *executes* a pipeline itself (turning Captap into a
runtime engine, not just a context/verification layer — directly contradicting its harness-agnostic
positioning and re-opening the "fleet orchestration" scope-creep the internal status log already flags once).
Founder chose config-only (spec 025). `@xyflow/react` 12.12.0 (MIT, the library n8n and ElevenLabs
Flow are themselves built on) renders the canvas — hand-rolling drag/connect/pan/zoom would be
reinventing a maintained wheel for a solved problem. The canvas edits `role_skill_route` rows; it
never runs anything.
**Alternatives:** Hand-rolled SVG + drag listeners (large, bug-prone, no pan/zoom/minimap for free);
a plain settings form with checkboxes (would satisfy the data need but not what was actually asked —
founder specifically wants the node/edge visual, not a form).
**Consequence:** Node positions are not persisted — auto-layout on every load, cosmetic only. Org-
level routing only in v1 (no project-level override). Orgs that never touch the canvas keep the old
hardcoded defaults exactly as before (`effectiveRoleSkills` falls back when zero rows exist) — no
silent behavior change for anyone who doesn't opt in.
