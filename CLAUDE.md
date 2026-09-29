# CLAUDE.md

## WHAT

pnpm 12 monorepo, Node >=24, strict TypeScript `~6.0.3` everywhere.

```
packages/core   Domain logic: CSV parsing, categorization rules, budget math.
                Pure TypeScript. Compiles to dist/ (ESM + .d.ts).
                Two entry points — the root is browser-safe; `/csv` holds the parser.
apps/api        NestJS 12 REST API. SQLite via Prisma 7 (no Rust query engine at runtime).
                Global route prefix `api`; 127.0.0.1:3000 only; rejects non-loopback
                Host/Origin (`src/security/loopback.ts`).
apps/web        React 19 + Vite 8 + MUI 9 + react-router. Dev server on :5173,
                proxies /api to :3000.
fixtures/       Synthetic bank CSVs, byte-exact as each bank ships them: Sparkasse CRLF
                (Windows-1252 for the primary one), Deutsche Bank LF + UTF-8.
                .gitattributes and .editorconfig keep them that way.
```

Both apps import core's **built** `dist/`, never its source. Types declared once in core
(`AccountPayload`, `TransactionPayload`, `ImportSummary`, `BudgetPayload`) are the contract
between API responses and the UI.

Import → categorize → report works end to end, for Sparkasse CSV-CAMT and Deutsche Bank. The
UI is one app shell, the month in `?m=`, over one household copy of the data
(`apps/web/src/household/`).

Categorization is user-defined rules — one condition each, `priority ASC` then `createdAt`
then `id`, first match wins. `POST /api/rules/apply` re-runs them over every account and writes
`null` as well as matches, so a category never outlives the rule that explains it. A category
set by hand sets `Transaction.categoryLockedAt` and is never touched again until it is cleared.
An import categorizes the rows it inserts inside its own transaction.

Where to read more:

- [README.md](README.md) — setup, checks, pages, repo map.
- [docs/architecture.md](docs/architecture.md) — boundaries, data flow, data model, version
  pins, ESM/lint conventions.
- [docs/best-practices.md](docs/best-practices.md) — the workflow and every gate, hooks included.
- [DESIGN.md](DESIGN.md) — the UI rulebook. Read it before touching `apps/web`.
- CSV formats: [research 01](docs/research/01-csv-import.md) (Sparkasse CSV-CAMT),
  [research 07](docs/research/07-deutsche-bank-csv.md) (Deutsche Bank) — the authority on each.
- `docs/plans/` — one plan per feature: the decisions, and where the build departed from them.
  Before changing a feature, read its plan. The code is the truth about _what_, the plan about
  _why_.

### Invariants

Each is deliberate; the link is the reason. Do not undo one without reading it.

- Rule matching and list search run in JavaScript over loaded rows, never as SQL — SQLite
  folds case for ASCII only, so `LIKE '%müller%'` misses `MÜLLER GmbH`.
  [research 02 §3](docs/research/02-categorization-rules.md),
  [03 §6](docs/research/03-transactions-list.md)
- The transactions list filters in the browser (`apps/web/src/filter.ts`) — no server query,
  no endpoint; URL search params (`?m`, `?c`, `?a`) hold view state only.
  [research 03 §9](docs/research/03-transactions-list.md), [plan 08](docs/plans/08-ui-redesign.md)
- „Ohne Kategorie“ is counted by one function, `uncategorizedRows` — booked rows, in or
  out, with no category — over the chosen accounts (all of them unless one is picked) and
  the chosen month, never the search or category filter. The nav badge counts every month.
  Vorgemerkt rows are not counted, and the „Ohne Kategorie“ filter does not show them: they
  cannot be categorized until they book, so the chip opens exactly the rows it counts.
- Budgets are one limit per category per month, household-wide, measured against every
  account — Überblick has no account picker; `/budgets` redirects to it.
- `monthlyReport` (core) counts money out only, keeps booked and vorgemerkt apart, and gives
  every category a row; the uncategorized bucket is `null` and never has a limit.
  [research 04 §4](docs/research/04-monthly-budgets.md)
