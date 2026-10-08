# 006 — Pre-Launch Hardening & Role Permissions

**Problem:** 
1. Any organization member can currently invoke founder-only MCP actions (creating projects, PRDs, or batch tasks). A developer agent should only claim, execute, and submit assigned tasks.
2. Teams cannot invite developers or members through the web UI (only direct signup exists).
3. The OAuth consent screen displays raw UUID client IDs instead of human-friendly application names (e.g. "Cursor", "Gemini", "Claude Code").

**Who pays / why it matters:** 
Founders and teams paying for Project OS need role boundaries so external contractor/developer agents cannot tamper with project architecture or wipe PRDs. Teams need an invite mechanism to onboard developers.

**Success metric:** 
- A developer (`role: member`) can claim and submit tasks, but gets a clear `403 Forbidden` if attempting to create projects, PRDs, or tasks via MCP.
- An owner or admin can invite a teammate via email in the web UI.
- The OAuth consent screen displays the registered application name.

## Design

1. **Role-Based MCP Permission Gates**:
   - `create_project`: Requires `requireAdmin` (or owner).
   - `create_document` / `update_document`: Requires `requireAdmin` on the project.
   - `create_tasks`: Requires `requireAdmin` on the project.
   - `claim_next_task`, `claim_task`, `submit_task`, `release_task`, `get_task`, `list_tasks`, `get_project_status`: Allowed for all organization members.

2. **Invite Members UI (`/settings` or `/members`)**:
   - Web UI displaying current organization members (Name, Email, Role).
   - Invite form: Email, Role dropdown (`member` / `admin`), and "Send Invite" action.
   - Pending invitations list with cancel action.

3. **Consent Screen Polish**:
   - Server-rendered or client fetch to resolve `oauthClient.name` from `client_id`.
   - Displays: *"**[App Name]** wants to act on your behalf on Project OS"*. Fall back to client_id if unnamed.

## Acceptance criteria
- [ ] Developer (`member`) attempting `create_project`, `create_document`, or `create_tasks` via MCP receives a DomainError with HTTP 403 / tool error.
- [ ] Admins and Owners can perform all operations.
- [ ] Tests verify that `claimNextTask` and `submitTask` work for `member`, while `createTasks` and `createDocument` are rejected for non-admins.
- [ ] Web UI displays team members and has an active "Invite Member" form.
- [ ] Consent page shows application name instead of raw UUID when available.

## Out of scope
Custom granular permission matrices (RBAC beyond owner/admin/member), email SMTP provider setup (Better Auth stores invitation tokens in DB).
