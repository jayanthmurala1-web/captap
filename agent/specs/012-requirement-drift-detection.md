# Spec 012 — Requirement Drift Detection (task ↔ PRD)

**Problem:** `code-review`/`qa-review` (spec 008, `src/lib/persona-review.ts`) already check a submission against **the task's own acceptance criteria** via an LLM call on every submission. But nothing checks the task's acceptance criteria against the **PRD it came from** — a task can already have drifted from what the client approved by the time it's written (e.g. the PRD says "Stripe," someone writes a task that says "add payment processing," a developer or agent picks Razorpay, and the task-level review passes cleanly because the task itself never mentioned Stripe). This is the unowned gap named in an internal product review and in real replies collected 2026-09-27 (the internal status log) — proving what was actually approved when a client pushes back.

**Who pays / why it matters to revenue:** Same real signal as spec 011 — agencies losing unbilled hours arguing about what was approved. This is the second half of "locks in what was approved and flags drift before it's a fight" — the exact phrase used in the real outreach post, and the feature real respondents asked to see before committing to pay.

**Success metric:** A task whose acceptance criteria (or a submitted diff) contradicts a named decision in its parent PRD gets flagged before human approval, with a specific quote from the PRD, not a vague warning.

## Design
1. **Schema:** add `epic.prd_document_id` — nullable `uuid` referencing `document.id`. An epic optionally traces to the PRD it was decomposed from. (Not on `task` directly — an epic groups the stories/tasks that came from one PRD, matching the existing epic→story→task hierarchy; a task with no epic simply has no PRD to check against, and this feature is a no-op for it.)
2. **No new deterministic subsystem.** Semantic drift ("does this diff still match the intent") is not a string-matching problem the way spec 011's structural check was — it needs judgment. Reuse the existing, already-paid-for LLM review pipeline (`evaluatePersona` in `persona-review.ts`) instead of building a second one:
   - Add one more default skill, `requirement-drift` (kind: `review`), alongside `code-review`/`qa-review`.
   - Extend `PersonaEvaluationInput` with an optional `prdContent: string | null` — when the task's epic has a linked PRD, fetch its latest published content and pass it into the same system prompt already used for `code-review`/`qa-review`.
   - The skill's prompt instructs: compare the diff and summary not just to the task's acceptance criteria, but to any named technology, vendor, or explicit decision in the PRD; flag a `CRITICAL` finding for a direct contradiction (PRD names X, diff clearly implements Y instead), not for a mere absence.
3. **Cost is real and already accepted.** This runs on the same Groq call already made for `code-review`/`qa-review` when a PRD is linked — no new LLM spend model, just a longer prompt. If `GROQ_API_KEY` is unset, it degrades the same way existing persona review already does (`NEEDS_WORK`, non-blocking, "review skipped").
4. **Linking an epic to a PRD is manual for now** — an admin sets `prd_document_id` when creating/editing an epic. No auto-detection.

## Acceptance criteria
- [ ] `epic.prd_document_id` column added, nullable, FK to `document.id`, `onDelete: "set null"`.
- [ ] `createEpic`/`updateEpic` accept an optional `prdDocumentId`.
- [ ] `runPersonaReview` fetches the parent PRD content when the submitted task's epic has one linked, and passes it to `evaluatePersona`.
- [ ] A new `requirement-drift` default skill exists, seeded the same way as `code-review`/`qa-review`.
- [ ] A submission whose diff/summary contradicts a named decision in the linked PRD produces a `CRITICAL`, `blocking: true` finding in the stored `ReviewResult`.
- [ ] A submission with no linked PRD behaves exactly as today — no new finding, no new cost, no error.
- [ ] A submission consistent with its PRD passes with no drift finding.

## Out of scope
- Auto-linking an epic to a PRD (e.g. from `synthesizeProjectArchitecture`) — manual only, for now.
- Drift detection against HLD/LLD/ERD — PRD only.
- Any UI beyond what already renders `ReviewResult` findings on the task page — this reuses existing display, no new component.
- Blocking merge automatically on a drift finding — same rule as everything else in this project: a human still approves (ADR-004). A `CRITICAL`/`blocking` finding is a strong warning shown to the reviewer, not an automatic rejection.

## Research
Not a new architectural decision — this is additive to the existing persona-review mechanism from spec 008, reusing its LLM call rather than introducing a second one. No new dependency.

## Evals / tests
`src/lib/persona-review.test.ts` (extend existing suite):
- Task with no linked PRD → `evaluatePersona` called without `prdContent`, behavior unchanged from today.
- Task with a linked PRD, diff/summary consistent with it → no drift finding, `PASS`/existing behavior preserved.
- Task with a linked PRD, diff/summary naming a different technology than the PRD explicitly named → `CRITICAL` finding present, `blocking: true`.
- `GROQ_API_KEY` unset, PRD linked → degrades to `NEEDS_WORK`, non-blocking, same as current behavior for other skills.
- `createEpic`/`updateEpic` round-trip `prdDocumentId` correctly; tenant isolation holds (can't link to another org's document).
