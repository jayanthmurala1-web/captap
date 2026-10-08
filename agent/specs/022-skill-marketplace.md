# 022 — Skill Marketplace

## Problem
New orgs (small agencies/startups) start with 4 built-in agents and no process maturity. Orgs with
strong process have no way to share it; orgs without one have no way to borrow it. Founder: a public
place to publish and adopt org-level agent skills, so a weak org can "use" a strong org's skill as its
own starting point instead of writing one from scratch.

## User
Org owner/admin (publish, or adopt a skill into their org). Any signed-in user (browse/read).

## Success metric
A new org can go from "default 4 agents" to "a marketplace agent they didn't have to write" in under
a minute. Publishing is visible enough that good skills get reused across orgs (acquisition/retention
lever — not billed directly in v1).

## Scope (v1)
- `marketplaceSkill` table: a published copy of a SKILL.md, independent of the source org's live skill
  (editing the org skill later does not change what's published; publishing again updates it).
- Publish: org owner/admin publishes one of their org's skills (org-level only, not project-level) to
  the marketplace with a title, short pitch and optional GitHub repo link. One marketplace listing per
  (org, skill name) — republishing updates it.
- Browse: `/marketplace`, any signed-in user, search by name/kind, newest first. No org-switching
  needed to look.
- Adopt ("Use this agent"): org owner/admin copies a marketplace skill into their own org as an
  org-level skill (same `createSkill`/`updateSkill` path a human editing one would use — if an org
  skill with that name already exists, this overwrites it, same as any other skill edit).
- Seed content: 2 researched, non-trivial skills published by Captap itself so the marketplace isn't
  empty on day one (`security-review`, `db-migration-review` — see sources in default-skills.ts).

## Out of scope (explicitly, per founder: "later")
- Likes/stars, ranking by popularity.
- Auto-linking GitHub stars/traffic.
- Publishing project-level skills.
- Any payment/paywall on marketplace content.

## Acceptance criteria
- [ ] Org admin can publish an org-level skill; non-admin cannot (403).
- [ ] `/marketplace` lists published skills to any signed-in user, independent of their org.
- [ ] Adopting a marketplace skill creates/overwrites an org-level skill of the same name in the
      adopter's org; the marketplace listing itself is never mutated by adopting it.
- [ ] Publishing again (same org + skill name) updates the existing listing, does not duplicate it.
- [ ] Two researched seed skills are live in the marketplace after migration/seed.

## Out-of-scope reminder
Does not change existing org/project default-skill override behavior (spec 002) — that already works:
org gets 4 defaults, editable/replaceable per org, project can override per project.