- UI text lives in `apps/web/src/locales/{de,en}.ts` and nowhere else; `en` is typed against
  `de`, so a missing translation fails typecheck. Amounts and numeric dates (`22.09.2025`) are
  `de-DE` in both languages; spelled-out month and weekday names are words and follow the
  language (`formatMonth`, the ledger's day headings). [plan 07](docs/plans/07-language-and-theme-switch.md)

## HOW

```bash
pnpm install                                   # runs `prisma generate` and installs git hooks
cp apps/api/.env.example apps/api/.env
pnpm --filter @household-budget/api db:push    # creates apps/api/data/budget.db
pnpm dev                                       # core watch + api :3000 + web :5173
```

| Task                  | Command                                       |
| --------------------- | --------------------------------------------- |
| **Everything, fast**  | `pnpm check`                                  |
| Everything + E2E      | `pnpm check:all`                              |
| Test (+ hook tests)   | `pnpm test` · `pnpm test:fast` bails on first |
| E2E (Playwright)      | `pnpm test:e2e`                               |
| Mutation tests (core) | `pnpm mutation`                               |
| Format                | `pnpm format`                                 |

Each step of `pnpm check` also runs alone: `lint`, `lint:deps`, `lint:unused`, `lint:dupes`,
`typecheck`, `test:coverage`. What each covers: [README § Checks](README.md#checks),
[plan 09](docs/plans/09-guardrails.md).

Single package, single file, single test:

```bash
pnpm --filter @household-budget/api test
pnpm --filter @household-budget/api exec vitest run src/import/import.service.test.ts
pnpm --filter @household-budget/core exec vitest run -t 'parses both date widths'
```

Each package owns its Vitest config — `vitest.config.ts` in core and api, the `test` block of
`vite.config.ts` in web; there is no root Vitest config, so Vitest must run inside a package.

Every root script that needs core builds it first — the apps consume its `.d.ts`. A stale
`packages/core/dist` shows up as bogus "has no exported member" errors in both apps.

### Verifying a change

**After every change, run `pnpm check` before saying you are done.** The Stop hook runs it
anyway when you edited something, and keeps you working if it fails.

`pnpm check` is format → lint → deps → unused → dupes → typecheck → unit tests with coverage
thresholds, one line per step, full output only for the step that fails. For anything touching
HTTP or UI, also run `pnpm check:all` (or `pnpm dev` and exercise it at http://localhost:5173).

- `pnpm typecheck` is the real strictness gate — lint is deliberately not type-aware, except
  for a floating-promise overlay scoped to `src/` and the Playwright specs.
- `pnpm lint:deps` enforces the boundaries in
  [architecture.md](docs/architecture.md#boundaries-and-why-they-exist). Type-only imports
  into web are allowed — erased before the browser sees them.

### Hooks

- **Claude Code hooks** (`.claude/hooks/`) refuse edits to fixtures, the generated Prisma
  client, `.env` files and databases; reads of the user's database; and shell commands that
  skip git hooks. The refusal says what to do instead — do that.
- **Git hooks** (lefthook): pre-commit data guard → gitleaks → Prettier → ESLint on staged
  files; commitlint; pre-push the rest of `pnpm check`. gitleaks is a Go binary —
  `brew install gitleaks`; the hook fails rather than skips without it.
- **Never skip a hook.** `LEFTHOOK=0` and `--no-verify` are for the user in an emergency, not
  for the agent. If a gate looks wrong, say so and hand it back.

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
  `scripts/check-staged-data.mjs` blocks the rest at commit time and in CI. When a bug needs a
  real statement to reproduce, hand-write a synthetic fixture that reproduces it.
- **Research goes in `docs/research/`, plans go in `docs/plans/`**, one Markdown file per
  topic, committed. Check there before researching something twice. Reviews and test
  sessions go in `docs/reports/`, dated. Raw session output (`dogfood-output/`) stays local.
  This overrides the vendored rpi-\* skills' `docs/agents/{research,plans}/YYYY-MM-DD-*.md`:
  their output goes to `docs/research/` and `docs/plans/` as `NN-topic.md`, next number up.
- **Link, do not inline.** When a topic needs more than a few lines here, write it under
  `docs/` and link it from this file. Keep CLAUDE.md short enough to stay read.
