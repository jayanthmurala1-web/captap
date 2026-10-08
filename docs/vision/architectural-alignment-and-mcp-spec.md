# Project OS — A
 Execution Spec

**Document Version:** 1.0  
**Date:** 2026-09-25  
**Context:** Strategic alignment, reality check on overengineering, institutional memory, and zero-token server validation mechanics.

---

## 1. Executive Summary: What is Project OS?

### The Core One-Line Vision
> **A single brain where an organization's way of working (Skills, Personas, and Institutional Scar Tissue) is stored once and applied automatically by any AI tool (ChatGPT, Claude Code, Cursor, terminal swarms) through MCP — turning raw ideas into verified, tested software without human project management ceremonies.**

### The Founder Reality Check: Where We Diverted vs. Where We Are
- **Original Goal (`agent/IDEA.md`):** Business briefs in ➔ PRD synthesized with company rules ➔ Atomic tasks with dependencies ➔ Autonomous agents claim tasks via MCP ➔ Proof package verified ➔ Code shipped.
- **Where Overengineering Crept In:** We started rebuilding the ritualistic bureaucracy of traditional project management: 2-week agile sprints, story points capacity planning, and burndown charts.
  - *Why this is flawed:* Sprints and burndowns are human fatigue rituals created for 2-week sprint planning meetings. Autonomous AI agents don't get tired or wait for Monday planning meetings—they work continuously across directed acyclic dependency graphs (DAGs).
- **The Correct Alignment:** Freeze traditional PM bloat. Focus exclusively on the **Agent-to-Task execution pipeline** and **Institutional Memory enforcement**.

---

## 2. Institutional Memory & Personas (The "Veteran in the Room")

### The Problem
When a Principal Architect, Staff DevOps lead, or veteran founder leaves a company, their wisdom, instincts, skepticism, and past scar tissue leave with them. Traditional project management tools (Jira, Linear, Asana) are passive databases; they have no opinion, no memory, and no soul.

### The Solution in Project OS
Project OS preserves the **living persona and mental model** of the company's best minds. When a raw client transcript or vague feature request comes in, the Agent does not just dump it into a markdown template:
1. It adopts the **Cognitive Stance** (the critical, skeptical, experienced tone of the veteran lead).
2. It aggressively flags ambiguity and unnecessary architectural complexity.
3. It incorporates **accumulated scar tissue** (e.g., *"We never use raw timestamps in SSR; we use UTC ISO strings"*).

---

## 3. The Technical Reality: Chunking, Vectors & RAG

### Why Blind Vector Chunking Fails for Personas
- **Traditional Chunking RAG** slices documents into arbitrary 300-word blocks and performs cosine similarity search.
- Slicing wisdom into fragments only retrieves disjointed trivia. It **cannot teach an AI how to think, how to critique, or how to adopt a veteran's mental model**.
- A PRD, Database ERD, or Architecture Spec is a tightly coupled relational entity. Slicing it destroys structural hierarchy.

### What Actually Creates the Living Persona?
1. **System Persona Framing**: Defining the exact cognitive stance, skepticism, and decision-making criteria.
2. **Few-Shot Exemplars**: Providing 2–3 concrete before/after examples of how the veteran architect critiqued a messy client brief and reshaped it.
3. **Institutional Gotchas Flywheel (`projectLearnedRule`)**: Rules distilled from past human critiques injected directly into the agent's context.
4. **Episodic Vector Retrieval (Targeted & Coarse-Grained)**: Using vector embeddings not on chopped paragraphs, but on **entire project/post-mortem summaries** to fetch the 2 most relevant past case studies when a similar project is launched.

---

## 4. The MCP Enforcement & Token Economics Problem

### The User Dilemma
> *"We promise users: You don't need new AI subscriptions. If you have ChatGPT Plus or Claude Pro, connect our MCP to your ChatGPT and use Project OS directly. But if the client-side LLM can be told by a user to 'skip the boring sections and just save it', how does Project OS enforce company standards? And if validation happens on our server, won't WE burn our own expensive LLM tokens inspecting their work?"*

### The Solution: The "Server-as-Compiler / Linter" Paradigm (Zero Server Tokens)

Validation on the Project OS server **MUST NOT use expensive LLM tokens**. Instead, Project OS acts like a **TypeScript compiler or ESLint engine for architecture**:

