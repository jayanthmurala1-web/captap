# 023 — Connections (external tool connectors)

## Problem
Captap only talks to coding agents (inbound MCP). It has no way to notify a team where they actually
work (Slack), verify delivery against a second independent source (GitHub), or attach to any other
external MCP server an org already runs (Figma, Drive, internal tools) — without Captap shipping a
bespoke, maintained integration for every vendor one at a time.

## User
Org owner/admin (add/remove a connection). The system (not a human) uses a connection afterwards —
e.g. a Slack message on client decision, GitHub verification on task submission.

## Success metric
An org can add a Slack webhook and get a real message when a client approves/requests changes, with
zero code changes needed for that org. An org with its own MCP server for anything else (Figma, an
internal tool) can attach it without Captap writing vendor-specific code.

## Scope (v1)
One `connection` table, one encrypted secret column (reusing `src/lib/secrets.ts`, spec 021's
pattern), three kinds:
- **`slack_webhook`**: an Incoming Webhook URL the org pastes from their own Slack workspace (no OAuth
  app needed). Validated on save with a real test POST.
- **`github_pat`**: a personal access token, validated on save against `GET /user`. Used by
  GitHub-verification code paths instead of/alongside the single global `GITHUB_TOKEN` env var.
- **`custom_mcp`**: a remote MCP server URL + optional bearer token. Validated on save with a real MCP
  `initialize` handshake (new dependency: `@modelcontextprotocol/sdk` client — see ADR). This is the
  generic "custom add" — any tool with an MCP server (official or community) works without Captap
  building per-vendor code.

Wiring (v1, one real trigger point, not a demo): `submitApproval` (`document-share.ts`) sends a Slack
message via the org's `slack_webhook` connection, if one exists, alongside the existing email.

## Out of scope (v1)
- Actually calling tools on a `custom_mcp` connection from a Captap feature (storage + live-validated
  handshake only, for now — using it in, say, Consult is a separate spec).
- OAuth-based connectors (Slack App, GitHub App, Google) — v1 is token/webhook-based, no OAuth app
  registration required from the founder.
- Full GitHub PAT replacing `GITHUB_TOKEN` everywhere — only net-new call sites use it in v1.

## Acceptance criteria
- [ ] Only org owner/admin can add/remove a connection (`manage_org_settings`).
- [ ] Each kind is validated live on save; an invalid token/URL/MCP server is rejected with a clear
      error, nothing is stored.
- [ ] Secrets are encrypted at rest (AES-256-GCM, same as spec 021's provider keys); never returned to
      the browser in full.
- [ ] A client decision (approve/request changes) posts to Slack when a `slack_webhook` connection
      exists for that org; nothing breaks if it doesn't (best-effort, same pattern as the existing
      email notification).
