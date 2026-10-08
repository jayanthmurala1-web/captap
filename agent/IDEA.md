# Founder Idea — structured from raw brain-dump (v1, 2026-09-15)

Replaces the ChatGPT PRD as the source of truth. The PRD is reference only.

## One line
A project-management app where **the company's own way of working (Skills)** is stored once and applied automatically by any AI tool (Claude Code, Cursor, Codex, Antigravity) through MCP, from client meeting to PRD, then tasks, code, review and done.

## Actors
- **Business side:** founder / BA / PM, working with the solution architect, DB architect and DevOps lead.
- **Execution side:** developers, QA, DevOps. Each works in their own AI tool.
- **Company admin:** owns the org-level Skills.

## Building blocks
1. **Company Skills (org level):** `.md`/`.txt` files that encode how *this* company works: a PRD skill, a PRD→epics skill, an epics→tasks skill, coding standards, and so on. We ship defaults; companies edit or upload their own.
2. **Project Skills:** per-project additions and overrides on top of the company Skills.
3. **Personas:** review Skills (code reviewer, QA, security…). Defined at company level and overridable per project. They run *before* a human reviews.
4. **Docs space:** per project, Confluence-like. The PRD lives here as a maintained document.
5. **Tasks:** board/cards like any PM tool. Structure follows the company Skill (flat tasks, or epic → story → task).
6. **MCP server:** the bridge between the user's AI tool and our app.
7. **In-app AI:** does the same actions as MCP, from inside the web UI.

## Flow A — Client meeting to assigned tasks (business side)
1. The meeting happens (Meet/Teams bot recorder, phone recorder, or someone's memory).
2. The BA brainstorms with their own AI tool, pasting the transcript and refining it.
3. When satisfied: "Upload this as the PRD." Over MCP, the app returns the company's **PRD Skill**, the PRD gets reshaped into the company format, a **new project** is created, and the PRD is stored in the project's docs.
4. "Break this PRD into tasks for Priya (dev), Arjun (DevOps), Meena (QA)." The **breakdown Skill** is applied, tasks are created with scripts/details, and each is assigned by role.

## Flow B — Task to done (execution side)
1. The developer clones the repo, connects our MCP in their AI tool, and logs in.
2. The agent pulls *my assigned tasks* along with their context and Skills.
3. The agent implements.
4. **Persona review** runs (code review, QA…) and the agent fixes what it finds.
5. The human reviews. If OK: "mark done" → status updates over MCP.
6. QA and DevOps follow the same pattern with their own tasks.

## Customers
- **Usable by everyone; revenue from teams.** Solo devs get a free or cheap tier (adoption, word of mouth). Agencies and startups pay (seats, projects, in-app AI).
- **Solo use case:** one person running N agents in parallel terminals (Dev 1, Dev 2…), each pulling its own task. Same product, "team" of agents.
- **Project memory:** the PRD, tasks, decisions and work logs live in our cloud. Delete the laptop copy, come back in a year, re-link the repo, and the agent resumes with full context.

## Requirements this adds
- **Atomic task claiming:** two agents can never pull the same task.
- **Task dependencies:** an agent shouldn't start "frontend" before the "API" task is done.
- **One git worktree/branch per agent:** parallel agents on the same folder overwrite each other's files. The task context tells each agent to use its own worktree.

## Decisions (see DECISIONS.md)
- ADR-005: Standalone task system, minimal board. No Jira/Linear sync in V1.
- ADR-002: MCP work runs on the user's own AI tool (zero cost to us). In-app AI runs on our LLM with usage limits.
- ADR-003: Personas run inside the developer's agent. No GitHub integration in V1.
- ADR-004: Evidence-based completion. The agent submits a proof package via MCP, the task goes to In Review, and a human approves it to Done.
- Open: standalone board vs sync with Jira/Linear (founder to confirm; recommendation: standalone, minimal).
