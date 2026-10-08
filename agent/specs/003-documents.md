# 003 — Project documents (PRD first)

**Problem:** The PRD lives in a chat window or a Google Doc. Agents can't reach it, versions get lost, and nobody knows what changed.
**Who pays / why it matters:** Flow A in IDEA.md: transcript → AI tool → "save this as the PRD" → the project has a living, versioned PRD every agent can read. It is the input to task breakdown (spec 004) and the project's memory.
**Success metric:** From Claude Code, a user creates a project and its PRD in one conversation, then an agent in another session reads the same PRD.

## Model
- `document`: belongs to a project. `kind` = `prd` | `doc`. Holds title and `current_version`.
- `document_version`: immutable content snapshot (markdown) with author and change note. History is never rewritten.
- **Optimistic concurrency:** an update must pass `base_version`. If someone saved in between, the update fails with the current version number, so the agent re-reads and merges. No silent lost updates.
- The server does no AI (ADR-002). The *client's* agent applies the prd-writing skill; tool descriptions tell it to.

## Acceptance criteria
- [x] Create/update/get/list documents; get any past version; content ≤ 500 KB; title 1–200 chars.
- [x] Update with a stale `base_version` → conflict error naming the current version.
- [x] Any org member can read/write a project's documents; outsiders get not-found.
- [x] MCP: `create_project`, `list_documents`, `get_document(document_id, version?)`, `create_document`, `update_document(document_id, content, base_version, note?, title?)`.
- [x] Web: project page lists documents; `/documents/[id]` renders markdown safely (no raw HTML), shows version history, edits with a change note; view old versions.
- [x] Tests: versioning, conflict, isolation.

## Out of scope
Version diffs, comments, real-time co-editing, search, attachments/diagrams.

## Research
Rendering: `react-markdown` + `remark-gfm` (tables, task lists). Raw HTML is disabled by default, so it's XSS-safe without a separate sanitizer.
