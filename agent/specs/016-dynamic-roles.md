# 016 — Org-defined roles (capability flags)

**Problem:** Roles are hardcoded: org `owner|admin|member` (text checked by string compare in ~8 places outside `access.ts`), project `developer|qa|devops|product|lead` (Postgres enum). An agency can't say "our QA can approve work but can't invite people", and today *nobody* is gated on approving: `decideTask` only checks project membership + the ADR-004 self-approval rule, so any developer can approve a teammate's work.
**Who pays / why it matters to revenue:** Agency owners hand different people different power over client work. Being able to say "only these people can approve what ships" is part of what the client-approval trail is worth. Founder decision (2026-09-29): build it now.
**Success metric:** An org admin creates a role, ticks capabilities, assigns it, and the assignee's real access changes with no deploy; every existing member keeps exactly today's access except the one intended change below.

## Model
- One table `org_role(id, org_id, slug, name, capabilities text[], is_system, unique(org_id, slug))`. One role list per org, usable at both levels (founder: "both, one system").
- `member.role` (Better Auth's text column) and `project_member.role` (enum → text) both store a role **slug**. Existing values (`owner`, `admin`, `member`, `developer`…) are already valid slugs → **no member data changes**.
- Effective capabilities in a project = org role's caps ∪ project role's caps. Org-scope caps come from the org role only.
- Capabilities (mapped 1:1 from today's `requireAdmin`/`requireProjectAdmin` call sites, nothing speculative):
  - Org: `invite_members`, `manage_roles`, `create_projects`, `manage_org_settings` (org rules + org webhooks), `access_all_projects`
  - Project: `approve_tasks` (new), `manage_tasks` (create/edit/assign, epics, sprints), `manage_documents`, `share_with_client`, `manage_project_settings` (GitHub, project members, project webhooks)
- Seeded system roles per org: `owner` (all, locked), `admin` (all), `member` (none), `lead` (all project caps), `qa` and `product` (`approve_tasks`), `developer`, `devops` (none). Only `owner` is locked; others are editable, not deletable while assigned.
- `access.ts` gains `requireCapability(userId, orgId|projectId, cap)`; `requireAdmin`/`requireProjectAdmin` are replaced call site by call site (list above). Inline `role === "admin"` checks in pages become a capability read.

## Decision needed from founder
**Behavior change:** `approve_tasks` is granted to owner, admin, lead, qa, product only. `developer`, `devops` and plain `member` lose the ability to approve. This is the one intentional change; it closes the "developer approves teammate's work" hole. Alternative: seed everyone with it (zero change, hole stays open).

## Acceptance criteria
- [ ] Migration creates `org_role`, seeds the 7 system roles for every existing org, converts `project_member.role` enum→text, drops the enum. A test seeds pre-migration fixtures for each old role and asserts the resulting capability set equals the old behavior (except `approve_tasks` above).
- [ ] New orgs get the 7 roles at creation (existing `afterCreateOrganization` hook).
- [ ] `decideTask(approved)` requires `approve_tasks`; rejecting stays allowed for anyone who can view the task (unchanged).
- [ ] Every former `requireAdmin`/`requireProjectAdmin` site checks the mapped capability; no string compare on role names remains outside seeding.
- [ ] Admins with `manage_roles` can create / rename / edit capabilities / delete a role (Team page). Deleting a role that is assigned, or editing/deleting `owner`, is refused with a clear message. An org can never end with zero owners.
- [ ] Invite and project-member pickers list the org's roles (no hardcoded lists). Invitation acceptance assigns a custom slug correctly.
- [ ] Better Auth's own mutating org endpoints (`/organization/update-member-role`, `invite-member`, `remove-member`, …) are added to `disabledPaths` — they enforce only BA's 3 built-in roles and would bypass ours. Test: they return 404.
- [ ] A custom role is checked end to end in the real UI (create "Reviewer" with only `approve_tasks` → assignee can approve, cannot create tasks or invite).

## Out of scope
Per-project role overrides, role inheritance, `can_edit_billing` (no billing code exists; add when billing does), custom capabilities, 2FA/SSO, audit of role changes (its own spec — it will consume these events).

## Research
Better Auth's dynamic access control (`dynamicAccessControl`, `organizationRole` table; `node_modules/better-auth/dist/plugins/organization/has-permission.mjs`). **Rejected:** (1) org-level only — `project_member` roles are ours, so we'd run two systems; (2) its permissions are `{resource: [actions]}` enforced only inside BA's own endpoints, and the app calls just two BA org APIs (`createOrganization`, `setActiveOrganization`; grep-verified), so we'd still need our own resolver; (3) couples our capability list to the plugin's statement schema. Own table = no new dependency; ADR-019 logged when built.

## Evals / tests
`src/lib/roles.test.ts` (capability union, owner lock, last-owner, delete-in-use, migration equivalence); update `tasks.test.ts` (developer cannot approve, qa can); disabledPaths test; Playwright pass on the custom-role flow.
