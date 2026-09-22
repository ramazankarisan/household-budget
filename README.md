# household-budget

A pnpm monorepo for a household budgeting app. This is currently a **skeleton**:
the packages are wired together and one vertical slice (`GET /api/hello` rendered
by the web app) exists to prove the wiring. No budget features yet.

## Layout

```
packages/core   Pure TypeScript domain logic — CSV parsing, categorization
                rules, budget math. No framework dependencies. Compiles to
                dist/ (ESM + .d.ts); both apps import the built output.
apps/api        NestJS 12 REST API. SQLite via Prisma 7.
apps/web        React 19 + Vite 8 + MUI 9.
```

Both apps depend on `@household-budget/core` as `workspace:*`.

## Prerequisites

- Node 24 (`.nvmrc`)
- pnpm 12 (`corepack enable`)

## Getting started

```bash
pnpm install                      # also runs `prisma generate` for apps/api
cp apps/api/.env.example apps/api/.env
pnpm --filter @household-budget/api db:push   # creates apps/api/data/budget.db
pnpm dev
```

Then open http://localhost:5173. The page calls `GET /api/hello` and renders the
response, including whether the API could reach SQLite.

## Scripts

Run from the repo root:

| Script           | What it does                                                  |
| ---------------- | ------------------------------------------------------------- |
| `pnpm dev`       | core in watch mode + api on :3000 + web on :5173, in parallel |
| `pnpm build`     | builds every package in dependency order                      |
| `pnpm typecheck` | `tsc --noEmit` across all three packages                      |
| `pnpm lint`      | ESLint over the whole workspace (one flat config at the root) |
| `pnpm test`      | Vitest in all three packages                                  |
| `pnpm format`    | Prettier write                                                |

`dev`, `typecheck`, and `test` build `packages/core` first, because the apps
consume its compiled `.d.ts` rather than its source.

## How the pieces connect

- **core → apps.** `HelloPayload` is defined once in core; `apps/api` builds it
  and `apps/web` renders it. A break in either import path fails `pnpm typecheck`.
- **web → api.** The Vite dev server proxies `/api` to `localhost:3000`, so the
  browser only ever talks to one origin. There is no API base URL to configure.
- **api → SQLite.** Prisma 7 is driver-adapter based (`@prisma/adapter-better-sqlite3`),
  so there is no Rust query engine at runtime. `GET /api/hello` runs `SELECT 1`
  and reports `db: "ok"` or `db: "unavailable"`.

## Conventions worth knowing

- **Strict TypeScript everywhere.** `tsconfig.base.json` holds the strict flag
  set (including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`);
  each package only adds `module`/`lib`/`jsx`/output settings.
- **`packages/core` and `apps/api` are ESM** (NestJS 12 is ESM-only), so relative
  imports there need explicit `.js` extensions.
- **Lint is not type-aware** on purpose — `pnpm typecheck` already runs full tsc,
  so ESLint stays fast and avoids "file is not in any project" failures.
- **`@typescript-eslint/consistent-type-imports` is off in `apps/api`.** A Nest
  constructor parameter type looks type-only to that rule, but Nest reads it at
  runtime via `design:paramtypes`; rewriting those to `import type` breaks DI.

## Version pins that are deliberate

- **TypeScript `~6.0.3`, not 7.x.** `typescript-eslint@8` peers `typescript <6.1.0`
  and `@nestjs/cli@12` bundles `typescript ~6.0.2`. Revisit once both support the
  TS 7 native compiler.
- **Prisma `^7.10.0` for both `prisma` and `@prisma/client`.** The `prisma` package's
  `latest` dist-tag currently points at an `8.0.0-rc`, so installing with `latest`
  would produce a mismatched pair.
