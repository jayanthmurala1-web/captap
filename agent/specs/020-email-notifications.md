# 020 — Email notifications

**Problem:** Captap sends no email at all. Invites are a link the owner has to paste into their own mail ("we don't email invites yet" is on the Team page), a submitter never learns their work was approved or sent back unless they open the app, and the agency never learns a client approved or asked for changes unless they happen to look. The client-approval flow is the product's headline, and its most important event (the client's decision) is silent.
**Who pays / why it matters to revenue:** Agencies pay for "the client approved this" — that only has value if the agency finds out the moment it happens. Invites that arrive in an inbox convert; pasted links get lost. Sent-back notes are how the agent-and-human loop keeps moving.
**Success metric:** The three events below reach the right inbox within seconds, with the right link; a failed send never breaks the action that triggered it and is never silent.

## Design
- **Provider: Resend, called over its REST API with `fetch`** (no SDK, no new dependency; ADR-023). Sender `EMAIL_FROM` on the founder's own verified domain for now ( to be switched to the real Captap domain by changing one env var). Key in `RESEND_API_KEY` (gitignored `.env`, documented in `.env.example`, must also be set in Vercel).
- **Three emails:** (1) invitation → the invitee, with the accept link, who invited them, workspace and role; (2) task decision → the person who submitted the work: approved, or sent back with the note, with the task link; (3) client decision → the person who created that share link: who decided, which version, their note, with the document link.
- **Never breaks the action:** sending happens after the change is committed; any failure (no key, Resend down, bad address) is logged with `console.error` and returned as `{ sent: false }`. The invite screen says plainly whether the email went ("Emailed to x" vs "Couldn't email — copy the link").
- **Never emails reserved/test addresses** (`*.local`, `*.test`, `*.invalid`, `example.com/org/net`): protects the sender's reputation from bounces during development and tests.
- **Plain, honest content:** short, no tracking pixels, no marketing footer. HTML + text versions; every interpolated value HTML-escaped (names and notes are user input).

## Acceptance criteria
- [ ] Creating an invitation emails the invitee (mock-fetch test asserts recipient, subject, link, escaped names); the UI reports sent / not sent.
- [ ] Approving or sending back a task emails the submitter (with the note when sent back); nothing is sent to the decider.
- [ ] A client decision emails the share creator with name, version, decision, note.
- [ ] No key, a Resend error or a network error never throws into the caller, is logged, and returns `sent: false`.
- [ ] Reserved-domain addresses are skipped without calling Resend.
- [ ] One real end-to-end send, to the founder's own inbox, confirmed delivered through Resend's API.

## Out of scope
Notification preferences/unsubscribe (transactional only, three events), digest emails, email-based approval, sending to clients on our behalf (clients still get the link from the agency), inbound email, bounce handling, per-org branding, a template engine.

## Research
Resend's API (`POST https://api.resend.com/emails`, Bearer key; `GET /domains` shows verification). The sender domain was confirmed **verified** on the founder's account before building. Alternatives considered in ADR-023.

## Evals / tests
`src/lib/email.test.ts` with `fetch` mocked: payload shape, escaping, reserved-domain skip, no-key / API-error / network-error → `sent: false` + logged. `invitations`, `tasks` and `document-share` tests assert the right email is requested. One real send verified by hand.
