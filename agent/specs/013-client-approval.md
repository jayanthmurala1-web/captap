# Spec 013 — Client-Facing Approval

**Problem:** Every "approval" in the system today happens inside the agency — an org owner/admin decides a task via `decideTask`. The actual client, who isn't an org member and doesn't have (or want) a login, has no way to see or approve anything. This makes "client-verified work" a phrase, not a mechanism, and it's the specific gap named in an internal product review as the unowned wedge. Spec 011 makes a PRD structurally real; spec 012 checks work against it — but nobody outside the agency has actually confirmed the PRD is what they asked for in the first place.

**Who pays / why it matters to revenue:** Same real pain confirmed in the founder's outreach — "proving what was actually agreed when the client comes back with changes." Without this, "client-approved" in spec 012's drift check is still just the agency's own internal document, not something the client themselves signed off on. This closes that gap.

**Success metric:** An agency can generate a link for a specific document, send it to a client with no account, and the client can approve or request changes without any onboarding. That approval is visibly tied to the exact version they saw.

## Design
1. **No client accounts, no custom auth.** A client approves via an unguessable, revocable share token in the URL (the same pattern as a Figma/Loom share link) — not a login. Matches the project's ban on custom auth; this isn't authentication, it's a capability link.
2. **Schema — two new tables:**
   - `document_share`: `id`, `documentId` (FK), `token` (unique, random 32-byte hex), `createdBy`, `createdAt`, `revokedAt` (nullable).
   - `document_approval`: `id`, `documentId` (FK), `version` (the specific version shown when approved — ties approval to an exact snapshot, not "the document" in general), `decision` (`"approved" | "changes_requested"`), `approverName`, `approverEmail` (optional), `note` (required if `changes_requested`), `createdAt`.
3. **Web routes, no auth required:**
   - `GET /approve/[token]` — renders the current published content of the linked document, read-only, plus an Approve / Request Changes form. 404s (generic, doesn't leak which doc) if the token is invalid or revoked.
   - `POST` action on that page records a `document_approval` row against the version the client actually saw at render time (not whatever the latest version is by the time they submit — prevents a race where the doc changes mid-review).
4. **Inside the app:** an admin can generate a share link for a document (`createDocumentShare`) and revoke it (`revokeDocumentShare`). The document/task pages show the latest approval status and flag it stale if the document has a newer version than what was approved ("Client approved v2, PRD is now v3 — re-share before relying on this").
5. **Deliberately excluded from this pass:** email delivery (the agency copies/sends the link themselves, same as sharing a Loom link today), MCP tool exposure (same underlying functions, wire in a follow-up once the web flow is proven), multi-approver workflows, expiring tokens (a straight revoke is enough for v1).

## Acceptance criteria
- [ ] `createDocumentShare(userId, documentId)` — admin-only, generates a token, returns the shareable path.
- [ ] `revokeDocumentShare(userId, shareId)` — admin-only, sets `revokedAt`.
- [ ] `getSharedDocument(token)` — no `userId` required. Returns the document's current published content and title if the token is valid and not revoked; throws `NotFoundError` otherwise (same error for "invalid" and "revoked" — don't leak which).
- [ ] `submitApproval(token, { decision, approverName, approverEmail?, note? })` — no `userId` required. Records the approval against the exact version that was current when the share was fetched (pass the version explicitly, don't re-derive it from "latest" at submit time). `changes_requested` requires a non-empty `note`; `approved` does not.
- [ ] `getApprovalStatus(userId, documentId)` — admin-only (internal view), returns the latest approval (if any) plus whether it's stale (approved version < document's current version).
- [ ] A revoked or nonexistent token behaves identically from `getSharedDocument`'s caller's perspective (can't distinguish "revoked" from "never existed").
- [ ] Tenant isolation: `createDocumentShare`/`revokeDocumentShare`/`getApprovalStatus` all require the caller to be an admin of the document's own org.
- [ ] `/approve/[token]` page renders with no session/login and works in an incognito-equivalent request.

## Out of scope
- Email delivery of the link.
- MCP tools (same functions, follow-up once proven).
- Client accounts, multiple approvers, expiring tokens, approving anything other than a document (no task/PR-level client approval yet).

## Research
Not a new architectural decision — reuses the existing document/documentVersion versioning model from spec 003/ADR-009. The share-token pattern (random opaque token in URL, no account) is the standard low-friction approach for external stakeholder approval (Figma, Loom, DocuSign-lite use the same shape); no new dependency needed, `node:crypto`'s `randomBytes` covers token generation.

## Evals / tests
`src/lib/document-share.test.ts`, written before implementation:
- Admin creates a share, `getSharedDocument(token)` returns the document content with no `userId`.
- An invalid token and a revoked token both throw the same `NotFoundError` from `getSharedDocument`.
- `submitApproval` with `decision: "approved"` succeeds with no note.
- `submitApproval` with `decision: "changes_requested"` and no `note` rejects with `ValidationError`.
- `submitApproval` records the version passed in, not whatever the document's latest version is at call time (simulate: fetch share at v1, document gets updated to v2, submit approval — recorded version is 1).
- `getApprovalStatus` returns `stale: true` when the document's current version has moved past the approved version.
- A non-admin (regular member) cannot call `createDocumentShare`/`revokeDocumentShare`/`getApprovalStatus` — `ForbiddenError`.
- A user from a different org cannot create a share for, revoke, or check approval status on a document they don't own — `NotFoundError`.
