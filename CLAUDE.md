# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## WHAT

pnpm 12 monorepo, Node >=24, strict TypeScript `~6.0.3` everywhere.

```
packages/core   Domain logic: CSV parsing, categorization rules, budget math.
                Pure TypeScript, no framework deps. Compiles to dist/ (ESM + .d.ts).
apps/api        NestJS 12 REST API. SQLite via Prisma 7 (driver adapter, no Rust engine).
                Global route prefix `api`; listens on :3000.
apps/web        React 19 + Vite 8 + MUI 9. Dev server on :5173, proxies /api to :3000.
```

Both apps depend on `@household-budget/core` as `workspace:*` and import its **built**
`dist/`, never its source. Types declared once in core (for example `HelloPayload`) are the
contract between API responses and the UI that renders them.

Status: skeleton. `GET /api/hello` is a wiring proof, not a feature. No budget features yet.

Details: [README.md](README.md) — setup, deliberate version pins, ESM/lint conventions.

## HOW

```bash
pnpm install                                   # also runs `prisma generate` in apps/api
cp apps/api/.env.example apps/api/.env
pnpm --filter @household-budget/api db:push    # creates apps/api/data/budget.db
pnpm dev                                       # core watch + api :3000 + web :5173
```

| Task      | Command          |
| --------- | ---------------- |
| Build     | `pnpm build`     |
| Test      | `pnpm test`      |
| Typecheck | `pnpm typecheck` |
| Lint      | `pnpm lint`      |
| Format    | `pnpm format`    |

Single package, single file, single test:

```bash
pnpm --filter @household-budget/api test
pnpm --filter @household-budget/api exec vitest run src/hello/hello.controller.test.ts
pnpm --filter @household-budget/core exec vitest run -t 'uses the supplied clock'
```

Each package owns its `vitest.config.ts`; there is no root Vitest config, so Vitest must run
inside a package.

`dev`, `test`, and `typecheck` build `packages/core` first. This is not optional — the apps
consume its `.d.ts`. A stale `packages/core/dist` shows up as bogus "has no exported member"
errors in both apps.

### Verifying a change

1. `pnpm typecheck` — the real strictness gate. Lint is deliberately not type-aware.
2. `pnpm test` — unit tests next to the code, `*.test.ts(x)` under each `src/`.
3. `pnpm lint && pnpm format:check`.
4. Anything touching HTTP or UI: `pnpm dev`, then exercise it at http://localhost:5173.

All four pass before a change is done.

## WHY

A **local** household budget app. It imports bank CSV exports, applies user-defined rules to
categorize transactions, and shows monthly budgets — spend per category against a limit.

Local means local: the data is one person's bank history, it stays on their machine in SQLite,
and nothing is uploaded anywhere. That constraint is why the stack is a single-origin Vite
proxy with no API base URL, why there is no auth or multi-tenancy, and why SQLite is a
deliberate endpoint rather than a placeholder for Postgres.

Import → categorize → report is the whole product. Weigh new work against it.

## RULES

- **`packages/core` must never import NestJS, React, or Prisma.** It is the one place budget
  logic can be tested without booting a server, a browser, or a database, and it is the reason
  both apps agree on a shape. A framework import anywhere in `packages/core/src` is a bug,
  including a type-only one.
- **Never commit real bank data.** Test data is synthetic and lives in `fixtures/`. `data/` and
  `*.db` are git-ignored; a downloaded CSV export is not, so keep it outside the repo. When a
  bug needs a real statement to reproduce, hand-write a synthetic fixture that reproduces it.
- **Research goes in `docs/research/`, plans go in `docs/plans/`**, one Markdown file per
  topic, committed. Check there before researching something twice.
- **Link, do not inline.** When a topic needs more than a few lines here, write it under
  `docs/` and link it from this file. Keep CLAUDE.md short enough to stay read.
