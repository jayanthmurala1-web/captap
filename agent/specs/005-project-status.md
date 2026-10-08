# 005 — Project status ("resume project")

**Problem:** Returning to a project after days or months means reconstructing its state from memory. A new agent session starts blind.
**Who pays / why it matters:** IDEA.md's "memory for the product". This is the first thing an owner checks each morning and the first call an agent makes when resuming.
**Success metric:** One MCP call or one screen answers: how far along, what's blocked, what needs me, what's next, what changed recently.

## Design
Deterministic, computed from data. No LLM, no invented health scores (PRD §75: health is derived from signals).
- Progress: task counts per status, % done.
- **Needs a human:** tasks in review (oldest first).
- **Blocked:** todo tasks with unfinished dependencies (and what blocks them).
- **Stale:** in-progress claims older than 24h (agent likely gone → release).
- **Sent back:** in-progress tasks carrying a review note.
- **Next up:** first 5 claimable tasks.
- **Recent activity:** latest document versions and task decisions.
- Last activity timestamp.

## Acceptance criteria
- [x] `getProjectStatus` returns the above; tenant-isolated.
- [x] MCP `get_project_status(project_id)`; server instructions say "call this first when resuming a project".
- [x] Project page shows a status panel at the top.
- [x] Test covering blocked/stale/review/next classification.

## Out of scope
AI summaries (in-app AI spec), notifications, portfolio view across projects.
