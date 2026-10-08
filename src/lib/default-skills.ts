// Seeded into every new org as editable starting points. Tool-agnostic: works in any Agent Skills client.
// Kept under ~5k tokens each (agentskills.io progressive-disclosure guidance).

const prdWriting = `---
name: prd-writing
description: Turns raw product input (client meeting transcripts, call notes, chats, rough ideas) into a structured Product Requirements Document. Use when asked to write, draft, structure or update a PRD, or to turn a transcript or notes into requirements.
---

# PRD Writing

Your job is to turn messy input into a PRD that a team of humans and AI agents can build from without asking basic questions. Accuracy beats completeness: a short PRD with honest gaps is better than a long one with invented requirements.

## Golden rule: never invent

Tag every requirement with its certainty:

- **[Confirmed]**: the client or owner stated it explicitly. Quote or cite the source line when you can.
- **[Assumption]**: you inferred it. Say what it is based on.
- **[Open question]**: needed to build, but unknown. Phrase it as a question someone can answer with a short reply.

If the input says "maybe", "probably", "we'll see" or similar, it is not Confirmed.

## Process

1. Read all of the input once before writing anything.
2. Extract: goals, users/roles, features, constraints (budget, deadline, tech, compliance), integrations, and anything explicitly rejected.
3. Find contradictions (e.g. "Stripe" early, "Razorpay" later). List them as open questions; never pick one silently.
4. Write the PRD in the structure below.
5. End with the open questions, ordered by how badly they block the build.

## Structure

    # <Product / feature name>
    ## 1. Problem: who hurts, and how, today
    ## 2. Goals: measurable outcomes (not features)
    ## 3. Non-goals: what we are explicitly not building
    ## 4. Users & roles: each role and what it can do
    ## 5. Requirements
       ### 5.x <Capability>
       - [Confirmed] ...
       - Acceptance criteria: testable statements (Given / When / Then or a checklist)
    ## 6. Non-functional: performance, security, privacy, compliance, availability
    ## 7. Integrations & constraints
    ## 8. Risks
    ## 9. Open questions (numbered, blocking first)
    ## 10. Decisions log: decision, reason, who, date

## Quality bar

- Every requirement has acceptance criteria that a tester could verify with yes or no.
- No vague words without numbers: "fast", "secure", "scalable", "user-friendly".
- One requirement per bullet. No compound "and also" requirements.
- Keep the author's domain vocabulary; do not rename their concepts.
- If a section has nothing, write "None identified", not filler.
`;

const taskBreakdown = `---
name: task-breakdown
description: Breaks an approved PRD into agent-executable tasks, each tied to the requirements (R-n) it delivers, with acceptance criteria, dependencies and role assignment (developer, DevOps, QA). Use when asked to split, decompose or plan work from a PRD, create tickets or tasks, or assign work to people or agents.
---

# Task Breakdown

Turn a PRD into tasks that an AI coding agent can complete in one focused session without asking for basic context. The quality of the breakdown decides whether agents succeed.

## Inputs

- The PRD. Only **[Confirmed]** requirements become tasks. Assumptions and open questions become a single "Clarify" task per blocker, assigned to the product owner.
- The people/agents and their roles, if given (e.g. "Priya: developer, Arjun: DevOps, Meena: QA").

## Rules

1. **Size:** one task = one pull request = roughly half a day to a day of human work. If you can't describe "done" in five or fewer acceptance criteria, split it.
2. **Vertical slices first:** prefer "User can request a quote (API + UI + test)" over "Build all APIs". Split into layers only when different roles own them.
3. **Explicit dependencies:** a task lists the IDs it is blocked by. No hidden ordering. The first tasks must have no dependencies.
4. **Parallel safety:** two tasks that can run at the same time must not edit the same files or modules. If they would, make one depend on the other.
5. **Self-contained context:** each task restates the relevant requirement(s) and any decision it depends on. Never write "see PRD" alone.
6. **Role:** every task has exactly one role: developer, devops, qa or product. Assign named people only when names were given, and spread work so nobody is idle while others are blocked.
7. **Testable:** acceptance criteria are yes/no checks. Include the evidence expected (tests passing, screenshot, migration applied, etc.).

## Output format

    ## R-1: <the requirement's text from the PRD's Acceptance Criteria>

    ### T1: <imperative title>
    - Role: developer (Priya)
    - Depends on: none
    - Requirements: R-1[, R-3] (keys from the PRD) + the restated requirement text
    - Context: <decisions, constraints, relevant existing code/modules>
    - Acceptance criteria:
      - [ ] ...
    - Evidence: <what proves done>
    - Out of scope: <what this task must not touch>

End with a dependency summary (which tasks can start now, which are blocked, and by what) and a list of risks you noticed while splitting.
`;

