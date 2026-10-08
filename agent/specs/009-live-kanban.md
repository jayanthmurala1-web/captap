# Spec 009 — Real-Time Kanban Board (Live Multi-Agent Task Stream)

## Problem
In a multi-agent development workflow, multiple agents (Cursor, VS Code Cline, Windsurf, Claude Code) and human developers concurrently claim, work on, and submit tasks.
Currently, the Kanban board on `/projects/[id]` is rendered as a static server component. When an agent in an IDE calls `claim_next_task` or `submit_task` via MCP:
1. The web board does not reflect the change unless the user manually refreshes the page (`F5`).
2. Project managers, founders, or developers watching the board have no immediate visual feedback that an agent picked up or finished a task.
3. This adds unnecessary friction and degrades the "AI agency operating system" feel.

## Goal
Deliver a live, self-updating **Real-Time Kanban Board**:
1. **Live Task Transitions**: When any task is claimed, released, submitted, approved, or rejected, the corresponding card automatically moves to the appropriate column (`To do`, `In progress`, `In review`, `Done`) without a manual page refresh.
2. **Agent Activity Badges**: Shows active claiming agent names (`🤖 cursor-agent`) with visual indicators as they happen.
3. **Connection State & Battery-Friendly**:
   - Displays a sleek status badge: `● Live Sync` (emerald pulse) or `○ Reconnecting...` (amber).
   - Pauses polling / stream consumption when the browser tab is hidden (`visibilitychange`), resuming immediately upon re-focus.
4. **Serverless-Safe**:
   - Works flawlessly on Vercel serverless functions without hanging indefinitely or breaching duration timeouts.
   - Stream cycles gracefully to let standard browser `EventSource` auto-reconnect seamlessly, with REST fallback.

## Acceptance Criteria
1. Initial page load continues to render server-side (zero layout shift, instant SSR).
2. Live updates trigger when an agent claims, updates, or submits a task via MCP or UI actions.
3. Endpoint `/api/projects/[id]/tasks/stream` verifies user authentication and project organization membership.
4. Unauthorized users are rejected with `401 / 403`.
5. Code passes all lint, typecheck, unit tests, and production build.

## Out of Scope
- Drag-and-drop manual task reordering across columns (human approvals/rejections continue through strict review gates).
- Webhook subscriptions for external third-party services (Jira/Linear).
