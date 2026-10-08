# 026 — Flow/Agent restructure: kill the standalone Agents page, blank-by-default canvas

## Problem
Founder feedback, direct: the Flow canvas (spec 025) still showed 4 phantom agent nodes on a brand
new org nobody asked for ("random square boxes", "why are you seeding mock data"), there was no way
to create or edit an agent without leaving the canvas, no way to delete a connection, the React Flow
free-tier watermark was visible, and the standalone `/skills` "Agents" list page duplicated what Flow
was supposed to own. Separately: wanted `/ai` (provider key management) removed, the chat page
(formerly `/ask`) renamed to **Agent**, and the project-settings skill UI to say "skill" not "agent"
now that "agent" means something specific (a Flow node / the Agent chat page).

## Decision
- **No more auto-seeded skill rows.** `afterCreateOrganization` no longer calls `seedDefaultSkills` —
  new orgs get zero real skill rows, so Flow starts genuinely blank. Safe because `availableAgents()`
  (Consult/Ask) and `effectiveRoleSkills()` (task matching) each independently fall back to the
  built-in defaults when no real rows exist — removing the seed call doesn't break either.
- **Flow canvas reads real rows only** (`getEffectiveSkills`, not `availableAgents`) — it shows
  exactly what the org has actually added, never invented defaults.
- **Agent creation/editing moved onto the canvas.** A "+ Add agent" button opens a dialog (name,
  description, kind, playbook) that creates the skill and drops a node in one action — no navigating
  away. Clicking an existing skill node opens the same dialog pre-filled, with a remove action.
- **Standalone `/skills` list page deleted.** `/skills/[id]` and the project-settings skill
  form/list stay — they're still the real editor for *project-level* overrides, a genuinely different
  job from Flow's org-level canvas. Its wording changed from "agent" to "skill" to stop colliding with
  the new vocabulary.
- **`/ai` deleted** (provider key management/BYOK). Real capability loss, flagged plainly: there's
  currently no UI path to add your own provider key or recover from a usage-allowance error. Not
  silently dropped — founder's explicit call, open item if BYOK needs to come back somewhere.
- **`/ask` renamed to `/agent`** (nav label "Agent"), reusing the same `useConsult` hook the compact
  drawer uses — extracted during this pass so the two surfaces don't duplicate the SSE/streaming logic.
- Edges are deletable by clicking them directly (no hidden select-then-Backspace step). React Flow's
  free-tier attribution badge removed (`proOptions.hideAttribution` — MIT licensed, legitimate).
- Real node design for both skill and role nodes (icon, kind-colored border, badge) replacing React
  Flow's bare default rectangles.

## Verified
Real browser run on a fresh signup: nav shows Agent/Org Flow (not Agents/AI models), `/flow` renders
4 role nodes and zero skill nodes on a brand-new org, no watermark, "+ Add agent" creates a real skill
and a node in one action (5 nodes after), `/ai` and `/skills` both 404. Full suite: 239/239 passing
(one `roles.test.ts` failure traced to a transient Neon connection drop, confirmed by re-running that
file alone — not a regression).

## Out of scope / open items
- Where BYOK key management lives now, if it needs to come back — founder's call.
- Project-level Flow (routing overrides per-project, not just org-level) — spec 025's own stated v2.
