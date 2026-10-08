# Spec 008 — Automated Persona Review Gate

## Problem
In ADR-003 and Spec 004, persona reviews (code review, QA review) were designed to run client-side inside the developer's agent.
However, in practice:
1. Agents can skip running the review persona entirely or write lazy, rubber-stamped summaries ("looks good to me").
2. The human approver is left reading raw diffs or trusting unverified agent claims.
3. Incumbent tools only do generic PR reviews (e.g. CodeRabbit, Greptile). They do **not** know about the project's PRD, the specific task's acceptance criteria, or company-defined review personas.

## Goal
Provide a server-side **Automated Persona Review Gate**:
1. When a task is submitted (or on-demand by the reviewer), the system runs the company's active Review Skills (`code-review`, `qa-review`, or custom review skills) against:
   - The task's original acceptance criteria.
   - The agent's submitted summary & test outputs.
   - The actual code changes / commit diff (fetched via GitHub API).
2. The LLM acts strictly as that persona and returns a structured evaluation:
   - Status: `PASS` | `NEEDS_WORK` | `FAIL`.
   - Acceptance criteria checklist: which criteria were proven and which were missed.
   - Findings: categorized by severity (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`) with specific fixes.
   - Blocking flag: indicates if the review should block approval.
3. Display the review directly on the task page so human reviewers have instant, objective verification before hitting "Approve".

## Execution Plan
1. **Persona Engine (`src/lib/persona-review.ts`)**: Evaluates submissions using Groq with structured JSON output against active org/project review skills.
2. **Auto-Trigger**: Executes asynchronously on `submitTask` when review skills exist.
3. **UI Display**: Renders criteria checks, severity findings, and adds "Run Persona Review" action button on `/tasks/[id]`.
