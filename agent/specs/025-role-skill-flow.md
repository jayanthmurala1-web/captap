# 025 — Role → Skill routing, visual config canvas

## Problem
Which skill auto-attaches to which task role is hardcoded in `skills.ts` (`roleSkillMap`) — no org
can change it. `devops` role maps to skills named `"deployment"`/`"ci-cd"` that have never existed,
so devops tasks get no agent guidance by default. Founder wants full org control over this, and
wants to configure it visually (node/edge canvas, like n8n), not through a settings form.

## Decision (founder-confirmed, see conversation): visual **config**, not a runtime engine
The canvas edits which skill(s) route to which role — real data the system already uses
(`matchSkillsForTask`). It does not execute anything itself. Captap still hands work to whatever
coding agent is connected (Claude Code, Cursor, etc.) exactly as today; this just makes the routing
table an editable org setting instead of a hardcoded constant, with a visual editor on top.

## Scope
- `role_skill_route` table: (orgId, role, skillName), one row per connection. Replaces the hardcoded
  `roleSkillMap` for any org that has configured it; orgs that haven't keep the old hardcoded default
  (`effectiveRoleSkills` falls back when the org has zero rows) — no silent behavior change for
  existing orgs.
- `/flow` page: a node canvas (`@xyflow/react` — the library n8n/ElevenLabs Flow are themselves built
  on; hand-rolling drag/connect/pan/zoom would be reinventing a well-maintained wheel). Two columns:
  the 4 fixed task roles (product/developer/qa/devops) and the org's skills. Drag a connection between
  a skill and a role to route it; remove an edge to unroute it. Save persists via a server action.
  Positions are not persisted (auto-layout on load) — cosmetic, not core value, add later if asked.
- Admin-only (`manage_org_settings`), same as editing a skill today.

## Out of scope (explicitly, per founder's own choice this session)
- Any execution engine. The canvas never runs a pipeline; it only edits routing data.
- Project-level routing overrides (org-level only, v1).
- Persisted node positions / custom layouts.

## Acceptance criteria
- [ ] An org with no configured routes behaves exactly as before (hardcoded defaults).
- [ ] An org admin can add/remove a role↔skill connection on the canvas; it persists.
- [ ] `matchSkillsForTask` uses the org's configured routes when present.
- [ ] Non-admins cannot change routing (same capability as editing a skill).