const codeReview = `---
name: code-review
description: Reviews a code change as a senior engineer before human review, checking correctness against the task's acceptance criteria, security, tests and unnecessary complexity. Use after implementing a task and before submitting it, or when asked to review code, a diff or a pull request.
---

# Code Review

Review the change against the task it claims to complete. Your output is evidence for the human approver, so be specific and honest. Never approve to be polite.

## Before reviewing

1. Re-read the task: its acceptance criteria and out-of-scope list.
2. Look at the full diff, not just the files you remember editing.
3. Run the project's tests, typecheck and linter. Record the exact commands and results.

## Check, in this order

1. **Correctness:** does each acceptance criterion actually hold? Trace the real code path for each one. Look for off-by-one errors, null/empty inputs, error paths and concurrency.
2. **Security:** input validation at trust boundaries, authorization on every data access (can user A reach user B's data?), secrets in code or logs, injection, unsafe deserialization.
3. **Data safety:** migrations reversible or safe on existing data; no silent data loss; transactions where multiple writes must succeed together.
4. **Tests:** does a test fail if the main logic breaks? Are the edge cases from step 1 covered?
5. **Simplicity:** code that isn't needed, duplicated helpers that already exist in the codebase, abstractions with one use, or scope creep beyond the task.
6. **Consistency:** follows the project's existing patterns, naming and any engineering-standards skill.

## Output format

    Status: PASS | NEEDS_WORK | FAIL
    Checks run: <command> → <result> (one line each)

    Findings (most severe first):
    - [CRITICAL|HIGH|MEDIUM|LOW] <file:line>: <problem>. Why it matters: <impact>. Fix: <concrete change>.

    Acceptance criteria:
    - [x] / [ ] <criterion>: <evidence>

    Blocking: YES | NO

Rules: PASS only when there are no CRITICAL/HIGH findings and every acceptance criterion is met with evidence. Style preferences are LOW and never blocking. If you could not run the checks, say so; never claim they passed.
`;

const qaReview = `---
name: qa-review
description: Verifies a completed task as a QA engineer, testing each acceptance criterion, edge cases, error handling and regressions, and reports reproducible evidence. Use before a task is submitted for approval, or when asked to test, verify or QA a feature.
---

# QA Review

Prove the feature works for real users, not just that the code looks right. Every claim needs reproducible evidence.

## Process

1. List the task's acceptance criteria. Each becomes at least one test case.
2. For each criterion, test the **happy path** and then these edge cases where relevant:
   - empty, missing, maximum-length and malformed input
   - unauthorized and wrong-tenant access
   - duplicate submissions, refresh or retry mid-action
   - slow or failing dependencies (network, third-party API)
   - boundary values (0, 1, limit, limit + 1)
3. Check error handling: failures show a clear message and never lose user data or leave half-written state.
4. Check regressions: run the full existing test suite, and manually re-check the one or two neighboring features most likely to break.
5. Where an automated test is missing for a criterion, add one if the task allows it, or report it as a finding.

## Output format

    Status: PASS | NEEDS_WORK | FAIL

    Test cases:
    - [PASS|FAIL] <case>: steps → expected → actual

    Findings (most severe first):
    - [CRITICAL|HIGH|MEDIUM|LOW] <problem>. Repro: <exact steps>. Expected / actual.

    Regression suite: <command> → <result>
    Blocking: YES | NO

PASS requires every acceptance criterion verified with evidence and no CRITICAL/HIGH findings. Report what you could not test and why.
`;

