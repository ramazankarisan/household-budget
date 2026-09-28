# household-budget

A pnpm monorepo for a household budgeting app, for one person's own bank data on
their own machine. All three product steps — import, categorize, report — are
built: a Sparkasse CSV-CAMT or Deutsche Bank export can be uploaded, parsed, stored
and listed — the format is detected from the file's header — with duplicate detection
that survives overlapping exports; user-defined rules assign each
transaction a category — with a category set by hand always winning; and each month's
spending is shown per category against a limit, with a six-month trend.

## Layout

```
packages/core   Pure TypeScript domain logic — CSV parsing, categorization
                rules, budget math. No framework dependencies. Compiles to
                dist/ (ESM + .d.ts); both apps import the built output.
apps/api        NestJS 12 REST API. SQLite via Prisma 7.
apps/web        React 19 + Vite 8 + MUI 9 + react-router, inside one app shell
                (sidebar ≥ 1024 px, icon rail ≥ 720 px, bottom bar below).
                Look and rules: DESIGN.md.
fixtures/       Synthetic bank CSVs, byte-exact as each bank ships them: Sparkasse
                CRLF (Windows-1252 for the primary fixture), Deutsche Bank LF and
                UTF-8. Never real statements.
docs/           research/ and plans/, one Markdown file per topic; reports/ for
                reviews and test sessions (security review, dogfood session).
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

After pulling a change to `apps/api/prisma/schema.prisma`, run
`pnpm --filter @household-budget/api prisma:generate` and `db:push` again — `db:push`
adds new columns to your existing `budget.db` without touching its rows.

Then open http://localhost:5173. Create an account, then drop a Sparkasse CSV-CAMT or
Deutsche Bank CSV export anywhere on the window — or press **Importieren** in the top bar — and the transactions
appear on every page. **Importe** lists every upload, the ones that brought nothing new
included, and can remove one — with undo. `fixtures/sparkasse-camt-18.csv` and `fixtures/deutsche-bank.csv` are
synthetic exports to try it with.

Under **Regeln**, add a category and write a rule as the sentence it is —
`Wenn Empfänger enthält müller → Wohnen`; the preview counts what it would reach before
it is saved — and press _Regeln anwenden_. The first matching rule wins, so order is
priority: drag a rule, use its ↑/↓ buttons or `Alt+↑`/`Alt+↓`, and the whole order is
saved at once. Each category's colour is chosen there too. Matching runs in `packages/core` rather than in SQL
because SQLite folds case for ASCII only, so `LIKE '%müller%'` would miss
`MÜLLER GmbH`. Choosing a category by hand on a transaction locks that row: the
rules engine will not touch it again until the category is cleared.

The month every page shows lives in the URL (`?m=2025-09`): the stepper in the top
bar, or `[` and `]`, move it, and the back button undoes a move. Above the table, the
toolbar narrows what is shown by category and by a search over payee, purpose and IBAN.
The search runs in the browser over the rows
already loaded, for the same case-folding reason — typing `müller` finds
`MÜLLER GmbH`, and a grouped `DE89 3704 …` finds the IBAN as it is stored. **Umsätze** reads like a statement: grouped by day, every account at once unless one is
chosen, each row's category a pill that opens a searchable menu. The chip on the right
counts the booked transactions in the chosen month that still have no category, and clicking
it shows them.

**Überblick** (`/`) shows one month for the whole household: the booked total against
the limits, a bar per category (vorgemerkt hatched, never added in; „über“ past the
limit), what is still unsorted, and a six-month trend. „Budgets bearbeiten“ turns the
limits into fields. Its „Ohne Kategorie“ links open Umsätze narrowed to exactly those rows,
on the same month.

## Scripts

Run from the repo root:

| Script               | What it does                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`         | format, lint, architecture rules, unused code, typecheck, unit tests with coverage — one line per step                                                          |
| `pnpm check:all`     | the above plus the Playwright suite (real API and browser) — what CI runs                                                                                       |
| `pnpm dev`           | core in watch mode + api on :3000 + web on :5173, in parallel                                                                                                   |
| `pnpm build`         | builds every package in dependency order                                                                                                                        |
| `pnpm typecheck`     | `tsc --noEmit` across all three packages                                                                                                                        |
| `pnpm lint`          | ESLint over the whole workspace (one flat config at the root)                                                                                                   |
| `pnpm lint:deps`     | dependency-cruiser — core stays framework-free, apps import core's build only, api and web never import each other, no cycles, no Node/Prisma/`core/csv` in web |
| `pnpm lint:unused`   | knip — unused files, exports and dependencies                                                                                                                   |
| `pnpm test`          | Vitest in all three packages, plus the Claude Code hook tests                                                                                                   |
| `pnpm test:coverage` | the same, failing below each package's coverage thresholds                                                                                                      |
| `pnpm test:fast`     | core + api only, dot reporter, stops at the first failure                                                                                                       |
| `pnpm test:e2e`      | Playwright, booting the API and web servers against a throwaway database                                                                                        |
| `pnpm e2e:install`   | downloads the Chromium build Playwright needs (once)                                                                                                            |
| `pnpm mutation`      | Stryker mutation tests over `packages/core` (slow; CI runs it weekly)                                                                                           |
| `pnpm format`        | Prettier write                                                                                                                                                  |

Hooks (lefthook, installed by `pnpm install`) run the data guard, gitleaks, Prettier and ESLint
on staged files per commit, commitlint on the message, and `node scripts/check.mjs --push`
before a push. CI runs `pnpm check:all`, gitleaks and `pnpm audit` on every PR. Why each
guardrail exists: [plan 09](docs/plans/09-guardrails.md).

`dev`, `typecheck`, and `test` build `packages/core` first, because the apps
consume its compiled `.d.ts` rather than its source.

## How the pieces connect

- **core → apps.** The response shapes (`AccountPayload`, `TransactionPayload`,
  `ImportSummary`, `BudgetPayload`) are defined once in core; `apps/api` builds them and `apps/web`
  renders them. A break in either import path fails `pnpm typecheck`.
- **web → api.** The Vite dev server proxies `/api` to `127.0.0.1:3000`, so the
  browser only ever talks to one origin. There is no API base URL to configure. The API
  binds `127.0.0.1` only, sends no CORS headers, and answers `403` to a request whose
  `Host` or `Origin` is not loopback (`apps/api/src/security/loopback.ts`).
- **api → SQLite.** Prisma 7 is driver-adapter based (`@prisma/adapter-better-sqlite3`),
  so there is no Rust query engine at runtime. `Account`, `ImportBatch`, `Transaction`,
  `Category`, `Rule` and `Budget` live there; transactions are soft-deleted so a re-import can bring
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

## License

[MIT](LICENSE).
