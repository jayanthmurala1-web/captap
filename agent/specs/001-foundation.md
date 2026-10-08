# 001 — Foundation

**Problem:** Nothing exists. Every later feature needs users, orgs, projects, and an MCP endpoint that agents can authenticate to.
**Who pays / why it matters:** No login, no tenants, no product. The MCP connection is the core of the product's value.
**Success metric:** A user signs up, creates an org and a project, connects Claude Code to `/api/mcp` via OAuth, and `list_projects` returns only their org's projects.

## Acceptance criteria
- [x] Next.js app (TS strict, Tailwind, Biome, Vitest) runs with `pnpm dev`.
- [x] Drizzle schema + migrations against the Neon dev branch.
- [x] Better Auth: email/password sign-up/sign-in, organization plugin (create org, active org), MCP OAuth provider.
- [x] Tables: Better Auth tables + `project` (id, org_id, name, description, created_by, timestamps).
- [x] Web: sign up, sign in, create org, create/list projects.
- [x] `/api/mcp` rejects unauthenticated requests (401 + OAuth discovery metadata).
- [x] MCP tool `list_projects` returns only projects in orgs the caller is a member of (tokens carry no active org; each result includes org name).
- [x] Test: org A cannot read org B's projects through the data-access layer.

## Out of scope
Skills, tasks, PRD docs, in-app AI, invites UI, email verification, OAuth social login, payments, deploy.

## Research
Better Auth has native MCP OAuth. The MCP SDK v2 handler is built in, so no adapter is needed. See ADR-006/007.

## Evals / tests
`src/lib/projects.test.ts`: tenant isolation.
Manual: `claude mcp add --transport http projectos http://localhost:3000/api/mcp`, then OAuth, then `list_projects`.
