# 002 — Skills

**Problem:** Every AI session re-learns "how this company works". A company's process lives in senior people's heads.
**Who pays / why it matters:** Skills are the product's core differentiator (IDEA.md). Written once, every AI tool follows them over MCP.
**Success metric:** An agent connected over MCP can discover and load a project's effective skills with no human pasting.

## Model
- A skill is one Agent Skills `SKILL.md` file (YAML frontmatter + Markdown). It is stored verbatim as `source`; `name` and `description` are parsed from it.
- **Scope:** org-level (`project_id` null) or project-level. A project skill with the same `name` **overrides** the org skill for that project.
- **Kind:** `guide` (how to do the work) or `review` (persona: how to evaluate the work). Our column, not part of the file.
- **Defaults:** a new org is seeded with 4 editable skills: `prd-writing`, `task-breakdown`, `code-review` (review) and `qa-review` (review).

## Acceptance criteria
- [x] Parser validates the spec: `name` 1–64 chars, `[a-z0-9-]`, no leading/trailing/double hyphen; `description` 1–1024 chars; file ≤ 100 KB.
- [x] Unique `(org, project, name)`. Org scope counts as one scope (nulls not distinct).
- [x] Org skills: any member reads; only owner/admin create/edit/delete.
- [x] Project skills: any org member creates/edits/deletes.
- [x] Effective set for a project = org skills overlaid with project skills by name.
- [x] Web: `/skills` (org list + create by paste or file upload + edit + delete); `/projects/[id]` (effective skills with scope badge, add project skill).
- [x] MCP: `list_organizations`, `list_skills(org_id | project_id)` returns name, description, kind and scope; `get_skill(org_id | project_id, name)` returns the full `SKILL.md`. Server instructions tell agents to load skills before working.
- [x] Tests: parser rules; override resolution; cross-org read/write denied; member cannot edit org skill.

## Out of scope
Skill versioning and history, multi-file skills (`scripts/`, `references/`), approval workflow, a skill marketplace.

## Research
agentskills.io/specification: frontmatter rules and progressive disclosure (metadata at ~100 tokens, body under 5k tokens). This maps 1:1 to `list_skills` → `get_skill`.
