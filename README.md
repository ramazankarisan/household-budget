# household-budget

A pnpm monorepo for a household budgeting app, for one person's own bank data on
their own machine. Two of the three product steps — import, categorize, report —
are built: a Sparkasse CSV-CAMT export can be uploaded, parsed, stored and listed,
with duplicate detection that survives overlapping exports, and user-defined rules
assign each transaction a category — with a category set by hand always winning.

## Layout

```
packages/core   Pure TypeScript domain logic — CSV parsing, categorization
                rules, budget math. No framework dependencies. Compiles to
                dist/ (ESM + .d.ts); both apps import the built output.
apps/api        NestJS 12 REST API. SQLite via Prisma 7.
apps/web        React 19 + Vite 8 + MUI 9 + react-router. Two pages: the
                transactions of one account, and the rules that categorize them.
fixtures/       Synthetic bank CSVs. Byte-exact test data: CRLF endings and,
                for the primary fixture, Windows-1252. Never real statements.
docs/           research/ and plans/, one Markdown file per topic.
```

Both apps depend on `@household-budget/core` as `workspace:*`. core has two entry
points: the root one is browser-safe, and `@household-budget/core/csv` holds the
CSV parser, which pulls in csv-parse's Node build and is imported only by `apps/api`.

## Prerequisites

- Node 24 (`.nvmrc`)
- pnpm 12 (`corepack enable`)
- Network access to `binaries.prisma.sh` on install — `prisma generate` and
  `prisma db push` fetch their binaries from it.

## Getting started

```bash
pnpm install                      # also runs `prisma generate` for apps/api
cp apps/api/.env.example apps/api/.env
pnpm --filter @household-budget/api db:push   # creates apps/api/data/budget.db
pnpm dev
```

Then open http://localhost:5173. Create an account, drop a Sparkasse CSV export on
the import panel, and the transactions appear below it. `fixtures/sparkasse-camt-18.csv`
is a synthetic export to try it with.

Under **Regeln**, add a category and a rule — `Empfänger enthält müller → Wohnen` —
and press _Regeln anwenden_. Matching runs in `packages/core` rather than in SQL
because SQLite folds case for ASCII only, so `LIKE '%müller%'` would miss
`MÜLLER GmbH`. Choosing a category by hand on a transaction locks that row: the
rules engine will not touch it again until the category is cleared.

## Scripts

Run from the repo root:

| Script           | What it does                                                               |
| ---------------- | -------------------------------------------------------------------------- |
| `pnpm check`     | format, lint, import boundaries, typecheck, unit tests — one line per step |
| `pnpm check:all` | the above plus the Playwright smoke test                                   |
| `pnpm dev`       | core in watch mode + api on :3000 + web on :5173, in parallel              |
| `pnpm build`     | builds every package in dependency order                                   |
| `pnpm typecheck` | `tsc --noEmit` across all three packages                                   |
| `pnpm lint`      | ESLint over the whole workspace (one flat config at the root)              |
| `pnpm lint:deps` | dependency-cruiser — keeps `packages/core` framework-free                  |
| `pnpm test`      | Vitest in all three packages                                               |
| `pnpm test:fast` | core + api only, dot reporter, stops at the first failure                  |
| `pnpm test:e2e`  | Playwright, booting the API and web servers against a throwaway database   |
| `pnpm format`    | Prettier write                                                             |

`dev`, `typecheck`, and `test` build `packages/core` first, because the apps
consume its compiled `.d.ts` rather than its source.

## How the pieces connect

- **core → apps.** The response shapes (`AccountPayload`, `TransactionPayload`,
  `ImportSummary`) are defined once in core; `apps/api` builds them and `apps/web`
  renders them. A break in either import path fails `pnpm typecheck`.
- **web → api.** The Vite dev server proxies `/api` to `localhost:3000`, so the
  browser only ever talks to one origin. There is no API base URL to configure.
- **api → SQLite.** Prisma 7 is driver-adapter based (`@prisma/adapter-better-sqlite3`),
  so there is no Rust query engine at runtime. `Account`, `ImportBatch` and
  `Transaction` live there; transactions are soft-deleted so a re-import can bring
  them back.
- **bytes → core.** `apps/api` decodes the upload (UTF-8, falling back to
  Windows-1252) and hashes it; core takes a `string` and returns transactions. That
  split is not a preference: core sets `"types": []`, so it has neither
  `TextDecoder` nor `node:crypto`, and `apps/web` bundles it.

## Conventions worth knowing

- **Strict TypeScript everywhere.** `tsconfig.base.json` holds the strict flag
  set (including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`);
  each package only adds `module`/`lib`/`jsx`/output settings.
- **`packages/core` and `apps/api` are ESM** (NestJS 12 is ESM-only), so relative
  imports there need explicit `.js` extensions.
- **Lint is mostly not type-aware** on purpose — `pnpm typecheck` already runs full
  tsc, so ESLint stays fast and avoids "file is not in any project" failures. The
  one exception is a small overlay enabling `no-floating-promises` and
  `no-misused-promises`, scoped to `*/src/**` and the Playwright specs. Those two
  rules need type information and catch the one thing tsc does not: a promise
  nobody awaited. The scoping is what keeps `vite.config.ts` and `prisma.config.ts`
  out of the project service.
- **Prerequisites for the commit hooks.** `gitleaks` is a Go binary, not an npm
  package — `brew install gitleaks`. Playwright browsers are a separate download —
  `pnpm e2e:install`.
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
