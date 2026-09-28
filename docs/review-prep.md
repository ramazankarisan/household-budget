# Review prep — household-budget

Prepared 2026-09-28 from the repo as it stands on `feat/ui-redesign` at `4db7dcb`. Every claim
below points at a file, a commit or a command. Where something could not be verified, it says
so.

> **Heads-up:** while this was being written, uncommitted changes appeared in the working tree
> that delete the Sortieren/Inbox page (`InboxPage.tsx`, `inbox.ts`, `e2e/inbox.spec.ts` staged
> as deleted) and add `src/rulePreview.ts`. This document describes the **committed** state, with
> `/inbox`. If you keep those changes, update §2, §5 (plan 08 row) and the README before the
> meeting.

---

## 1. Elevator pitch

household-budget is a **local** web app that imports Sparkasse CSV bank exports, sorts every
transaction into a category with user-written rules, and shows each month's spending against a
per-category limit. I chose it because it is a real problem with nasty edge cases (Windows-1252
bytes, German number and date formats, overlapping exports, umlauts that SQLite can't
case-fold) and a hard privacy constraint: bank data never leaves the machine. It demonstrates
agentic coding with a Research → Plan → Implement cycle for every feature (14 docs in
`docs/research/` and `docs/plans/`) held in check by mechanical backpressure: strict
TypeScript, an architecture linter, ~460 unit tests, 34 Playwright tests, and git hooks that
block commits and pushes.

---

## 2. Architecture tour

### Repo map

```
packages/core     Pure TypeScript domain logic. No framework. Built to dist/ (ESM + .d.ts).
  src/csv/          Sparkasse parser, German value parsers, fingerprint + occurrence index
  src/rules/        normalize(), rule validation, matchRule / orderRules / categorize
  src/budget/       month keys, budget validation, monthlyReport()
  src/api.ts        The payload types that are the API ↔ UI contract
apps/api          NestJS 12 REST API, SQLite via Prisma 7 (better-sqlite3 driver adapter)
  src/import/       upload controller, decode (UTF-8 → cp1252), hashing, ImportService
  src/rules/        categories + rules CRUD, rules engine apply
  src/budgets/      one limit per category per month
  src/accounts/     accounts, transaction list, hand-set category, soft delete
  src/security/     loopback guard, log sanitizer
  prisma/schema.prisma
apps/web          React 19 + Vite 8 + MUI 9 + react-router 7 + i18next
  src/household/    HouseholdProvider: one shared copy of all data
  src/shell/        app shell, month stepper (?m=), nav, shortcuts
  src/pages/        Überblick (/), Umsätze, Sortieren (/inbox), Regeln, Importe
  src/filter.ts     browser-side filtering + uncategorizedRows()
  src/locales/      de.ts / en.ts — all UI text
  e2e/              12 Playwright specs
fixtures/         7 synthetic Sparkasse CSVs, byte-exact (CRLF, cp1252)
scripts/          check.mjs, check-staged-data.mjs, gitleaks.sh, reset-e2e-db.mjs
docs/             research/ (6), plans/ (8), reports/ (security review)
.claude/skills/   commit, add-bank-format, rpi-* (symlinks to .agents/skills)
```

### Why the boundaries are where they are

- **`packages/core` holds every rule that both ends must agree on.** Rule matching runs in the
  browser (to preview "this rule would reach 14 rows") _and_ on the server (to apply it). The
  monthly report runs in the browser. Putting them in one framework-free package means one
  implementation and tests that need no server, browser or DB. Enforced by
  `.dependency-cruiser.cjs` (rule `core-stays-framework-free`, type-only imports included via
  `tsPreCompilationDeps`).
- **Core has two entry points.** The root (`src/index.ts`) is browser-safe. `@household-budget/core/csv`
  (`src/csv/index.ts`) holds the parser, because `csv-parse/sync` uses Node's `Buffer`; this was
  found when a build gate failed (plan 01, Phase 2 notes, "Gate 3 failed").
- **Bytes stay in `apps/api`, strings in core.** Core's tsconfig has `"types": []`, so it has no
  `TextDecoder` or `node:crypto`. The API decodes (`src/import/decode.ts`) and hashes
  (`src/import/hash.ts`); core parses text and builds the fingerprint _string_
  (`src/csv/fingerprint.ts`). Research 01 §1.
- **Types are declared once in core** (`src/api.ts`: `TransactionPayload`, `ImportSummary`,
  `BudgetPayload`, …). The API returns them, the web renders them; a break fails `pnpm typecheck`.
  Both apps import core's **built** `dist/`, which is why `typecheck`, `test` and `dev` build core first.
- **Single origin.** Vite proxies `/api` to `127.0.0.1:3000` (`apps/web/vite.config.ts`). No CORS,
  no API base URL. The API binds loopback only and 403s non-loopback `Host`/`Origin`.

### Data flow: CSV upload → dashboard

Have these open, in this order:

1. **`apps/web/src/pages/import/ImportDialog.tsx`** + `api/client.ts` `uploadImport()` — multipart
   `file` + `accountId` to `POST /api/imports`. (The window-wide drop target is `ui/DropOverlay.tsx`.)