```
┌────────────────────────────────────────────────────────┐
│  Client Side (User's ChatGPT / Claude / Cursor)       │
│  - User's subscription pays for all generation tokens  │
│  - Brainstorms, talks with user, drafts PRD / code     │
└───────────────────────────┬────────────────────────────┘
                            │
                            │ (Calls MCP tool: create_document)
                            ▼
┌────────────────────────────────────────────────────────┐
│  Project OS Backend (MCP Gateway)                      │
│  - ZERO LLM TOKENS BURNED                              │
│  - Fast, deterministic structural code validation (1ms)│
└───────────────────────────┬────────────────────────────┘
                            │
          ┌─────────────────┴─────────────────┐
          │ Passes                            │ Fails (Missing sections/Gotchas)
          ▼                                   ▼
┌───────────────────────┐         ┌───────────────────────────────────────┐
│ Committed to Postgres │         │ Returns Structured Tool Error to LLM: │
│ Status: Published     │         │ "Rejected: Missing Non-Goals section. │
└───────────────────────┘         │  Rule 14 violated: Soft deletes req." │
                                  └───────────────────┬───────────────────┘
                                                      │
                                                      │ LLM reads error & fixes
                                                      ▼
                                  ┌───────────────────────────────────────┐
                                  │ Client LLM re-generates missing parts │
                                  │ (USING THE USER'S OWN TOKENS!)        │
                                  └───────────────────────────────────────┘
```

### Deterministic Validation Rules (Deterministic AST/Heuristics)
When `create_document` or `update_document` is invoked with `doc_type: "prd"`:
1. **Structural AST Section Gate**:
   - `## Problem & Context` (Must be > 50 words)
   - `## Explicit Non-Goals` (Must not be empty; must list at least 2 exclusions)
   - `## User Stories` (Must follow `As a... I want to... So that...`)
   - `## Verifiable Acceptance Criteria` (Must follow Gherkin `Given... When... Then...` or measurable test assertions)
2. **Institutional Rule Linter**:
   - Checks against active `projectLearnedRule` records for the project. If a known gotcha mentions "soft deletes" or "rate limiting", the validator checks whether the PRD explicitly acknowledges it.
3. **Execution**:
   - Time: **< 5 milliseconds**.
   - Server LLM Token Cost: **$0.00 (Zero)**.
   - If rejected, the client's ChatGPT/Claude receives an explicit validation failure and is forced to correct the PRD using the user's own token subscription.

---

## 5. Dual-Mode Architecture: Web UI vs. BYO-LLM via MCP

| Dimension | Mode A: BYO-LLM (ChatGPT / Claude / Cursor via MCP) | Mode B: In-App Web UI Copilot |
| :--- | :--- | :--- |
| **Token Cost** | $0 to Project OS (User pays their own LLM provider) | Project OS pays API costs (Covered by platform tier/quota) |
| **Interface** | Native ChatGPT, Claude Code, Cursor, terminal | Built-in Project OS Web Drawer & Architecture Deck |
| **Enforcement** | Server rejects invalid tool calls via MCP tool error responses | In-App graph prompts guide and validate generation live |
| **Quality Standard**| Identical. Both must pass the exact same server validation engine. | Identical. Both must pass the exact same server validation engine. |

---

## 6. What is a DAG (Directed Acyclic Graph)?

### Layman's Explanation
In simple terms, a **DAG** is a dependency map with one-way arrows and **zero circular traps**.

Break down the three words:
1. **Directed**: Relationships only move in one direction. Task A leads to Task B (`A ──► B`).
2. **Acyclic (No Cycles)**: You can **never** get stuck in an endless loop. For example, Task A depends on Task B, which depends on Task C, which depends on Task A (`A ──► B ──► C ──► A`). A DAG mathematically forbids this circular deadlock.
3. **Graph**: A network of interconnected nodes (tasks, documents, services).

### The Real-World Construction Analogy
Think of building a house:
- You cannot pour the foundation before clearing the ground.
- You cannot frame the walls before pouring the foundation.
- You cannot put on the roof before framing the walls.
- You cannot paint the interior before the drywall is hung.

```
[ Clear Ground ] ──► [ Pour Foundation ] ──► [ Frame Walls ] ──► [ Drywall ] ──► [ Paint ]
                                                   │
                                                   └──► [ Roof Truss ] ──► [ Shingles ]
```
Drywall and Roofing can happen in parallel once the walls exist, but neither can happen before the foundation.

### Why is a DAG the "Secret Weapon" for Autonomous AI Agents?
If you give an AI agent a giant monolith prompt: *"Build me an e-commerce platform with auth, Stripe, carts, and inventory"*, the LLM will fail. It runs out of context, makes up imports, writes half-finished files, and deadlocks.

With a **DAG**:
1. **Atomic Safety**: Work is broken into small, single-purpose tasks.
2. **Deterministic Unblocking**: An agent query (`claim_next_task`) will **only** hand out a task if all its prerequisite tasks (`blockedByTaskId`) have been completed and verified.
3. **Parallel Swarms**: 4 different AI bots (Claude Code in terminal 1, Cursor in terminal 2) can work at the exact same time without ever colliding or working out of order.

