# 024 — Gate enforcement (make "Blocking: YES" actually block)

## Problem
`code-review`/`qa-review` agents already output `Blocking: YES/NO` (spec 008), and the task page's
checklist already shows it. But `decideTask` never reads it — the human Approve button works
regardless. A verdict that doesn't change what runs next is a report, not a gate.

## User
Whoever has "Approve work" on a project — the gate should block them by default, with an explicit,
logged way to override.

## Success metric
A task with a blocking review cannot be silently approved. It can still be approved, but only with
an explicit override checkbox and a required reason, recorded in the audit log.

## Scope
- `decideTask` (`src/lib/tasks.ts`): reads the pending submission's `reviews`, computed via the same
  `isBlockingReview` the UI checklist already uses (`status === "FAIL" || blocking === true` —
  extracted from `review-checklist.ts` so the two can't disagree). Blocking and no override → throws.
  Override without a reason → throws. Override with a reason → approves, and the audit log records
  which review(s) were overridden.
- UI (`task-forms.tsx`, `[id]/page.tsx`): shows which reviews are blocking, an "Approve anyway"
  checkbox gated by `canApprove`, and the note field becomes the required override reason.
- Not exposed over MCP (consistent with ADR-004: approval is human-only, already true, unchanged).

## Out of scope
- Blast-radius-based auto-approval lanes (reversible/contained vs. hard-to-reverse) — a real next
  step, not this spec.
- A cap on correction attempts before escalating — also a real next step, not this spec.

## Acceptance criteria
- [ ] A submission with a blocking review cannot be approved without `overrideBlocking: true`.
- [ ] Overriding without a note throws.
- [ ] Overriding with a note succeeds and the audit log entry names the overridden review(s).
- [ ] The UI's "blocking" label and the server's enforcement use the same definition (shared
      `isBlockingReview`), so they can never show PASS while the server blocks, or vice versa.
