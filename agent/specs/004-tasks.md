# 004 — Tasks (claim → evidence → human approval)

**Problem:** Agents need precise, assignable work, and parallel agents must never collide. "Done" must mean something.
**Who pays / why it matters:** Flow B in IDEA.md. It turns the PRD into shipped work and is the daily-use loop that makes teams pay.
**Success metric:** Two agents (dev-1, dev-2) under one user each call `claim_next_task` repeatedly. They never get the same task, never start a blocked task, and every finished task arrives In Review with evidence.

## Model
- `task`: per-project number (`T-12`, from an atomic `project.task_seq` counter), title, markdown description, role (developer/devops/qa/product), optional human assignee, status `todo → in_progress → in_review → done`.
- `task_dependency`: a task is **blocked** while any dependency isn't `done`. Dependencies can only point at existing tasks or earlier items in the same batch, so cycles are impossible by construction.
- **Claim:** one atomic SQL statement (`FOR UPDATE SKIP LOCKED` for claim-next). It records user + `agent` name + time. Only `todo`, unblocked tasks can be claimed.
- **Submit:** only the claiming user + agent can submit. Required evidence: summary, files changed, ≥1 test run (command, exit code, output summary). Optional: branch, commit, review-skill results. Status → `in_review`.
- **Approve / reject:** web only (a human; ADR-004). Approve → `done`. Reject → back to `in_progress` for the same agent, with a note it reads via `get_task`.
- **Release:** the claimer (or any member in the web) returns a stuck task to `todo`.
- Evidence is labeled **agent-reported** in the UI. GitHub verification comes later.

## Acceptance criteria
- [x] Concurrent `claim_next_task` calls never return the same task; blocked tasks are never claimable.
- [x] Submit is rejected unless in_progress, claimed by the same user + agent, and evidence is complete.
- [x] Reject returns the task to its claimer with the note; approve → done, which unblocks dependents.
- [x] Tenant isolation on every operation.
- [x] MCP: `list_members`, `create_tasks` (batch, local refs for dependencies), `list_tasks`, `get_task` (task + dependencies + submissions + project documents), `claim_next_task`, `claim_task`, `submit_task`, `release_task`.
- [x] Web: project board (4 columns, blocked badge), task page (description, dependencies, evidence with "agent-reported" label, missing-review warning, approve/reject/release), simple new-task form.
- [x] Tests for all of the above, including a real concurrency race.

## Out of scope
GitHub verification, custom workflows, priorities/estimates, sprints, comments, notifications, editing dependencies after creation.
