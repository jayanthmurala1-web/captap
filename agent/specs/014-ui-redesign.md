# 014 — UI/UX redesign (Captap)

**Problem:** The UI has no information hierarchy. The product's real differentiators (PRD linter, requirement-drift, client approval — specs 011–013) get the same visual weight as sprint ceremony and scope-creep panels, and two panels present fabricated data (self-heal CI, simulated benchmark) as real. 1,404 hardcoded color classes bypass the theme tokens, so the UI can't be rethemed in one place.
**Who pays / why it matters to revenue:** Agencies buy proof of what the client agreed to. The client-facing approval page is the one surface a non-customer sees during a sale; the app itself has to make the differentiators obvious in a demo instead of burying them among 7+ tabs.
**Success metric:** In a demo, share-link → client approval → task drift warning is reachable in ≤3 clicks from a project, with no fake capability visible anywhere.

## Decisions (founder, 2026-09-28)
- Brand: **Captap**. Wordmark font: **Fontdiner Swanky** (Google Fonts, `next/font`), wordmark only — never UI text.
- Theme: app has dark + light toggle, dark + green accent is the default. `/approve` is **light-only** (client-facing, reads like a contract).
- Components: formally init shadcn/ui (ADR when it lands in screen 2).
- Fake code (self-heal CI, benchmark): removed from UI **and deleted**.
- Kept but demoted out of primary nav: learned rules/skills, sprints (board filter, no ceremony button), webhooks (project settings), AI copilot drawer.

## Screen order
1. `/approve/[token]` — client page ✓
2. Theme tokens + app shell / nav IA (shadcn init, toggle, delete fake code) ✓
3. Task detail ✓
4. Document detail + all-types document list (+ in-app XSS fix) ✓
5. Board + status summary (sprints = filter only) ✓
6. Projects list + create-org screen + new-project dialog ✓
7. Sign-in/sign-up + accept-invitation + MCP consent ✓
8. Members + project settings panels (team, rules, webhooks) + Rules pages (`/skills`, `/skills/[id]`) ✓
9. Copilot drawer ✓

Every screen is a full redesign (IA, layout, components), not a recolor. Legacy screens only carry the new tokens as an interim state until their turn (founder, 2026-09-28).

## Screen 1 — acceptance criteria
- [x] `getSharedDocument` also returns `orgName` (the sharing agency) and `updatedAt` (when the shown version was created).
- [x] Page shows who is asking ("{org} is asking you to review {title}"), version number and last-updated date.
- [x] Approve / Request changes are the two submit actions; request-changes requires a note.
- [x] Copy states the approval is pinned to this version.
- [x] After submit: a receipt (decision, version, name, timestamp). No claim that the agency was notified (no notification exists).
- [x] Invalid/revoked token: generic styled not-found, same for both.
- [x] Always light, regardless of OS/app theme. Readable at phone width.

## Out of scope
Section comments, PDF export, notifying the agency on approval (separate spec — real value).

## Evals / tests
Extend `src/lib/document-share.test.ts`: shared doc includes `orgName` and `updatedAt`. Layout is verified in the browser, not by tests.