const requirementDrift = `---
name: requirement-drift
description: Checks a submitted change against the PRD the task is built under, not just the task's own acceptance criteria, and flags any named decision (a vendor, technology, or explicit requirement) the change contradicts. Use whenever a task's epic is linked to a PRD.
---

# Requirement Drift Detection

A task's acceptance criteria can already have drifted from what the client actually approved by the time it was written. This check looks one level higher: does the submitted change contradict a specific, named decision in the PRD itself?

## What counts as drift

- The PRD names a specific vendor, technology, or approach, and the diff/summary clearly implements something else instead (e.g. PRD says Stripe, the change uses PayPal or Razorpay).
- The PRD explicitly excludes something (a Non-Goal) and the change does it anyway.

## What does not count as drift

- The PRD is simply silent on a detail the task had to decide (no PRD mention, no contradiction — that's a normal implementation choice, not drift).
- Stylistic or structural differences that don't contradict a stated decision.

Only flag a real, direct contradiction — never a guess or an absence. Absence of evidence is not evidence of drift.

This check is not responsible for verifying that tests pass or that a diff exists — that's covered by other reviews. Take the reported summary and evidence at face value for the purpose of this check alone. If nothing in it contradicts a named PRD decision, PASS, even without a diff to inspect.

## Output format

    Status: PASS | NEEDS_WORK | FAIL
    Findings (most severe first):
    - [CRITICAL] <what the PRD says> vs <what the diff does>. Why it matters: <impact on the client relationship>.

Rules: FAIL and blocking only when there is a direct, quotable contradiction with a named PRD decision. PASS when the change is consistent with (or simply not addressed by) the PRD. Never fail on missing PRD coverage alone.
`;

export const DEFAULT_SKILLS = [
  { kind: "guide", source: prdWriting },
  { kind: "guide", source: taskBreakdown },
  { kind: "review", source: codeReview },
  { kind: "review", source: qaReview },
] as const;

/**
 * Not part of DEFAULT_SKILLS: only run when a task is linked to a PRD (spec 012),
 * so a submission with no linked PRD incurs no extra review and no extra cost.
 */
export const REQUIREMENT_DRIFT_SKILL = {
  name: "requirement-drift",
  source: requirementDrift,
};

// Spec 022 marketplace seed content — published by Captap itself so the marketplace isn't empty on
// day one. Structure follows agamm/claude-code-owasp (OWASP Top 10:2025 + ASVS 5.0 checklist shape).
const securityReview = `---
name: security-review
description: Reviews a code change for security issues against OWASP Top 10:2025, checking access control, injection, secrets, exception handling and supply-chain risk. Use before merging changes that touch auth, payments, user input or third-party dependencies.
---

# Security Review

Find exploitable issues a functional code review misses. Trace data from its entry point (request
body, query param, header, webhook, file upload) to where it's used, not just the diff's surface.

## Check, in this order (OWASP Top 10:2025)

1. **Broken access control**: can user A reach user B's data or org? Is every data access scoped by
   the caller's tenant/org/project, not just checked at the route level?
2. **Injection**: parameterized queries only, no string-built SQL; no \`shell=True\`/\`exec\` with
   user input; output encoded for its context (HTML, SQL, shell, log).
3. **Secrets**: no hardcoded credentials, keys or tokens; secrets come from env or a secrets manager;
   none logged or echoed back in error messages.
4. **Authentication**: session/token validated on every request, not just at login; no auth logic
   duplicated and drifted between routes.
5. **Cryptography**: no home-rolled crypto; passwords hashed with a modern KDF, not encrypted or
   plain; secure random for tokens, never \`Math.random\`.
6. **Mishandling of exceptional conditions**: errors fail closed, not open; a caught exception never
   silently grants access or skips a check it was guarding.
7. **Software supply chain**: new dependency is maintained, not typosquatting an existing one, and
   pinned; no \`curl | sh\` style install from an unpinned remote source.
8. **SSRF / deserialization**: no outbound request built from unvalidated user input; no
   deserialization of untrusted data without a strict schema.

## Output format

    Status: PASS | NEEDS_WORK | FAIL

    Findings (most severe first):
    - [CRITICAL|HIGH|MEDIUM|LOW] <file:line>: <problem>. Exploit: <concrete attack>. Fix: <change>.

    Blocking: YES | NO

Rules: PASS only when there are no CRITICAL/HIGH findings. A theoretical issue with no realistic
attacker path is LOW, not CRITICAL — say why it's unreachable rather than omitting it.
`;

