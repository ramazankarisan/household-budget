# CLAUDE.md

pnpm monorepo: `packages/core` (pure domain logic), `apps/api` (NestJS, Prisma, SQLite),
`apps/web` (React). Each has its own CLAUDE.md with its rules, loaded when you work there.
Boundaries and data flow: [docs/architecture.md](docs/architecture.md). Setup: [README](README.md).

## WHY

A **local** household budget app: import bank CSVs, categorize them by user rules, report each
month against a budget. It is one person's bank history, on their machine, in SQLite — nothing
is uploaded anywhere. That is why there is no auth, why the API answers loopback only, and why
SQLite is the endpoint, not a stand-in for Postgres. Import → categorize → report is the whole
product; weigh new work against it.

## Done

**After every change, run `pnpm check` before saying you are done.** For HTTP or UI changes,
also `pnpm check:all`. Traps:

- The apps read core's built `dist/`. Root scripts build it first; bogus "has no exported
  member" errors mean a stale build — `pnpm core:build`.
- There is no root Vitest config: run Vitest inside a package.
- `pnpm typecheck` is the strictness gate; lint is deliberately not type-aware.
- Never skip a hook (`--no-verify`, `LEFTHOOK=0`): that bypass is the user's, for an emergency.
  If a gate looks wrong, say so. Commits need `gitleaks` installed (`brew install gitleaks`).

## RULES

- **`packages/core` must never import NestJS, React, or Prisma.** It is where budget logic is
  tested without a server, browser or database. A framework import anywhere in
  `packages/core/src` is a bug, including a type-only one. `pnpm lint:deps` enforces it.
- **Never commit real bank data.** Test data is synthetic and lives in `fixtures/`, byte-exact
  as each bank ships it. When a bug needs a real statement, hand-write a synthetic fixture.
- **Read a feature's plan in `docs/plans/` before changing it.** The code is the truth about
  _what_, the plan about _why_. Never rewrite a plan; record departures in it.
- **Research goes in `docs/research/`, plans in `docs/plans/`**, as `NN-topic.md`, next number
  up — this overrides the rpi-\* skills' `docs/agents/…` paths. Reviews and test sessions go in
  `docs/reports/`, dated. Check there before researching something twice.
- **Link, do not inline.** Keep this file under 50 lines. Detail goes under `docs/` or into
  the CLAUDE.md of the package it concerns.
