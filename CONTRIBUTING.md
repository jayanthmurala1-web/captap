# Contributing to Captap

Captap is early software built by one person, and contributions are welcome. Small, focused pull
requests get reviewed fastest.

## Before you start

- **Open an issue first for anything bigger than a bug fix.** Captap deliberately stays small
  (see [`agent/MASTER_ROADMAP.md`](agent/MASTER_ROADMAP.md), "Explicitly not doing"), so a feature
  that doesn't fit will be declined, and it's kinder to say so before you write it.
- Read [`agent/DECISIONS.md`](agent/DECISIONS.md) for why things are the way they are, and the
  feature specs in [`agent/specs/`](agent/specs).

## How we work

- **Spec first.** A feature starts as a one-page spec in `agent/specs/`: the problem, who it's for, how
  we'll know it works, acceptance criteria, and what's out of scope.
- **Tests first.** Write the failing test from the acceptance criteria before the code. Anything that
  calls a language model gets an eval set (inputs and graded expected outputs) before its prompt.
- **Smallest change that passes.** No speculative features, no settings for values that never change, no
  scaffolding "for later", no abstraction before the third use.
- **Validate at the edges** (user input, webhooks, external APIs) and trust internal code. Fail loudly in
  development, degrade gracefully for users, never swallow an error silently.

## Set up

Follow [Self-hosting](README.md#self-hosting) in the README (or just `docker compose up` to try it). The test suite is DB-backed and creates and
deletes `test-*` rows in whatever `DATABASE_URL` points to, so **use a throwaway database (a free
Neon branch works), never one with real data.**

## Before you open a pull request

```bash
GROQ_API_KEY= pnpm test     # empty key skips the live-LLM tests
pnpm typecheck
pnpm lint
```

- Add or update a test that fails if your change breaks. Money, auth and permission paths always
  need one.
- Keep one concern per commit, with a conventional message (`feat:`, `fix:`, `chore:`).
- TypeScript is strict. No `any` without a comment saying why.
- A new dependency needs an entry in `agent/DECISIONS.md` (why, alternatives, size, maintenance).
- Don't commit secrets. `.env` is gitignored; document new variables in `.env.example`.

## Licensing

Captap is [AGPL-3.0](LICENSE). By contributing you agree your contribution is licensed under the
same terms.

## Reporting security problems

Please don't open a public issue. See [SECURITY.md](SECURITY.md).