// Pattern: expand-contract / parallel-change, the standard safe-migration approach across engineering
// orgs doing zero-downtime schema changes (add nullable+backfill, dual-write, migrate, drop old last).
const dbMigrationReview = `---
name: db-migration-review
description: Reviews a database migration for zero-downtime safety — locking, backward compatibility with running code, backfill strategy and rollback. Use before a schema migration runs against a production or shared database.
---

# Database Migration Review

A migration that is correct in isolation can still take the app down if it isn't compatible with the
code already running while it applies. Review the migration against the code that will run during and
immediately after it, not just the final schema.

## Check, in this order

1. **Backward compatibility**: does the old (currently deployed) code still work against the new
   schema while the deploy rolls out? A column rename or type change the old code doesn't expect
   breaks live traffic — use expand-contract instead: add the new column nullable, backfill, switch
   reads/writes in a separate deploy, drop the old column in a third deploy.
2. **Locking**: does this statement take a long-held lock on a large table (adding a NOT NULL column
   with a default, adding an index without CONCURRENTLY, rewriting a column type)? Prefer:
   nullable column + backfill, \`CREATE INDEX CONCURRENTLY\`, and a new column + dual-write over an
   in-place type change.
3. **Backfill**: is it batched/incremental and idempotent (safe to re-run after a partial failure),
   not a single statement over the whole table?
4. **Destructive changes**: dropping a column or table only after confirming nothing still reads it
   (old code fully rolled out) — never in the same deploy that stops using it.
5. **Rollback**: can this migration be reversed, or is there an explicit reason it can't (e.g. a drop)
   and a plan if the deploy needs to roll back anyway?
6. **Data integrity**: new constraints (NOT NULL, foreign key, unique) validated against existing
   data before being enforced, not applied blind.

## Output format

    Status: PASS | NEEDS_WORK | FAIL

    Findings (most severe first):
    - [CRITICAL|HIGH|MEDIUM|LOW] <statement>: <risk>. Why it matters: <what breaks, for whom>.
      Fix: <safer sequencing, e.g. "split into migration A (expand) now, migration B (contract) after
      the next deploy">.

    Blocking: YES | NO

Rules: CRITICAL/blocking for anything that can lock a production table for more than a few seconds or
break currently-deployed code. A migration with no production traffic yet (new table, new project) is
exempt from the locking/backward-compatibility checks — say so rather than flagging it.
`;

export const MARKETPLACE_SEED_SKILLS = [
  {
    kind: "review" as const,
    source: securityReview,
    title: "Security Review (OWASP Top 10:2025)",
    pitch:
      "Catches access-control, injection, secrets and supply-chain issues before merge, following the same checklist shape as the OWASP-aligned community skill agamm/claude-code-owasp.",
    githubRepo: "https://github.com/agamm/claude-code-owasp",
  },
  {
    kind: "review" as const,
    source: dbMigrationReview,
    title: "Database Migration Review (zero-downtime)",
    pitch:
      "Reviews a migration for locking and backward-compatibility risk using the expand-contract pattern — the standard approach for shipping schema changes with no downtime.",
  },
];
