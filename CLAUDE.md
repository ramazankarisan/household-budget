# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## WHAT

pnpm 12 monorepo, Node >=24, strict TypeScript `~6.0.3` everywhere.

```
packages/core   Domain logic: CSV parsing, categorization rules, budget math.
                Pure TypeScript, no framework deps. Compiles to dist/ (ESM + .d.ts).
                Two entry points — the root is browser-safe; `/csv` holds the parser.
apps/api        NestJS 12 REST API. SQLite via Prisma 7 (driver adapter, no Rust engine).
                Global route prefix `api`; listens on :3000.
apps/web        React 19 + Vite 8 + MUI 9 + react-router. Dev server on :5173,
                proxies /api to :3000.
fixtures/       Synthetic bank CSVs, byte-exact: CRLF, and Windows-1252 for the
                primary one. .gitattributes and .editorconfig keep them that way.
```

Both apps depend on `@household-budget/core` as `workspace:*` and import its **built**
`dist/`, never its source. Types declared once in core (`AccountPayload`,
`TransactionPayload`, `ImportSummary`) are the contract between API responses and the UI
that renders them.

Status: import → categorize works end to end; reporting is not built yet.

`POST /api/imports` takes a Sparkasse CSV-CAMT upload scoped to an account, decodes it
(UTF-8, falling back to Windows-1252), parses it by column **name**, and stores the rows —
deduplicated by a content fingerprint plus an occurrence index, so an overlapping export
imports only what is new. Bad rows are reported with their line number while the rest of
the file imports; an unparseable file is a 4xx.

Categorization is user-defined rules — one condition each, `priority ASC` then `createdAt`
then `id`, first match wins — matched in `packages/core` over rows already loaded rather
than in SQL, because SQLite folds case for ASCII only and `LIKE '%müller%'` misses
`MÜLLER GmbH`. `POST /api/rules/apply` re-runs them over every account and writes `null`
as well as matches, so a category never outlives the rule that explains it. A category set
by hand sets `Transaction.categoryLockedAt` and is never touched again until it is cleared.
An import categorizes the rows it inserts inside its own transaction.

Details: [README.md](README.md) — setup, deliberate version pins, ESM/lint conventions.
[docs/research/01-csv-import.md](docs/research/01-csv-import.md) is the authority on the
CSV format and [docs/research/02-categorization-rules.md](docs/research/02-categorization-rules.md)
on matching — in particular §3, the measured reason matching is not a `WHERE` clause.
[docs/plans/01-csv-import.md](docs/plans/01-csv-import.md) and
[docs/plans/02-categorization-rules.md](docs/plans/02-categorization-rules.md) record what
was built and what was learned building it.

## HOW

```bash
pnpm install                                   # runs `prisma generate` and installs git hooks
cp apps/api/.env.example apps/api/.env
pnpm --filter @household-budget/api db:push    # creates apps/api/data/budget.db
pnpm dev                                       # core watch + api :3000 + web :5173
```

| Task                 | Command          |
| -------------------- | ---------------- |
| **Everything, fast** | `pnpm check`     |
| Everything + E2E     | `pnpm check:all` |
| Build                | `pnpm build`     |
| Test                 | `pnpm test`      |
| Test (bail on first) | `pnpm test:fast` |
| E2E (Playwright)     | `pnpm test:e2e`  |
| Typecheck            | `pnpm typecheck` |
| Lint                 | `pnpm lint`      |
| Architecture rules   | `pnpm lint:deps` |
| Format               | `pnpm format`    |

`pnpm check` runs format → lint → deps → typecheck → unit tests, printing one line per step
and nothing else unless something fails. `pnpm check:all` adds Playwright, which boots the API
and the web server, so it is slower — that is what the pre-push hook runs.

Single package, single file, single test:

```bash
pnpm --filter @household-budget/api test
pnpm --filter @household-budget/api exec vitest run src/import/import.service.test.ts
pnpm --filter @household-budget/core exec vitest run -t 'parses both date widths'
```

Each package owns its `vitest.config.ts`; there is no root Vitest config, so Vitest must run
inside a package.

`dev`, `test`, and `typecheck` build `packages/core` first. This is not optional — the apps
consume its `.d.ts`. A stale `packages/core/dist` shows up as bogus "has no exported member"
errors in both apps.

### Verifying a change

**After every change, run `pnpm check` before saying you are done.**

That is the whole rule. `pnpm check` is the fast set and covers formatting, lint, the
architecture rules, typecheck and unit tests. For anything touching HTTP or UI, also run
`pnpm check:all` (or `pnpm dev` and exercise it at http://localhost:5173).

Two things worth knowing about what `check` is checking:

- `pnpm typecheck` is the real strictness gate — lint is deliberately not type-aware, except
  for a floating-promise overlay scoped to `src/` and the Playwright specs.
- `pnpm lint:deps` is dependency-cruiser enforcing the `packages/core` rule below. It catches
  type-only imports too.

### Git hooks

lefthook, installed by `pnpm install` via the root `prepare` script.

- **pre-commit** (seconds): staged-data guard → gitleaks → prettier → eslint → typecheck →
  core unit tests. Stops at the first failure.
- **pre-push**: `pnpm check:all`, Playwright included.

gitleaks is a Go binary, not an npm package — `brew install gitleaks`. The hook fails rather
than skips when it is missing, so the gate cannot quietly pass.

Bypass only in a real emergency: `LEFTHOOK=0 git commit ...`, or skip one job with
`LEFTHOOK_EXCLUDE=gitleaks git commit ...`.

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
  including a type-only one. Enforced by `pnpm lint:deps` (`.dependency-cruiser.cjs`).
- **Never commit real bank data.** Test data is synthetic and lives in `fixtures/`. `data/`,
  `*.db` and `*.csv` are git-ignored, with `fixtures/**/*.csv` as the one exception, and
  `scripts/check-staged-data.mjs` blocks the rest at commit time. When a bug needs a real
  statement to reproduce, hand-write a synthetic fixture that reproduces it.
- **Research goes in `docs/research/`, plans go in `docs/plans/`**, one Markdown file per
  topic, committed. Check there before researching something twice.
- **Link, do not inline.** When a topic needs more than a few lines here, write it under
  `docs/` and link it from this file. Keep CLAUDE.md short enough to stay read.