2. **`apps/api/src/security/loopback.ts`** — middleware, runs before routing.
3. **`apps/api/src/import/import.controller.ts`** — multer limits (10 MB, 1 file, 6 parts), MIME allowlist.
4. **`apps/api/src/import/import.service.ts` `importCsv()`**:
   1. `sha256` of raw bytes → "you already uploaded this file" hint (`duplicateOfBatchId`).
   2. `decodeBankCsv()` — strict UTF-8, fallback Windows-1252.
   3. `parseSparkasseCsv()` (core/csv) — finds header by name, maps columns by name, returns
      transactions + per-row errors. File-level errors → 400.
   4. Booked rows → `fingerprintInput()` + `assignOccurrences()` → `dedupKeyHash()`.
   5. `classify()` — insert / skip (live duplicate) / restore (soft-deleted).
   6. `isStaleExport()` — an older export must not replace the pending set.
   7. One `prisma.$transaction`: delete old pending rows, create `ImportBatch`, insert new rows,
      restore soft-deleted ones, insert pending rows, then `RuleService.applyToRows()` on just
      those rows.
5. **`packages/core/src/rules/match.ts`** — first-match-wins over `orderRules()`.
6. **`apps/web/src/household/HouseholdProvider.tsx`** — `reload()` loads accounts, categories,
   rules and every account's transactions once; pages read from it.
7. **`apps/web/src/pages/OverviewPage.tsx`** → **`packages/core/src/budget/report.ts`
   `monthlyReport()`** — money out only, booked and pending kept apart, one row per category,
   `null` bucket for uncategorized.

---

## 3. Code walkthrough — the 5 most important files

### 3.1 `packages/core/src/csv/parse.ts` (+ `header.ts`)

**What:** Turns decoded Sparkasse CSV-CAMT text into `Transaction[]` plus `RowError[]`.

**Key decision:** Columns are found **by name, never by index** (`COLUMN` map, `mapColumns()`),
and the header is **scanned for** (`findHeaderLine()` looks for `Auftragskonto` + `Betrag` in the
first 30 lines) rather than skipped by count. Both 17- and 18-column exports exist
(research 01, "Decisions confirmed"). Bad rows are reported and the rest import; a structurally
broken file (unterminated quote) throws so it becomes a 400, because "silent corruption is the
worst failure mode for money".

**Say out loud:** "The parser's whole contract is the German column names, kept in one map. It
locates the header by content, so a second bank with a preamble is additive, and it matches by
name because Sparkasse ships two column counts. Row errors carry a line number, and I compute
line numbers myself because csv-parse miscounts a CRLF inside a quoted field."

**Might struggle to defend:** `lineNumbersFor()` — a hand-rolled walk over the source text to fix
csv-parse's line counting (plan 01 Phase 2 notes). Be ready to say _why_ (multi-line
`Verwendungszweck` with CRLF) rather than _how_. Also: `Info` values other than `Umsatz gebucht` /
`Umsatz vorgemerkt` fail the row (`STATUS_UNKNOWN`) on purpose; the full `Info` value set was
never confirmed (research 01 open question).

### 3.2 `apps/api/src/import/import.service.ts`

**What:** The import pipeline described in §2: hash, decode, parse, dedup, store, categorize.

**Key decisions:**

- **Dedup key = fingerprint + occurrence index.** Two identical coffees on the same day have the
  same fingerprint; `assignOccurrences()` numbers them 0, 1 within the file, so re-importing an
  overlapping export produces the same keys and inserts only what's new. `@@unique([accountId,
