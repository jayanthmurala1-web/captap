# Spec 011 — PRD Structural Linter

**Problem:** PRDs get written by whatever AI tool a user connects (ChatGPT, Claude, Cursor) and pushed into Project OS with `create_document`/`update_document`. Nothing checks the content. A PRD with one line of garbage saves just as successfully as a complete one. This is the mechanism identified in `docs/vision/architectural-alignment-and-mcp-spec.md` and `agent/MASTER_ROADMAP.md` as the actual differentiator vs. Jira/Linear/Plane.so — none of them structurally enforce a document before accepting it.

**Who pays / why it matters to revenue:** Real replies collected 2026-09-27 (internal status log) confirm the underlying pain — agencies losing unbilled hours proving what a client actually approved, AI coding tools drifting past agreed scope. This is the smallest piece that makes "we lock in what was approved" a real, demonstrable mechanism instead of a claim, which is what several real respondents explicitly asked to see before committing to pay.

**Success metric:** A PRD missing required structure is rejected with a specific, actionable error before it's saved. A complete PRD saves without friction. Zero false positives on a real, reasonable PRD (don't block on formatting nitpicks).

## Acceptance criteria
- [ ] `createDocument`/`updateDocument` run structural validation when `docType === "prd"`, before writing to the database.
- [ ] Rejects with `ValidationError` (existing error type, already mapped to readable errors for MCP and web forms — ADR-009) listing every violation found, not just the first.
- [ ] Rule 1 — Problem/Context section present, body ≥ 50 words.
- [ ] Rule 2 — Non-Goals section present, lists ≥ 2 items (bullet lines).
- [ ] Rule 3 — Acceptance Criteria section present and non-empty.
- [ ] Section headers matched case-insensitively, tolerating the obvious naming variants (`## Problem`, `## Problem & Context`, `## Non-Goals`, `## Explicit Non-Goals`, `## Acceptance Criteria`, `## Verifiable Acceptance Criteria`).
- [ ] A valid PRD (all 3 rules satisfied) saves with no error.
- [ ] Validation only applies to `docType === "prd"`. Every other doc type (`brief`, `hld`, `lld`, `erd`, `work_ledger`, `general`) is untouched.

## Out of scope (this spec)
- Gherkin/`Given...When...Then` format checking on acceptance criteria — just "non-empty" for now. Add stricter format checking only if real PRDs show it's needed.
- Checking against `project_learned_rule` gotchas (the "soft deletes" example from the architecture doc). That's a real follow-up, not this spec — it needs the rule text matched against PRD content, which is a second, separable piece of logic.
- Any LLM call. This must stay a zero-token, deterministic check — that's the whole point (ADR-006's cost model, and the "server-as-linter" design in `docs/vision/architectural-alignment-and-mcp-spec.md` section 4).
- Validating HLD/LLD/ERD documents. PRD only, first.

## Research
Not a new decision point — this implements a mechanism already decided in `docs/vision/architectural-alignment-and-mcp-spec.md` section 4 and reaffirmed in ADR-012. No new dependency needed: plain string/regex parsing on markdown headings, no markdown-AST library — the content is always well-formed enough (it's LLM-authored) that heading-line regex is sufficient, and pulling in a parser for 3 section checks would be the over-engineering the project's rules already ban.

## Evals / tests
`src/lib/documents/validator.test.ts`, written before the implementation:
- A PRD missing all 3 sections → rejected, error message names all 3.
- A PRD with a Problem section under 50 words → rejected, names that specific rule.
- A PRD with a Non-Goals section listing only 1 item → rejected.
- A PRD with an Acceptance Criteria heading but empty body → rejected.
- A PRD satisfying all 3 rules → passes, no error.
- A non-PRD doc (`docType: "brief"`) with none of these sections → passes untouched (validation doesn't apply).
- Section header matching is case-insensitive and accepts the listed variants.
