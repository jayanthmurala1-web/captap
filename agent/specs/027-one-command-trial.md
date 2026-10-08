# 027 — One-command trial (`docker compose up`)

## Problem
Trying Captap today means: create a Neon database, generate auth secrets, copy `.env`, run
migrations, start the dev server. Most curious people stop before step two. A tool nobody can try
in a minute can't spread, and we can't watch anyone use it.

## User / metric
An agency owner or developer who has Docker. Success: from a clean clone, `docker compose up`
leaves a working app at http://localhost:3000 with no accounts and no `.env` edited, in under
5 minutes on a first build and under 30 seconds after that.

## Decision
- Compose runs three containers: Postgres 17, Neon's `wsproxy`, and the app. The app keeps its one
  driver (Neon's serverless client, which speaks WebSocket); `NEON_WS_PROXY` points it at the
  proxy. Unset (production, Neon) nothing changes. No new dependency.
- The app container applies migrations on start (`scripts/migrate.mjs`, same driver), then
  `next start`.
- Trial-only defaults for the auth secret live in `docker-compose.yml`, bound to localhost, with a
  loud comment. Real deployments set their own.
- Email/LLM/GitHub keys are optional and pass through from the host environment if set.

## Acceptance criteria
1. `docker compose up` from a clean clone serves the app and a user can sign up and create a workspace.
2. Restarting keeps data (named volume); `docker compose down -v` wipes it.
3. Migrations are idempotent across restarts.
4. Production Neon behaviour is unchanged when `NEON_WS_PROXY` is unset.

## Out of scope
Seeded demo data, a hosted public demo, a published image, Windows-without-Docker support.
