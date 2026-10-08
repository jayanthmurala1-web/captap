# 019 — Rate limiting

**Problem:** Nothing limits how often anyone can call the API. A leaked or looping MCP token can hammer the database; the copilot endpoint spends our Groq quota per call; sign-in can be brute-forced; the public client-approval form (no account) can be spammed into the audit log and approval history.
**Who pays / why it matters to revenue:** A runaway agent or one abusive visitor degrades or takes down the product for every paying agency, and copilot calls cost real money. Basic limits are table stakes before any public launch.
**Success metric:** Each surface below returns HTTP 429 (or a clear form error) with a retry time once its limit is exceeded, normal use never notices, and a shared limit holds across serverless instances.

## Design
- **Shared store = the existing Postgres.** In-memory limits do nothing on Vercel (each instance has its own memory). One table `rate_limit(key unique, count, last_request)`; no new service or dependency.
- **One atomic upsert per check** (fixed window): increments, or resets when the window has passed, and returns the count in a single statement, so concurrent requests cannot both slip under the limit.
- **Limits** (per user id when signed in, else per IP; all in `src/lib/rate-limit.ts`): MCP 120/min, copilot chat 20/min, project API routes 120/min, live task stream 12 connects/min, editor image upload 30/min, public client approval submit 10/hour per IP. Sign-in/up and the rest of `/api/auth`: Better Auth's built-in limiter, switched on for every environment and pointed at the same table.
- **If the limiter's own database call fails, the request is allowed and the error is logged loudly** (a limiter outage must not take the product down). This is the deliberate tradeoff; the ceiling is "no limit while the DB is failing", when the app is failing anyway.

## Acceptance criteria
- [ ] `hit(key, max, window)` allows exactly `max` calls per window, isolates keys, resets after the window, and under 10 parallel calls with max 5 lets exactly 5 through.
- [ ] Blocked calls carry a positive `retryAfter`; the HTTP responses set `Retry-After`.
- [ ] MCP, copilot, project API routes, stream, upload and approval submit are guarded; a real request loop against the running app gets 429 after the limit (verified with real requests, not only unit tests).
- [ ] Better Auth's limiter is on with database storage; repeated bad sign-ins return 429.
- [ ] A limiter database failure allows the request and logs an error (test).

## Out of scope
Per-organization plans/quotas (billing does not exist), IP allow/deny lists, CAPTCHA, WAF/DDoS protection (Vercel's edge handles volumetric attacks), limits on the public page render itself (the token is 256-bit; guessing is infeasible).

## Research
None: fixed-window counter in Postgres is standard; Better Auth ships a limiter with a database storage option (`rateLimit.storage: "database"`, `customRules`), used for `/api/auth` rather than duplicating it.

## Evals / tests
`src/lib/rate-limit.test.ts`: allow/deny, key isolation, window reset, parallel atomicity, fail-open on DB error. Route-level: real HTTP loop against the dev server.
