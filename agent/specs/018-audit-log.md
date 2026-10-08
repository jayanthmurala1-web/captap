# 018 — Audit log

**Problem:** Nothing records who did what. When a client disputes "we never approved that", or an owner asks "who changed this role / approved that task / edited the PRD", the only evidence is the current state. Task decisions, document edits, role changes and client approvals are exactly the events an agency has to be able to prove.
**Who pays / why it matters to revenue:** Agencies sell "we built what you approved". The audit trail is the receipt behind that claim, and the first thing a larger client's procurement asks for. It also makes the role system (spec 016) safe to hand out: you can see who used a permission.
**Success metric:** Every event in the list below is recorded with actor, time and target; the owner can read them in one screen; no code path can edit or delete them.

## Design
- `audit_event(id, org_id, project_id?, actor_id?, actor_label, action, target_type, target_id?, target_label?, detail jsonb, created_at)`. `actor_label` is a snapshot of the name at the time (people rename and leave); `actor_id` is null for the no-account client. Only `org_id` is a foreign key (cascade, so a deleted organization takes its log with it); actors, projects and targets have none, so rows outlive the people and things they describe.
- **Immutable in the database, not just in code:** a trigger rejects every `UPDATE` and every `DELETE` — except a delete that happens because the whole organization is gone (cascade), so deleting an org (tests, offboarding) still works. No update/delete function exists in the app.
- Written in the same transaction as the change when one exists, so a change never lands without its record and a rolled-back change leaves none.
- Events (action → detail): `task.created|updated|deleted`, `task.submitted`, `task.approved|rejected` (note), `document.created|updated` (version), `document.deleted`, `document.shared|share_revoked`, `client.approved|changes_requested` (version, client name; no actor account), `role.created|updated|deleted` (capabilities before→after), `member.role_changed` (from→to), `invitation.created|cancelled|accepted` (email, role), `project.created`, `project.member_added|member_removed`, `project.github_linked`, `webhook.created|deleted`.
- New capability `view_audit_log` (Owner + Admin by default; migration adds it to existing admin roles). Page `/activity`: newest first, filter by area, 50 per page.

## Acceptance criteria
- [ ] Each action above writes exactly one event with the right actor/target/detail (tests per area).
- [ ] `UPDATE` and `DELETE` on `audit_event` fail at the database; deleting an organization still works.
- [ ] A rolled-back change leaves no event; a committed one always has it.
- [ ] Only people with `view_audit_log` can read; another org's events never appear.
- [ ] `/activity` shows the events with actor, what, target, time; verified in a real browser.

## Out of scope
Export/CSV, retention rules, alerts, per-field diffs of document content (the versions already hold that), IP/user-agent capture, reading events over MCP.

## Research
None needed: an append-only table plus a trigger is standard Postgres; no dependency.

## Evals / tests
`src/lib/audit.test.ts`: per-area event assertions, trigger immutability (raw SQL update/delete rejected), org-delete cascade allowed, rollback leaves nothing, gate + isolation.
