# Spec 007 — GitHub Verification & CI Integration

## Problem
In Spec 004 and ADR-004, task completion requires evidence (commit SHA, branch, test exit codes, files changed).
However, this evidence is currently **agent-reported and unverified**: an agent could fabricate a commit SHA, report that tests passed when they didn't, or submit a non-existent branch. The UI explicitly labels this as *"agent-reported, not verified"*.

## Goal
Independently verify agent evidence using the GitHub API before a human reviews it.
1. Check that the submitted `commit_sha` and `branch` exist on GitHub.
2. Check that GitHub Actions CI checks on that commit have completed and passed.
3. Automatically discover and link any associated Pull Request.
4. Upgrade the badge to **`✓ Verified on GitHub`** with direct links to the commit, PR, and CI logs.

## Design
1. **Schema**:
   - `project.github_repo`: `text` (e.g. `owner/repo`), optional.
   - `task_submission.verification_status`: `"unverified" | "verified" | "failed"`.
   - `task_submission.verification_details`: `jsonb` containing commit author, CI status, PR URL, and check summary.
2. **Execution**:
   - On `submit_task`, if `github_repo` is configured, asynchronous verification is initiated.
   - The web UI also exposes a "Verify on GitHub" button so human reviewers can re-check latest CI status.
3. **Graceful Fallback**:
   - If GitHub rate limits or credentials are not supplied, the submission remains in `"unverified"` without blocking the human reviewer from proceeding.
