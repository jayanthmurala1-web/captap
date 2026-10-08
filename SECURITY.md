# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue:

1. Use GitHub's **"Report a vulnerability"** button on this repository's **Security** tab
   (private security advisories).
   Or email [hello@jayanthmurala.com](mailto:hello@jayanthmurala.com).
2. Include what you found, how to reproduce it, and the impact you see.

This is a one-person project, so there is no bug bounty and no guaranteed response time. I aim to
acknowledge a report within a few days and to fix confirmed issues promptly. Please give me a
reasonable chance to fix a problem before you disclose it publicly.

## What's in scope

The application in this repository: authentication and sessions, organization and project
permissions, the MCP endpoint (`/api/mcp`), the public client-approval links, stored provider
keys and connection secrets, and the audit log.

## Known limitations

These are documented rather than hidden:

- Git branch and worktree "isolation" is advisory. The server never touches your repository, so it
  cannot verify an agent actually used the suggested branch.
- Only Groq has been verified end to end among the supported model providers.
- There is no SSO or 2FA yet.
- Email verification is off unless you set `REQUIRE_EMAIL_VERIFICATION=1` (which needs email
  configured). Without it, account emails are not proven to belong to the person who signed up;
  invitations still only work through the link sent to the invited address.
- The MCP endpoint allows unauthenticated dynamic client registration, which MCP clients such as
  Claude Code and Cursor rely on. Registering a client grants nothing by itself: every connection
  still needs a signed-in user to approve it on the consent screen.

## Self-hosting

If you run Captap yourself: use a strong `BETTER_AUTH_SECRET`, set `SECRETS_ENCRYPTION_KEY` (and
back it up, because losing it makes stored connection secrets unreadable), serve it over HTTPS, and keep
the database private. The test suite writes to its database, so never point `DATABASE_URL` at
production when running it.
