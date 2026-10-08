# Roadmap

> Superseded 2026-09-27. The previous version of this file described Phases 3.1–4.1: sprints/burndown, multi-agent swarm orchestration, L0–L4 fleet autonomy, webhooks/Slack/Discord bridges, multi-model benchmarking, and a "self-healing CI" engine. That work was built past what an internal product review recommended cutting on day one, with no ADR logging the override, and two of those features were found to fabricate their own success data (see `agent/REALITY_CHECK.md`, ADR-012). This file now tracks only the reaffirmed wedge.

## The wedge (from an internal product review, reaffirmed by ADR-012)
"From client call to agent-ready, client-verified work." Not a project-management platform. Not an agent execution engine — GitHub Agent HQ, Cursor, and Devin already own that fight and have more capital to spend on it. Project OS is the rulebook and checkpoint that sits underneath whichever AI tool a developer already uses.

## Already built (real, keep)
- Auth, orgs, MCP OAuth (spec 001)
- Skills storage (spec 002)
- Documents with versioning + optimistic concurrency (spec 003)
- Task claim/submit/evidence, human-only approval (spec 004, ADR-004, ADR-010)
- Deterministic project status (spec 005, ADR-011)
- Role-based permissions (spec 006)
- GitHub commit/CI verification (spec 007)
- Institutional memory: learned rules auto-injected into tasks (`project_learned_rule`, `matchSkillsForTask`)
- MCP server exposing the above

## Next, in order

### 1. Document/PRD structural linter
Zero-token, deterministic validation on `createDocument`/`updateDocument` when `docType === "prd"`. Rejects with a specific, actionable error — not an LLM call, a structural check like a compiler/linter. Rules: required sections present (Problem & Context, Non-Goals, Acceptance Criteria in a checkable format), each meeting a minimum bar (e.g. Non-Goals must list ≥2 items). Checks against active `project_learned_rule` records too — if a known gotcha mentions "soft deletes," the PRD must acknowledge it or get bounced.
This is the actual differentiator. Nothing else on this list matters if this isn't built, because it's the mechanism that makes "any AI tool, our rules still apply" real instead of a claim.

### 2. Requirement-drift detection
On PR submission, compare the diff/description against the task's acceptance criteria and the PRD it traces back to. Flag drift ("PRD says Stripe, code uses Razorpay"). This is the unowned gap named in an internal product review — nobody in the market does this today.

### 3. Client-facing approval layer
A way for the actual client (not agency staff) to see and approve a requirement or a milestone. Without this, "client-verified work" is a slogan, not a mechanism.

### 4. Multi-client portfolio view
An agency-wide view across all client projects — which are healthy, which are stalled, which client hasn't responded. Current schema is flat org → project with no portfolio layer.

## Required before any of this goes past a prototype
10 real conversations with agency owners. Kill signal: fewer than 3 would pay for items 1 + 3 above. This has never been done — see ADR-012. Do not build features 3 or 4 before this happens.

## Explicitly not doing (see ADR-012, docs/vision/architectural-alignment-and-mcp-spec.md)
- Own Kanban board, sprints, burndown charts, story-point estimation
- Multi-agent orchestration, agent "employees," autonomy levels (L0–L4)
- Self-healing/autonomous code execution — Project OS does not run a sandbox or dispatch to Grok/Claude/etc. to write code. The user's own AI tool does the coding; Project OS gates and verifies.
- Multi-model benchmarking, cost dashboards, Slack/Discord event bridges
- "Company DNA Marketplace" (Amazon Way / Stripe Way bundles) — real idea, but scope creep before the linter exists and before any customer has confirmed the base product

## Existing code not yet touched
Sprints, swarm orchestration, fleet autonomy, webhooks/notifications, telemetry/benchmarking still exist in the repo (untouched per ADR-012 — docs-first correction). A future decision needs to decide: strip, quarantine behind a flag, or leave dormant. The fabricating code (`src/lib/worktree/self-heal.ts`, `src/lib/ai/benchmark.ts`) should not be presented to anyone as working functionality in the meantime.
