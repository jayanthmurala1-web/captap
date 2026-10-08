# 017 — Requirement-native work structure (replaces Epic/Story)

**Problem:** Work is grouped under a generic `epic` (and a `story` level) that any PM tool has. Nothing ties a task to *what the client agreed to*: the only link is an optional `epic.prd_document_id`, settable only by script (no UI anywhere), one PRD per epic, and a task can't say which requirement it serves. A big project (a checkout PRD, later a loyalty PRD) has no way to see which requirements have no work, or which have approved work.
**Who pays / why it matters to revenue:** Agencies sell "we built what you approved." This makes that a screen: per PRD, every requirement with its tasks and state, and the client's approval next to it. It's the structure the drift check (spec 012) and client approval (spec 013) hang on, and the thing Jira/Linear can't show. Founder decision (2026-09-29): no Epic/Story/Initiative copy.
**Success metric:** For any PRD, an agency owner sees in one screen: requirements with no task, requirements in review, requirements done and approved. Zero requirements need a manual "epic" to be organised.

## Model
Project → **PRD** (a `document` of type `prd`; a project has many, over time) → **Requirement** (one per Acceptance Criteria bullet) → **Task** (linked to ≥0 requirements). The PRD *is* the grouping; there is no separate grouping entity.
- `requirement(id, org_id, project_id, document_id, key, text, removed_at)`, unique `(document_id, key)`. Keys are `R-1`, `R-2`… per PRD.
- **Stable IDs live in the text.** On PRD save, any Acceptance Criteria bullet without a marker gets one written back (`- [R-4] Customer can pay by card`) inside the same versioned save; the existing markers are matched by key, text edits keep the key, reordering keeps keys, a deleted bullet sets `removed_at` (tasks keep the link and show "requirement removed"). Agents and the drift check read the same text.
- `task_requirement(task_id, requirement_id)` many-to-many. `task.prd_document_id` (new column) says which PRD a task is under, even with no requirement linked yet.
- Requirement state is **derived, never stored**: no task · in progress · in review · done (approved by a human) — worst-case rollup of linked tasks; plus "PRD version vN client-approved / changed since" (existing `getApprovalStatus`).
- Untraced tasks (no PRD) are allowed and shown as "Not tied to a requirement" — the honest signal, not an error.

## Decision needed from founder
Can a task link to a requirement in a PRD version the client has **not** approved yet? Recommend **yes, with a visible "not client-approved" badge** — agencies start before sign-off and blocking would push them back to a spreadsheet. Alternative: block linking until approval.

## Migration of existing data
- Epic with a PRD → its tasks get `task.prd_document_id = epic.prd_document_id`. Epic without a PRD → tasks get null (untraced); we do not invent PRDs.
- Epic/story titles are preserved on the task as `task.legacy_group` text ("Epic › Story"), shown as a muted chip; drop the column in a later migration once nobody needs it. `epic` and `story` tables, `task.epic_id/story_id` dropped after.
- Existing PRDs are backfilled: markers written on next save; a one-off script (idempotent) inserts `requirement` rows from current bullets **without** creating new document versions (keys are added lazily on the next real edit; until then a PRD with no markers shows its bullets as unlinked "R-?" and asks to save once). Verified against a copy of prod data before running on prod.

## Acceptance criteria
- [ ] Saving a PRD assigns/keeps stable keys; edit-text, reorder and delete cases each covered by a test; still passes the spec-011 linter; markdown round-trip in the rich editor keeps `[R-n]`.
- [ ] Task create/edit (web dialog + MCP) accepts a PRD and requirement keys. **This is the PRD-link UI** (former Phase 3 item 7): a PRD picker and requirement multi-select on New task and on the task page. No script needed anywhere.
- [ ] Project Tasks view groups by PRD (multiple PRDs per project); PRD page gets a Requirements panel with derived state, linked tasks, coverage counts (n of m have work / approved work).
- [ ] Derived-state rule tested (no task, all done, one in review, one sent back, requirement removed).
- [ ] Drift check (spec 012) and task checklist read the PRD from `task.prd_document_id`; behavior unchanged (LLM prompt untouched — changing it needs its own eval set).
- [ ] MCP `epic`/`story` tools replaced by requirement-aware equivalents; agents receive linked requirement text in task context.
- [ ] Migration test: fixture with epic-with-PRD, epic-without-PRD, story, orphan task → expected task rows; run on a copy of prod data.
- [ ] `epic`, `story` code, tables and UI removed (no dead code).

## Out of scope
Cross-project PRDs, requirement priority/estimates, requirement-level comments, auto-decomposing a PRD into tasks with an LLM, changing the drift prompt, sprint changes (sprints stay a board filter).

## Research
No new dependency and no external algorithm; the model is a decision, not a survey. Considered and rejected: (a) parse-on-read by bullet text hash — breaks on any wording edit, tasks silently orphaned; (b) DB-only ids not in the text — agents and the linter would not see them, and ids would diverge from what the client approved; (c) keep `epic` as a thin wrapper around a PRD — the exact generic layer the founder ruled out. Chosen (marker in text + synced table) keeps the document the single source of truth (ADR-009) and the key visible to the client.

## Evals / tests
`src/lib/requirements.test.ts` (sync, keys, derived state), update `epics.test.ts` → removed/replaced, `tasks.test.ts` (link on create/edit), migration test above, Playwright: create PRD → link task from dialog → submit → approve → requirement shows done + coverage updates; two PRDs in one project stay separate.