dedupKey])` in the schema backs it.
- **Pending ("vorgemerkt") rows are a snapshot, not a ledger.** They get `dedupKey = null` and are
  replaced wholesale on each import — unless the file is older than what's stored
  (`isStaleExport()`, booked dates only). Both refinements came from fix commits `07c3548` and
  `c97d72c`, after the plan.
- **Soft delete + restore.** A deleted booked row is restored in place by a re-import (the unique
  index covers deleted rows, so an insert would fail with P2002).
- **Everything in one `$transaction`**, including categorizing the new rows.

**Say out loud:** "An export is a ledger for booked rows and a snapshot for pending rows, so I
treat them differently: booked rows are deduplicated by a content fingerprint plus their position
among identical rows, pending rows are thrown away and replaced. The whole write, including
categorization, is one database transaction, so a crash can't leave pending rows deleted but not
reinserted."

**Might struggle to defend:** `classify()` and `isStaleExport()` read _before_ the
`$transaction` starts. Two simultaneous uploads of the same file could both decide "insert" and
the second would hit the unique index; I found no P2002 handling in this file, so it would
probably surface as a 500. Unverified; a single-user local app makes it unlikely. Also, plan 01
still says "on every import, delete all stored pending rows" — the staleness rule is not written
back into the plan.

### 3.3 `packages/core/src/rules/match.ts` (+ `normalize.ts`)

**What:** Decides which rule claims a transaction. `normalize()` = NFKC + collapse whitespace +
lower-case; `matchRule()`, `compareRules()` (priority, then createdAt, then id), `matchingRule()`
(first match wins).

**Key decision:** Matching runs in **JavaScript over loaded rows, not SQL**, because SQLite folds
case for ASCII only: `LIKE '%müller%'` does not match `MÜLLER GmbH`, and Prisma's SQLite
`StringFilter` has no `mode: 'insensitive'` (research 02 §3, measured). Cost measured at
50 000 rows × 20 rules: ~6 ms to match. The same `normalize()` is used by the fingerprint, so
dedup and matching agree on "the same text".

**Say out loud:** "This file is in core so the browser can preview a rule and the server can apply
it with exactly the same code. The order is a total order — priority, then creation time, then id
— so an apply is reproducible even when two rules share a priority."

**Might struggle to defend:** No regex, no amount/date conditions, one condition per rule —
deliberate scope cuts (plan 02 decision 12; regex measured as catastrophic-backtracking prone,
research 02 §10). Research 02 recommended `creditorId` as a stable match field; the plan dropped it
without stating why.

### 3.4 `apps/api/src/rules/rule.service.ts` (`applyAll`, `applyToRows`, `plan`, `write`)

**What:** Runs the rules engine over the database and writes the result.

**Key decisions:**

- **Writes `null` as well as matches.** If no rule claims an unlocked row any more, its category
  is cleared: "a category never outlives the rule that explains it". No early return when there
  are zero rules — deleting the last rule must clear.
- **`categoryLockedAt`** marks a hand-set category. Locked rows are never loaded, and the
  `updateMany` re-asserts `categoryLockedAt: null` in its `where`, so a lock set mid-apply wins
  (fix `1fbea9b`).
- **O(categories) statements**, not O(rows): one `updateMany` per target category plus one clear.
- Global across accounts, including soft-deleted rows (so a restored row comes back categorized).

**Say out loud:** "There are two sources of truth for a category — a rule or a human — and the
lock column decides which. The engine never touches a locked row, and the write statement itself
re-checks the lock, so the invariant lives in the query that could break it."

**Might struggle to defend:** This was the most bug-dense area: fix commits `d56271f` ("close eight
ways a category was lost or invented"), `1fbea9b` ("close the two ways an apply still lost a
category"), `83359c6` (partial PATCH reset priority). Know two or three of them by heart (see §5).

### 3.5 `packages/core/src/budget/report.ts` + `apps/web/src/household/HouseholdProvider.tsx`

**What:** `monthlyReport()` computes, per category, booked and pending spending against the limit.
`HouseholdProvider` is the single client-side copy of all data that every page reads.

**Key decisions:**

- **Money out only**, as positive magnitudes (the fixture's uncategorized bucket otherwise sums to
  `+920,33 €` because of a salary — research 04 §4). **Booked and pending never summed into one
  number.** Every category gets a row even with zero spend (a `GROUP BY` would drop it). Exactly at
  the limit is not "over".
- **Computed in the browser** over already-loaded rows (0.478 ms for 50k rows, research 04 §7),
  so there is no reporting endpoint.
- The provider loads everything once, aborts a superseded reload, and exposes `transactions` as
  `undefined` until _every_ account has answered — "a total over some of the accounts is a wrong
  number, not a partial one".

**Say out loud:** "What counts as spending is decided in exactly one function, in core, and the
overview, the rows and the trend all call it. The browser already holds every row for filtering,
so aggregating there is cheaper than a round trip and keeps the rule in one place."

**Might struggle to defend:** **Everything is loaded into the browser.** Fine for one household
(research 03 §9: ~407 B/row, ~1.5 MiB for eight years), but there is no pagination and no plan for
when it stops being enough — that question is recorded as open. Also: the Überblick headline is
booked-only, while a row's `isOver` counts booked + pending, so a row can say „über" while the
headline does not (plan 04, recorded but not reconciled; dogfood ISSUE-008 left as won't-fix).

---

## 4. Technology choices

### Root / tooling

| Tool                                         | What it is                                                               | Why here                                                                                                                                                                                                                                                | Alternative                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **pnpm 12** workspaces                       | Package manager with a content-addressed store and strict `node_modules` | Monorepo with `workspace:*` links; strict layout stops phantom deps; `allowBuilds` in `pnpm-workspace.yaml` allowlists install scripts (Prisma, swc, better-sqlite3, lefthook). pnpm 12 quarantines very new versions, hence `minimumReleaseAgeExclude` | npm/yarn workspaces, Nx, Turborepo                                                                 |
| **TypeScript ~6.0.3**                        | —                                                                        | Strict base (`tsconfig.base.json`: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, …). Pinned below 6.1 because `typescript-eslint@8` and `@nestjs/cli@12` require it (README "Version pins")                                                 | TS 7 native compiler (not yet supported by those tools)                                            |
| **ESLint 10 + typescript-eslint 8 (strict)** | Linter                                                                   | Deliberately _not_ type-aware (speed; tsc already checks types) except an overlay for `no-floating-promises` / `no-misused-promises` in `src/` and Playwright specs — the one bug class tsc misses. `eslint.config.mjs`                                 | Fully type-aware lint (slow), Biome                                                                |
| eslint-plugin-react-hooks / react-refresh    | React lint rules                                                         | Hooks rules; HMR-safe exports                                                                                                                                                                                                                           | —                                                                                                  |
| eslint-config-prettier, **Prettier 3**       | Formatter                                                                | Formatting is not a lint concern; prettier config turns off conflicting rules                                                                                                                                                                           | Biome, dprint                                                                                      |
| **dependency-cruiser**                       | Import-graph linter                                                      | Turns the CLAUDE.md rule "core never imports NestJS/React/Prisma" into a failing check, including type-only imports, plus a `not-to-unresolvable` tripwire so the rule can't pass vacuously                                                             | ESLint `no-restricted-imports` (misses type-only imports resolved elsewhere), Nx module boundaries |
| **lefthook**                                 | Git hooks manager (Go binary via npm)                                    | pre-commit / pre-push jobs in `lefthook.yml`, installed by `pnpm install` (`prepare`)                                                                                                                                                                   | husky + lint-staged                                                                                |
| **gitleaks** (brew, not npm)                 | Secret scanner                                                           | Staged-diff secret scan; the script fails if it's missing rather than silently passing (`scripts/gitleaks.sh`)                                                                                                                                          | trufflehog, GitHub secret scanning                                                                 |
| globals, @types/node, @eslint/js             | Support packages                                                         | —                                                                                                                                                                                                                                                       | —                                                                                                  |

### Backend (`apps/api`)

| Library                                                      | What it is                                                                                       | Why here                                                                                                                                                                                                   | Alternative                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **NestJS 12** (`@nestjs/common`, `core`, `platform-express`) | Opinionated Node framework: modules, controllers, providers, dependency injection via decorators | Clear module-per-feature structure (`import/`, `rules/`, `budgets/`, `accounts/`), DI makes services testable with `Test.createTestingModule`. NestJS 12 is ESM-only, hence `.js` import suffixes          | Express/Fastify by hand (less structure), Hono, tRPC |
| `@nestjs/platform-express` → **multer**                      | Express adapter; `FileInterceptor` parses multipart uploads                                      | CSV upload with explicit limits                                                                                                                                                                            | busboy directly                                      |
| **@nestjs/config**                                           | `.env` loading as a module                                                                       | Loads `apps/api/.env` before providers are built                                                                                                                                                           | `dotenv` directly                                    |
| **reflect-metadata**                                         | Polyfill for decorator metadata                                                                  | Nest DI reads constructor parameter types at runtime (`design:paramtypes`). This is also why `consistent-type-imports` is **off** in `apps/api` — rewriting to `import type` would erase them and break DI | —                                                    |
| rxjs                                                         | Reactive streams                                                                                 | Required peer of Nest; not used directly in this code                                                                                                                                                      | —                                                    |
| **Prisma 7** (`prisma`, `@prisma/client`)                    | Schema-first ORM with generated typed client                                                     | Typed queries from `schema.prisma`; `db push` for a local single-user DB. Prisma 7 moved the URL to `prisma.config.ts`                                                                                     | Drizzle, Kysely, raw better-sqlite3                  |
| **@prisma/adapter-better-sqlite3**                           | Driver adapter                                                                                   | Prisma 7 runs queries through a JS driver — no Rust query engine at runtime                                                                                                                                | Prisma's legacy engine                               |
| **SQLite** (better-sqlite3)                                  | Embedded file DB                                                                                 | Local-only app: one file in `apps/api/data/`, no server. "SQLite is a deliberate endpoint, not a placeholder for Postgres" (CLAUDE.md WHY). Cost: ASCII-only case folding → matching in JS                 | Postgres (needs a server), IndexedDB (browser-only)  |
| dotenv                                                       | `.env` loader                                                                                    | Used by `prisma.config.ts` for the CLI                                                                                                                                                                     | —                                                    |
| **@nestjs/cli, @nestjs/schematics**                          | Build/watch (`nest start --watch`, `nest build`) and generators                                  | Standard Nest dev loop                                                                                                                                                                                     | tsc + nodemon                                        |
| **@swc/core + unplugin-swc**                                 | Rust TS compiler as a Vite/Vitest plugin                                                         | Vitest uses esbuild, which drops `emitDecoratorMetadata`; Nest DI needs it, so SWC does the transform in tests (`apps/api/vitest.config.ts`)                                                               | ts-jest / Jest                                       |
| **@nestjs/testing**                                          | Builds a DI container for tests                                                                  | Service tests instantiate real services against a real SQLite test DB                                                                                                                                      | Manual construction, mocks                           |

### Core (`packages/core`)

| Library              | Why                                                                                                                                                                                                          | Alternative                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| **csv-parse** (sync) | Handles quoted fields with embedded CRLF, `;` delimiter, BOM; strict column count so a truncated file fails loudly. Chosen in research 01 over papaparse, fast-csv and hand-rolled ("swallows rest of file") | papaparse (browser-first), hand-rolled |

### Frontend (`apps/web`) — briefer

| Library                                             | Why                                                                                                                         |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| React 19, react-dom                                 | UI                                                                                                                          |
| Vite 8 + @vitejs/plugin-react                       | Dev server with `/api` proxy (single origin), build                                                                         |
| MUI 9 (`@mui/material`, `icons-material`) + Emotion | Component library, CSS-in-JS engine MUI requires; light/dark via `colorSchemes` + `useColorScheme`                          |
| `@mui/x-charts`                                     | Six-month trend bar chart (`pages/overview/TrendChart.tsx`); pinned to 9.13 because of pnpm quarantine (plan 04 decision 8) |
| `@dnd-kit/*`                                        | Drag-to-reorder rules (`pages/rules/RuleList.tsx`); order is priority                                                       |
| react-router 7                                      | Five routes; month in `?m=`                                                                                                 |
| i18next + react-i18next                             | DE/EN; `en.ts` typed against `de.ts`, so a missing translation fails typecheck (plan 07)                                    |
| `@fontsource/*` (IBM Plex Sans/Mono, Newsreader)    | Bundled fonts — no Google Fonts request, consistent with "nothing leaves the machine" (plan 08)                             |

### Testing

| Tool                                  | What it is                                                                                           | Why here                                                                                                                                                                                                                     | Alternative          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **Vitest 5**                          | Vite-native test runner, Jest-compatible API                                                         | One runner for all three packages; each package owns its `vitest.config.ts`. `--reporter=dot`, `test:fast` bails on first failure                                                                                            | Jest                 |
| **jsdom**                             | DOM implementation in Node                                                                           | Web component tests without a browser                                                                                                                                                                                        | happy-dom            |
| **@testing-library/react + jest-dom** | Render components and query them the way a user would (roles, labels)                                | Behaviour-level component tests                                                                                                                                                                                              | Enzyme (dead)        |
| **Real SQLite in API tests**          | `src/test/global-setup.ts` runs `prisma db push --url` into `data/test.db`; `fileParallelism: false` | "The import's whole behaviour — the unique index covering soft-deleted rows, SQLite treating NULL dedup keys as distinct — lives in the queries, so a mocked Prisma would test nothing here."                                | Mocked Prisma client |
| **Playwright**                        | Real-browser E2E                                                                                     | Boots API (:3100) and Vite (:5174) itself, throwaway `e2e.db` reset by `scripts/reset-e2e-db.mjs`, one worker, Chromium only. Ports differ from dev so an E2E run can never write into your real `budget.db` (fix `6243cc7`) | Cypress              |

---

## 5. Workflow story — how the RPI cycles ran

**Setup (2026-09-22):** scaffold (`e28cba1`, PR #1) → CLAUDE.md (`95c2b04`) → **quality gates before
any feature** (`97bbd0e`, PR #3: strict ESLint, dependency-cruiser, Playwright smoke,
data-guard, gitleaks, `pnpm check`, lefthook) → project `commit` skill (`bd18a3c`) → vendored the
RPI skills from `MaibornWolff/acf-research-plan-implement-skills` (`86e723c`, pinned by hash in
`skills-lock.json`). The research/plan front-matter (`date`, `git_commit`, `branch`, `status`) comes
from those skills' `metadata.py`.

Pattern for each feature: research doc → user answers the open questions ("Decisions confirmed"
section) → plan with numbered decisions, phases and success criteria → implementation commits →
fix commits from review/dogfooding → plan updated with "Implementation Notes" / "Later changes".

| #   | Feature                                                               | Research found                                                                                                                                                                              | Plan decided                                                                                                                                                                                              | What changed during/after build                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | CSV import (`36b2823`…`e45bcda`, PRs #5–#6)                           | Core can't decode or hash (`"types": []`); `Kategorie` column optional → 17 and 18 cols; dates `DD.MM.YY`; truncated amounts `832,9`; UTF-8 → cp1252 never latin1; csv-parse over papaparse | 10 decisions: vertical slice, match by name, partial success, cents + string dates, pending replaceable, soft-delete restore, occurrence index **per file** (simplified from research's multiset framing) | Parser moved behind `core/csv` after `Buffer` leaked into the web bundle ("Gate 3 failed"); line numbers hand-computed; `ImportBatch` written before rows (FK). Fixes: `07c3548` older export deleted pending rows; `c97d72c` future-dated pending row pinned the staleness watermark; `f819a10` account-switch race; `6243cc7` e2e wrote to dev DB |
| 02  | Categorization rules (`c9961e0`…`83359c6`, PR #8)                     | SQLite ASCII-only case folding (measured); 6 ms for 50k×20 in JS; regex exponential; "nobody does pure first-match-wins"                                                                    | 12 decisions: match in core, one condition, `(priority, createdAt, id)`, shared normalizer, `categoryLockedAt`, apply writes null, global apply                                                           | "No rules ⇒ return zeros" struck: deleting the last rule must clear. Three fix commits closing 13 category-loss bugs (e.g. RuleForm without `key` saved over another rule; partial PATCH re-enabled a disabled rule / reset priority; `applyAll` inherited Prisma's 5 s timeout; apply overwrote a lock set mid-run)                                |
| 03  | Transactions list (`9abeb91`…`adab39b`, PRs #9–#10)                   | `LIKE` misses `MÜLLER`; every row already in the browser; 0.99 ms per keystroke at 50k                                                                                                      | Browser-side filtering in pure `filter.ts`, no API change, component state (not URL)                                                                                                                      | `adab39b` fixed three review holes (month format for `'2025-'`, `de` matching every IBAN, chip aria-label hid the count). Component-state decision later reversed by plan 08 (URL params)                                                                                                                                                           |
| 04  | Monthly budgets (`4170cff`…`4c783fa`, PRs #11–#12)                    | No budget model; fixture uncategorized sums to `+920,33 €` (salary); `GROUP BY` drops empty categories                                                                                      | Household-wide limits, money out only, booked/pending apart, computed in browser by `monthlyReport`, `PUT` upsert, x-charts                                                                               | `94c377e`: per-account view against household limits was wrong ("400 € on each of two cards … read 'übrig' on both while the household was 100 € over") → all accounts, no picker. Research + plan committed **after** the feature commits "as built" (`464da62`)                                                                                   |
| 05  | Dogfood fixes (PRs #13, #16)                                          | Input: `dogfood-output/report.md`, 10 issues (4 medium, 6 low)                                                                                                                              | Fix 5, defer 5                                                                                                                                                                                            | Two more found by the user (rule delete without undo, refusal flicker) → `447200d`, `478d5fc` (restore race 500 → 409)                                                                                                                                                                                                                              |
| 06  | Security hardening (`be5f8ff`, PR #14)                                | Input: `docs/reports/2026-09-24-security-review.html`. HIGH: API bound all interfaces + `enableCors({ origin: true })` → CSRF / DNS rebinding                                               | Bind 127.0.0.1, drop CORS, loopback Host/Origin guard, multer limits, MIME allowlist, capped row errors, log sanitizing                                                                                   | E2E added for 2nd file → 400 and 11 MB → 413 after review                                                                                                                                                                                                                                                                                           |
| 07  | Language + theme (`7ff5def`, `954054b`, PR #17)                       | No locale state anywhere; ~15 inline German literals                                                                                                                                        | i18next with TS resources typed against `de`; amounts/dates always `de-DE`                                                                                                                                | Review reversed decision 11: messages are stored as causes and worded at render so they follow a language switch                                                                                                                                                                                                                                    |
| 08  | UI redesign "Kassenbuch" (`303f2fc`…`4db7dcb`, branch **not merged**) | Research 06: "correct and careful, but visually unauthored"; pages mirror backend features, not user questions                                                                              | 18 decisions: 5 routes, month in `?m=`, `HouseholdProvider`, one `uncategorizedRows`, `Category.colorIndex`, position = priority (`PUT /api/rules/order`)                                                 | Decision 15 (`usePageChrome`) not built (re-render loop); palette replaced after failing a validator; trend draws only the shown month's limit; `4db7dcb` re-scoped the uncategorized count to the chosen month after user feedback                                                                                                                 |

Numbering note: plans 05/06 have no research doc (their input was the dogfood report and the
security review); research 05 → plan 07, research 06 → plan 08.

**One-liner for the trainers:** "Research is where the load-bearing facts came from — the SQLite
case-folding measurement decided the architecture of two features. The plans changed during every
build, and I recorded the departures in the plan rather than silently diverging."

---

## 6. Backpressure story

| Check        | Command                              | When it runs                                 | What it catches / caught                                                                                                                                                     |
| ------------ | ------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format       | `pnpm format:check`                  | `pnpm check`, pre-commit (staged files)      | Formatting drift                                                                                                                                                             |
| Lint         | `pnpm lint`                          | `pnpm check`, pre-commit (staged `.ts/.tsx`) | Unawaited promises (`no-floating-promises`, incl. Playwright `expect` without `await`); `react-hooks/refs` rejected `budgetsRef.current = …` during render (plan 05 Phase 4) |
| Architecture | `pnpm lint:deps`                     | `pnpm check` (not pre-commit)                | Framework import in core, including type-only; unresolvable imports. Tripped during plan 01 on `csv-parse/sync` until `exportsFields` was configured ("Gate 1 failed")       |
| Typecheck    | `pnpm typecheck`                     | `pnpm check`, pre-commit (whole project)     | Strict TS in 3 packages + web's node and e2e tsconfigs; missing English translation (`en` typed against `de`); stale core `dist`                                             |
| Unit tests   | `pnpm test` (`pnpm test:fast` bails) | `pnpm check`; pre-commit runs **core only**  | ~110 core, ~118 api (real SQLite), ~235 web cases (regex count, approximate)                                                                                                 |
| E2E          | `pnpm test:e2e`                      | `pnpm check:all`, **pre-push**               | 34 tests in 12 specs; import → rules → budgets through the real proxy                                                                                                        |
| Data guard   | `node scripts/check-staged-data.mjs` | pre-commit, first                            | CSV/OFX/XLS outside `fixtures/`, `.env*`, `*.db*`                                                                                                                            |
| Secret scan  | `./scripts/gitleaks.sh`              | pre-commit                                   | Secrets in staged diff; fails if gitleaks isn't installed                                                                                                                    |
| Commit skill | `/commit`                            | when Claude commits                          | Runs `pnpm check`, refuses forbidden paths, writes Conventional Commits                                                                                                      |

Also: the web build (`vite build`) was used as a manual gate in plan 01 to prove no `Buffer` in the
bundle — it is **not** part of `pnpm check`.

**Verified today (2026-09-28):** `pnpm check` on a clean tree at `4db7dcb` → all five steps
green in ~18 s (format 1.5 s, lint 6.1 s, deps 0.4 s, types 3.6 s, unit 6.4 s).

`pnpm check:all` → **inconclusive**: 8 of 34 Playwright tests failed (inbox, monthly-budgets,
monthly-totals, overview, preferences/theme), but the working tree was being edited while the run
was in flight (uncommitted changes deleting the Inbox page and editing `filter.ts`, timestamped
17:40–17:41, not made by this review). **Re-run `pnpm check:all` on a clean checkout before the
meeting** — the pre-push hook runs it, so a red E2E means you cannot push.

Both "trip it" demos below were run and behave as described: `lint:deps` reports
`core-stays-framework-free` and `not-to-unresolvable`; the data guard prints
"Blocked 1 staged file(s)" and exits 1.

**Live demo script** (from the repo root):

```bash
pnpm check                                    # one line per step, ~20 s
pnpm lint:deps                                # show the architecture rule
pnpm --filter @household-budget/core exec vitest run -t 'parses both date widths'
pnpm --filter @household-budget/api exec vitest run src/import/import.service.test.ts
pnpm test:e2e                                 # boots API + web, ~1–2 min

# Trip the architecture gate on purpose, then undo:
echo "import type { Injectable } from '@nestjs/common';" >> packages/core/src/index.ts
pnpm lint:deps                                # → core-stays-framework-free error
git checkout packages/core/src/index.ts

# Trip the data guard on purpose, then undo:
echo "a;b" > statement.csv && git add -f statement.csv
node scripts/check-staged-data.mjs            # → Blocked 1 staged file(s)
git restore --staged statement.csv && rm statement.csv
```

Rehearse the two "trip it" demos once before the meeting.

---

## 7. Likely questions

### Workflow / process

1. **"Walk us through one RPI cycle."** Categorization rules: research 02 measured that SQLite
   `LIKE` misses `MÜLLER` and that JS matching costs 6 ms at 50k rows; the user confirmed 7
   decisions; plan 02 had 12 decisions and 5 phases; the build changed "no rules ⇒ return zeros"
   to "clear everything"; three fix commits followed a review.
2. **"How did you know the agent's output was correct?"** The gates in §6, run by hooks, plus
   review passes that produced fix commits (`d56271f` lists eight concrete defects). Honest
   caveat: manual verification against a real bank export was never done (see §8).
3. **"Why write research before the plan?"** Because two facts found in research decided the
   architecture: core can't decode or hash, and SQLite can't case-fold umlauts. A plan written
   first would have put matching in SQL.
4. **"What did you do when the plan was wrong?"** Recorded it in the plan's Implementation
   Notes / "Later changes" (e.g. plan 01 "Gate 3 failed", plan 08 decision 15 not built). Not
   always complete — see §8.

### Architecture

5. **"Why a separate core package?"** Rules must give the same answer in the browser (preview) and
   the server (apply); one implementation, testable without framework, enforced by
   dependency-cruiser.
6. **"Why SQLite and not Postgres?"** Local-only, single user, one file, no server. The price
   (ASCII-only case folding) is paid by matching in JS.
7. **"Why load every transaction into the browser?"** One household is small (~1.5 MiB for eight
   years, research 03 §9); filtering is 0.99 ms per keystroke at 50k rows. It removes a query
   endpoint and keeps text matching in core's `normalize()`. No plan exists for when it's too big.
8. **"How does deduplication work?"** Content fingerprint of booked rows + occurrence index among
   identical rows in the file, hashed, unique per account. Pending rows have no key and are
   replaced. Soft-deleted rows are restored.

### Testing

9. **"Why not mock the database in API tests?"** The behaviour lives in constraints (unique index
   over soft-deleted rows, NULLs distinct). A mock would test nothing. Real SQLite in
   `data/test.db`, serialized.
10. **"What does E2E cover that unit tests don't?"** That core, API, SQLite, the Vite proxy and the
    browser actually connect: import, re-import (0 new), rules, budgets, security limits.
11. **"How do you keep E2E from touching real data?"** Separate ports (3100/5174),
    `reuseExistingServer: false`, `e2e.db` deleted and re-pushed before every run.

### Security

12. **"There's no auth — isn't that a hole?"** Local by design. The real threat is another
    website in your browser (CSRF, DNS rebinding). Hence: bind `127.0.0.1`, no CORS, and a guard
    that 403s any non-loopback `Host` or `Origin` (`apps/api/src/security/loopback.ts`) — the
    fix for the HIGH finding in the 2026-09-24 review.
13. **"How do you stop real bank data landing in git?"** `.gitignore` (`*.csv` except fixtures,
    `data/`, `*.db*`), `check-staged-data.mjs` at pre-commit, gitleaks, logs that mask IBANs and
    never log purpose/payee/rule values.

### "Why did you do X this way?"

14. **"Why amounts as integer cents and dates as strings?"** Floats can't represent `0.10`; a
    booking date has no time zone, and `new Date('2025-09-01')` is UTC midnight, which is August
    in some zones.
15. **"Why first-match-wins and not 'most specific wins'?"** Predictable, explainable ("rule 3
    claimed it"), and the order is visible and draggable. Total order via `(priority, createdAt,
id)` makes it reproducible.

---

## 8. Weak spots — blunt

### Things you (or your prompt) claim that are missing

- **`docs/learnings.md` does not exist.** Not in the tree, not in git history.
- **`DEBUG.md` does not exist.** Same.
- **No Claude Code hooks.** There is no `.claude/settings.json`; the only Claude setting is
  `.claude/settings.local.json` (git-ignored, a statusline). All "hooks" in this repo are **git
  hooks via lefthook**. Say it that way.
- **No CI.** No `.github/` directory. The only enforcement is local hooks, which can be bypassed
  with `LEFTHOOK=0` or `--no-verify`. The pre-push hook is the last line of defence.
- **The `add-bank-format` skill has never been exercised** in this repo: only Sparkasse is
  supported, `packages/core/src/csv/dialects/` does not exist, and the skill's own step 0 says the
  registry seam still has to be extracted first. It has an `evals/evals.json`; I found no
  recorded eval results.
- **The `commit` skill was not used for the last commit**: `4db7dcb` has no Conventional Commits
  prefix — the only one of 77 commits without one (merges and the initial commit aside). Nothing
  mechanical enforces commit message format (no commitlint).

### Verification gaps

- **No manual check against a real bank export was ever done.** Plans 01, 02, 03, 05, 07, 08 all
  have unchecked Manual Verification boxes; plan 01 explains it needs a real export, which may not
  be committed. Plan 04's ticked manual checks were run "in a browser through Playwright against a
  throwaway database", not by a person.
- **Dark mode legibility unverified** (plan 07 criterion unchecked; plan 08 then replaced the
  theme). Plan 08's "light + dark, DE + EN, at 390/1024/1440 px" criterion is marked `[-]` partial.
- **Pre-commit runs only core unit tests**, not api/web. `lint:deps` runs only in `pnpm check`.
- **`vite build` is not in any gate**; the `Buffer`-in-bundle regression that happened once in
  plan 01 would not be caught by `pnpm check` (typecheck wouldn't see it). Plan 04 also notes a
  bundle-size warning (870 kB) and `lazy()` "not done".
- No coverage measurement is configured.

### Docs that disagree with the code

- **README is stale:** "Two of the three product steps … are built" (all three are), and the
  scripts table calls `check:all` "the Playwright smoke test" (it's 12 specs).
- **Plan status fields are wrong:** plan 02 `status: draft`, plans 05/06 `status: ready` — all
  implemented. Plan 08 says `implemented` while unmerged, with a `[-]` criterion.
- **Plan 08 contradicts itself after `4db7dcb`:** decision 5 and an acceptance criterion still say
  badge = chip = inbox; the chip now follows the month. Decision 15 (`usePageChrome`) and the trend
  "summed limit" line describe things not built as written.
- **Plan 01 omits the staleness rule** (`07c3548`, `c97d72c`); plan 02 omits the `compareRules`
  vs `orderRules` listing change that commit `c9961e0` says is "recorded in docs/plans"; plan 03
  omits all three `adab39b` fixes.
- **Plan 04's research and plan were committed after the code** (`464da62`, "as built"). A trainer
  may ask whether that cycle was really research-first.

### Design questions I'd ask as a grader

- **Concurrent imports:** duplicate detection reads before the `$transaction`; two parallel
  uploads of the same file would likely hit the unique index and 500. Unverified.
- **Budget headline vs row semantics:** headline booked-only, row `isOver` booked + pending.
  Dogfood ISSUE-007 (budgets only for months with bookings) and ISSUE-008 (headline counts
  unbudgeted spend) — both medium — are "won't fix (for now)".
- **Occurrence index is per file.** Correct as long as identical rows (same day, same amount, same
  text) are either all in an export or all out — true for day-bounded exports; untested against
  an export cut mid-day.
- **Case-duplicate category names** already in a DB are left "for the user to merge by hand"
  (plan 05); the new check has an accepted check-then-insert race.
- **Schema changes use `prisma db push`, no migrations.** Fine for one local user; no upgrade path
  for a renamed column.
- **Pending rows can't be categorized by hand** and deleted pending rows come back on the next
  import — acknowledged, but a user-visible quirk.
- **Fixture IBANs**: the security review notes some were "not proven fake". Worth checking before
  the meeting.
- **`DELETE /api/transactions/:id`** exists and is tested, but the web client has no call to it —
  there is no delete button in the UI.

### Housekeeping to do before the meeting

- **Merge or PR `feat/ui-redesign`** — 7 commits ahead of `main`, pushed, no PR.
- A 60 MB **`core` file at the repo root** is a Linux core dump of `pnpm-native` (git-ignored via
  `/core`, not tracked). Delete it so it doesn't show up in a live `ls`.
- `dogfood-output/report.md` and 11 screenshots are tracked; the screenshots folder is now
  git-ignored but the old files remain (plan 06 notes this as "left to the user").
- Fix the README's first paragraph and the plan status fields — cheap, and trainers will read them.
