# Spec 010 — Git Branch & Worktree Isolation for Parallel Agents

## Problem
When multiple AI agents (Cursor, VS Code Cline, Claude Code, Windsurf) or human developers work concurrently on the same codebase:
1. Working on the same root folder on `main` causes file collisions, uncommitted dirty tree conflicts, and git index lock errors.
2. Parallel agents overwrite each other's changes before submitting evidence.
3. Without standardized conventions, agents name branches inconsistently (e.g. `feat`, `fix`, `temp-branch`), making verification and PR review harder.

## Goal
Provide automatic, structured **Git Branch & Worktree Isolation**:
1. **Automated Branch & Worktree Synthesis**: Every task generates a deterministic, URL/git-safe branch name:
   `task/{task_key}-{sanitized_title}` (e.g. `task/t-1-setup-core-database-schema`)
2. **Dedicated Worktree Directory**:
   Suggests `.worktrees/{task_key}` so parallel agents can run isolated working directories off the same `.git` repository without cloning twice.
3. **MCP Tool Integration**:
   Every `claim_task`, `claim_next_task`, and `get_task` response includes `gitIsolation`:
   - `suggestedBranch`
   - `worktreeDir`
   - `worktreeCommand`
   - `checkoutCommand`
   - `cleanupCommand`
   - `instructions`
4. **Developer UI**:
   The Task Detail page provides an interactive card with 1-click copy for both Worktree (parallel) and Branch (solo) setup commands.

## Acceptance Criteria
1. `generateGitIsolation` converts task keys and arbitrary titles (with punctuation, emojis, spaces) into valid, clean git branch slugs.
2. `getTask` response includes `gitIsolation` object.
3. MCP tools `claim_next_task`, `claim_task`, and `get_task` return `gitIsolation` to client agents.
4. UI component displays copyable commands on the task page.
5. All unit tests, typecheck, lint, and production build succeed.