---

## 7. The Canonical User Scenario: Building an E-Commerce App

Here is the exact end-to-end journey of a startup or individual using Project OS to build an e-commerce app:

### Step 1: Onboarding & The "Company DNA Marketplace"
- The user signs up and creates an organization.
- **The Marketplace**: Instead of staring at a blank screen, the user chooses an established engineering operating framework:
  - **"The Amazon Way"**: Working Backwards PR/FAQ, Bar Raiser review gates.
  - **"The Stripe Way"**: Developer-first, API schema first, typed idempotency.
  - **"The Apple Way"**: Human interface guidelines, zero-latency UX polish.
  - **"The Modern YC Way"**: Pragmatic MVP, loop engineering, single-table velocity.
- The chosen bundle loads default Skills, Personas, and Institutional Gotchas into the workspace.

### Step 2: Ideation & Brainstorming (BYO-LLM over MCP)
- The user connects their existing AI tool (ChatGPT, Claude, Cursor) to Project OS via MCP.
- The user chats normally with their LLM: *"I'm building an e-commerce app for handmade leather shoes. We need Stripe payments, guest checkout, and inventory tracking."*
- **MCP remains silent**: Early creative brainstorming does not pollute the database.

### Step 3: Formalizing the PRD
- When the user says *"This is great, let's lock this in"*, the LLM calls `get_skill(name: "prd-writing")` via MCP.
- The LLM shapes the notes into the company's official format and calls `create_document(doc_type: "prd")`.
- The Project OS server validates the structure (Section 4) with zero token cost.

### Step 4: Guided Architecture Pipeline (PRD ➔ ERD ➔ LLD ➔ Tasks)
- The agent acts as an executive mentor:
  > *"The PRD is published. Our company standard requires the Database ERD before coding begins. Shall we design the tables for Products, Carts, and Orders?"*
- Next: Generates the Database ERD and System Architecture (LLD).
- Next: Decomposes the specs into a DAG of atomic tasks with explicit prerequisite IDs.

### Step 5: Zero-Hallucination Task Assignment
- When assigning tasks, the agent queries `list_project_members`.
- **Hallucination Prevention**: If no developers or agents are provisioned, the agent **never invents fake names**.
- It reports: *"Tasks created, but no developers are assigned to this project. Please provision team members in Project OS before assignment."*

### Step 6: Swarm Fleet Execution (Claude Code / Terminal Bots)
- Because tasks are arranged in a strict DAG:
  - **Bot 1** claims Task 1 (`Drizzle schema & migrations`), writes code, runs tests, and submits proof.
  - **Bot 2** claims Task 2 (`Stripe webhook endpoint`) once Task 1 is approved.
  - **Bot 3** claims Task 3 (`Cart UI component`) once Task 1 & 2 are approved.
- A single developer running 3 terminal bots overnight can build an entire e-commerce application reliably without context drift.

---

## 8. The Security Boundary: Web UI vs. MCP

To maintain zero-trust security, the platform enforces a strict separation of privileges:

| Operation Type | Web UI Only (Human Admin) | Allowed via MCP (Connected AI) |
| :--- | :---: | :---: |
| **Invite New Members / Send Email Invites** | ✅ Yes | ❌ Blocked |
| **Manage Billing, Plans & Subscriptions** | ✅ Yes | ❌ Blocked |
| **Delete Project or Change Org Ownership** | ✅ Yes | ❌ Blocked |
| **Assign Existing Members to Tasks** | ✅ Yes | ✅ Yes |
| **Create / Update Documents (PRD, ERD, LLD)** | ✅ Yes | ✅ Yes |
| **Claim, Submit, and Update Tasks** | ✅ Yes | ✅ Yes |
| **Read Skills, Gotchas, and Architecture** | ✅ Yes | ✅ Yes |

---

## 9. Handover Action Plan for Successive LLMs / Developers

When continuing implementation on Project OS:
1. **Do NOT add more Jira ceremonies**: Do not build sprint estimation poker, complex burndown customizers, or time tracking.
2. **Implement the Server-Side PRD Linter**:
   - Add `validatePrdStructure(markdown: string, rules: LearnedRule[])` in `src/lib/documents/validator.ts`.
   - Call this validator inside `createDocument` and `updateDocument` whenever `docType === "prd"`.
   - Return clean, actionable `ValidationError` messages so connecting LLMs immediately know what to fix.
3. **Strengthen the MCP Task Lifecycle**:
   - Ensure `claim_next_task` returns tasks strictly adhering to the DAG `blockedByTaskId` constraints.
   - Enforce proof submission (`submit_task`) requiring git diff summaries and test run logs before moving tasks to `in_review`.

