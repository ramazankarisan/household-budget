---
date: 2026-09-23T12:18:02Z
git_commit: adab39b15cb2252936b583dbe0606bf68438b50b
branch: docs/03-transactions-list
topic: 'Monthly budgets per category: budget math in packages/core, actual vs budget for a selected month, over-budget highlighting, one spending chart'
tags: [research, budgets, reporting, packages-core, apps-api, apps-web, prisma, sqlite, charts]
status: complete
---

# Research: Monthly budgets per category

## Research question

A monthly budget per category, with the budget math in `packages/core` and every amount in integer
cents; a dashboard showing actual against budget per category for a selected month, highlighting
the categories that are over, plus one chart of the spending. What exists today, and what does the
codebase force on each of those?

## Summary

**None of it is built, and the codebase says so in three places.** `App.tsx:6-9` calls reporting
"the remaining third of the product"; `CLAUDE.md` states "reporting is not built yet"; `Category`
in the schema is documented as the thing "a monthly report groups by and by nothing else"
(`schema.prisma:99-100`). There is no `Budget` model, no `budget` module in `packages/core`, no
aggregate endpoint, no third route and no chart library — `grep -ri budget` over `packages/core/src`,
`apps/api/src` and `apps/api/prisma` returns only the package name, the database filename, and the
word used to mean a _timeout_ budget (`rule.service.ts:27`, `:346`).

**Four of the five pieces such a feature needs already exist and are named.** Integer cents run end
to end and are branded in core (`Cents`, `toCents`, `transaction.ts:9-21`); the month key
`'YYYY-MM'` and the "months this account actually has" list are built
(`filter.ts:42-50`) and already drive a `<Select>` (`TransactionFilters.tsx:52-68`); the category
assignment is settled, rule-derived or hand-locked (`schema.prisma:80-84`); and `formatMonth`
already renders `2025-09` as `September 2025` (`format.ts:51-60`). What is missing is a place to
store a limit, the math over the rows, a way to get the two to the browser together, and anything
that can draw.

**The fifth piece has no precedent anywhere in the repo: there is no charting library** — not in
`apps/web/package.json`, not anywhere resolvable by it. The `d3-*` and `@visx/*` entries in
`pnpm-lock.yaml` belong to `@prisma/studio-core`, a transitive dependency of the `prisma` CLI in
`apps/api`. `@mui/material@9.4.0` is the only MUI package installed; there is no `@mui/x-charts`
and no icon package (the app's icons are the emoji ⏳ 🔒 ✕).

**The aggregation itself is cheap either way, and the choice is the same seam
`docs/research/03-transactions-list.md` §9 already found.** Measured on this checkout (§5, §7): a
`GROUP BY categoryId` over a half-open `bookingDate` range uses
`Transaction_accountId_bookingDate_idx` and costs 0.162 ms at 50 000 rows; the same grouping done
in JavaScript over rows the page has already loaded costs 0.478 ms for one month and 3.355 ms for
every month of a whole history. A per-month aggregate for twelve categories is **1 291 bytes**; the
transaction rows it would be derived from are **399 bytes each**, and `AccountPage` already
downloads all of them (≈1.46 MiB for an eight-year history).

**Three facts about the data will decide what "actual" means before any of that matters** (§4):
`GROUP BY categoryId` returns a `null` bucket for uncategorized rows; a month with no rows returns
_no rows at all_, not zeros (`SUM` over an empty set is SQL `NULL`); and a month's rows are not all
spending — in `apps/api/data/e2e.db` the September 2025 uncategorized bucket sums to **+920,33 €**
because a `+2 450,00` salary row sits in it.

Key files:

```
packages/core/src/
  index.ts                 The browser-safe barrel. Exports Cents and toCents (:20-27).
  api.ts                   The API↔web contract. "amounts in integer cents" (:1-7).
  csv/transaction.ts       Cents (branded), toCents, bookingDate as 'YYYY-MM-DD' (:9-21, :50).
  csv/fields.ts            parseGermanAmount — the one place cents are produced (:30-47).
  rules/match.ts           The precedent for pure domain logic both ends run.
  rules/rule.ts            The precedent for validating an input and returning codes, not sentences.
                           (no budget/ directory, no month helper, no aggregation)
apps/api/
  prisma/schema.prisma     Account, ImportBatch, Transaction, Category, Rule. No Budget.
  src/accounts/account.service.ts   listTransactions — no filters, no select, no aggregate.
  src/rules/category.service.ts     The only counts in the codebase (:87-90); delete refusal.
  src/rules/rules.module.ts         The canonical module shape a fourth one would mirror.
apps/web/src/
  App.tsx                  Two routes; :6-9 names reporting as the missing third page.
  filter.ts                monthOf, monthsOf, uncategorizedCount — already pure, already tested.
  format.ts                formatAmount (:15), formatMonth (:51). No percent formatter.
  pages/TransactionFilters.tsx  The month <Select> (:52-68) and the warning Chip (:124-141).
  pages/TransactionList.tsx     Semantic colour by sign (:125), tabular-nums (:124).
  pages/AccountPage.tsx    The page-owns-the-load pattern every new page copies.
  theme.ts                 light + dark colour schemes, no palette override.
  i18n/transactions.ts     Record<Locale, …> strings; month/category/uncategorized already there.
```

What exists today, and where a budget number would have to enter it:

```
apps/web                                   apps/api                      SQLite
──────────────────────────────────────────────────────────────────────────────────────────
AccountPage
  listTransactions(accountId) ─────────► GET /accounts/:id/transactions
                                           where { accountId, deletedAt: null }   [index]
      ◄── TransactionPayload[] ──────────── every live row, every column
  useState transactions[]
    ├─► monthsOf()        'YYYY-MM', newest first   ← the month selector's options
    ├─► filterTransactions()                        ← month AND category AND text
    └─► uncategorizedCount()

        ?  actual per category, for one month        ← does not exist (§5, §7)
        ?  budget per category, for one month        ← does not exist anywhere (§3)
        ?  over / under                              ← does not exist (§9)
        ?  a chart                                   ← nothing installed can draw one (§10)
```

## What the codebase forces

1. **Amounts stay integer cents, and the one float is at the very edge.** `Cents` is branded and
   `toCents` throws on anything that is not a safe integer (`transaction.ts:13-21`); `amountCents`
   is `Int` in SQLite (`schema.prisma:65`); the single division in the repo is
   `CURRENCY.format(cents / 100)` (`format.ts:15-17`), and its own comment says nothing is computed
   from the result. A budget limit and a difference are both cents.
2. **A booking date is a string, and a month is its first seven characters.** Never a `Date`
   (`transaction.ts:50`, `fields.ts:78-80`, `filter.ts:38-44`). A half-open range over that string
   is the index-using query shape; `substr()` and `LIKE` are not (§5, and `research 03` §5).
3. **`packages/core` may not import NestJS, React or Prisma**, type-only included, enforced by
   `pnpm lint:deps` over `packages/core/src` (`.dependency-cruiser.cjs:14-31`). It also has
   `"types": []` and `"lib": ["ES2023"]`, so there is no `Buffer`, no `fetch`, no `node:crypto`.
   Budget math there is plain functions over plain data.
4. **Formatting is not core's job.** `api.ts:1-7` — "plain data, no `Date`, amounts in integer
   cents"; `normalize.ts:9-11` records the same posture for `Intl`. A core function returns cents
   and booleans; `apps/web` turns them into `-832,90 €` and `September 2025`.
5. **The contract types live once, in `packages/core/src/api.ts`**, and both ends import them
   (`account.service.ts:1`, `client.ts:1-9`). A budget payload would go there or nowhere.
6. **There is no query parameter anywhere in `apps/api`.** Not one `@Query` decorator; every route
   takes a path param or a body (`account.controller.ts`, `category.controller.ts`,
   `rule.controller.ts`). A month-scoped endpoint would be the first.
7. **Services validate, controllers stay thin, and there are no DTO classes** — no
   `class-validator`, no `zod`, no `ValidationPipe`. Bodies are local `interface`s with
   `readonly x?: unknown` fields, narrowed in the service, or parsed by a core function
   (`rule.service.ts:373-379` calling `parseRuleInput`).
8. **Deleting a category is refused while anything points at it, and the refusal counts exactly two
   things** — rules and live transactions (`category.service.ts:87-96`). A third pointer would make
   that count incomplete.
9. **There are no migrations.** `prisma.config.ts:12-14` declares a path that does not exist; the
   schema is applied by `prisma db push` — in development (`package.json` `db:push`), in the unit
   suite (`test/global-setup.ts:31`) and in the e2e reset (`scripts/reset-e2e-db.mjs`).
10. **A new front-end dependency is not blocked by `lint:deps`** — the root script cruises
    `packages/core/src` only — but pnpm 12 quarantines very recent releases, and this repo's
    exceptions are listed by exact version in `pnpm-workspace.yaml` (`minimumReleaseAgeExclude`),
    with native modules allowlisted in `allowBuilds`.
11. **Everything ships with `pnpm check` green** (format → lint → deps → typecheck → unit tests),
    and anything touching HTTP or UI with `pnpm check:all` (Playwright on :3100/:5174 against its
    own database).

## Detailed findings

### 1. What exists of "report" today — nothing, and the hole is named three times

- `apps/web/src/App.tsx:12-17` has exactly two routes, `/` → `AccountPage` and `/rules` →
  `RulesPage`. The comment above them (`:6-9`) reads: "Two routes. The third — reporting — is the
  remaining third of the product, and is a page rather than a tab on either of these for the same
  reason." `Nav.tsx:16-17` renders two links for the same reason.
- `CLAUDE.md` (WHAT): "import → categorize works end to end … reporting is not built yet", and
  (WHY): the product is "import → categorize → report", where report means "shows monthly budgets —
  spend per category against a limit".
- `schema.prisma:99-100`, on `Category`: "A spending bucket. Named by the user, assigned either by a
  rule or by hand — a monthly report groups by this and by nothing else."

Searches confirming the absence, run on this checkout:

| Search                                                  | Scope                                    | Result                                                                                                                             |
| ------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `grep -ri budget`                                       | `packages/core/src`                      | 4 hits: the package name (`index.ts:3`, `csv/parse.ts:6`, `csv/index.ts:2`) and "Primary date for budgeting" (`transaction.ts:50`) |
| `grep -ri budget`                                       | `apps/api/src`, `apps/api/prisma`        | the `@household-budget/core` specifier, `budget.db`, and _timeout_ budgets (`rule.service.ts:27`, `:346`)                          |
| `groupBy\|aggregate\|_sum\|$queryRaw`                   | `apps/api/src` (excl. `generated/`)      | none — the only aggregation in the codebase is `.count()` (`category.service.ts:88-89`, `rule.service.ts:197`)                     |
| `recharts\|x-charts\|chart.js\|victory\|nivo\|visx\|d3` | every `package.json`, every `.ts`/`.tsx` | none (§10)                                                                                                                         |

### 2. Integer cents, end to end — the convention that already holds

The brand and its single production point, `packages/core/src/csv/transaction.ts:9-21`:

```ts
/**
 * Signed minor units. Branded so a euro amount cannot be passed where cents are
 * expected: `19.99 * 100` is `1998.9999999999998`, and no amount here is ever a float.
 */
export type Cents = number & { readonly __brand: 'Cents' };

/** Asserts at the one place integer cents are produced, so the brand stays honest. */
export function toCents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Cents must be a safe integer, received ${String(value)}`);
  }
  return value as Cents;
}
```

Both are exported from the browser-safe root entry (`index.ts:20-27`), so `apps/web` can hold a
`Cents` as well as render one. The parser never multiplies: `parseGermanAmount`
(`fields.ts:30-47`) concatenates the digit groups and calls `Number` once, and its comment states
the rule — "Never `parseFloat(x) * 100` — that idiom is itself the bug: `Math.round(1.005 * 100)`
is 100, not 101."

Downstream the convention is unbroken: `amountCents Int` (`schema.prisma:65`), `amountCents: number`
described as "Signed integer cents" (`api.ts:54-55`), written straight through at
`import.service.ts:84`, and fingerprinted as `String(transaction.amount)` so `832,9` and `832,90`
cannot key differently (`fingerprint.ts:31`).

Note what the brand does **not** currently cover: `TransactionPayload.amountCents` is a plain
`number`, not `Cents` (`api.ts:55`), because it crosses JSON. Anything reading the payload back into
core arithmetic re-enters through `toCents` or stays untyped.

Two boundaries a budget number would meet:

- **Storage.** SQLite `Int` is a 64-bit integer, but it reaches JavaScript as a double. Measured
  with `better-sqlite3@12.11.1` (§13): `SUM` of `9007199254740991 + 10` comes back as
  `9007199254741000`, `Number.isSafeInteger` false. The ceiling is 2^53 cents ≈
  90 071 992 547 409,91 € — no household history approaches it, and every intermediate total in a
  month is orders of magnitude smaller — but the loss is silent, not an error.
- **Percentages.** There is no percent formatter in `format.ts`; `formatAmount` and `formatMonth`
  are all it exports. "63 % of the budget" would be the second place a stored amount meets a float,
  and the existing comment (`format.ts:10-14`) states the standard: divide at the edge, compute
  nothing from the result.

### 3. Where a monthly limit would be stored — measured against the schema as it is

`schema.prisma` holds five models — `Account`, `ImportBatch`, `Transaction`, `Category`, `Rule` —
and **no budget of any kind**. The conventions a sixth would inherit, all visible in the existing
five:

- `id String @id @default(cuid())`, `createdAt DateTime @default(now())` on every model.
- A date that is a calendar fact is **text, not `DateTime`**: `bookingDate String` with the comment
  "Never a `DateTime`: a booking date has no time and no zone" (`schema.prisma:62-63`). A budget
  month is the same kind of value.
- A uniqueness rule is a `@@unique` the database enforces, and the codebase already handles Prisma's
  `P2002` by hand in two services (`category.service.ts:13, 42-46`, `account.service.ts:13, 87-89`).
- `@@index` is added where a query shape needs it, and is documented in the schema itself
  (`:47`, `:93-96`).

Two collisions worth recording:

1. **`CategoryService.remove` counts exactly two pointers** — rules and live transactions
   (`category.service.ts:87-90`) — and refuses with `{ code: 'CATEGORY_IN_USE', rules,
transactions }` (`:96`), which the UI words in both languages
   (`i18n/rules.ts:175-189`). A budget row pointing at a category is a third pointer that count does
   not know about.
2. **There are no migrations** (§ _What the codebase forces_ 9). Adding a model means `db:push`
   plus `prisma generate`; the unit suite already rebuilds `apps/api/data/test.db` from the schema
   on every run (`test/global-setup.ts:23-34`) and the e2e run rebuilds `e2e.db`
   (`scripts/reset-e2e-db.mjs`), so both suites pick a new model up for free.

### 4. What "actual" can mean in this data — six rows that disagree

Every one of these distinctions already exists in the stored data, and each changes the number a
dashboard would print:

| Distinction   | Where it lives                                                                                                                                                             | What it does to a sum                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Sign          | `amountCents` is signed; "Negative is money out" (`transaction.ts:54`)                                                                                                     | A month's raw `SUM` mixes salary into spending                       |
| Pending       | `status` is `'booked' \| 'pending'`; pending rows are "a replaceable snapshot" (`transaction.ts:24-27`), have no `dedupKey`, and are replaced wholesale by the next import | A pending row can appear, vanish and reappear under a different date |
| Soft delete   | `deletedAt` (`schema.prisma:91`); every read filters `deletedAt: null` (`account.service.ts:117`)                                                                          | A deleted row is invisible everywhere else in the UI                 |
| Uncategorized | `categoryId` is nullable; `UNCATEGORIZED` is the UI's sentinel (`filter.ts:26`)                                                                                            | `GROUP BY categoryId` returns a `null` bucket (measured, §5)         |
| Hand-locked   | `categoryLockedAt` (`schema.prisma:82-84`)                                                                                                                                 | Irrelevant to a sum — the category is already decided either way     |
| Currency      | `currency String` per row, `'EUR'` in every fixture                                                                                                                        | Nothing in the codebase converts or checks it                        |

Concretely, from `apps/api/data/e2e.db` — the database the Playwright suite builds from
`fixtures/sparkasse-camt-18.csv` — nine live rows, one category (`Wohnen`):

```
2014-03  booked   -1 143,41  (none)   Versicherung Nord AG
2025-09  booked   +2 450,00  (none)   Beispiel AG            ← salary
2025-09  booked     -190,00  (none)   Sparkasse Musterstadt
2025-09  booked     -128,50  (none)   Hotel "Nord" GmbH
2025-09  booked   -1 150,00  (none)   Hausverwaltung Süd GmbH
2025-09  pending    -19,00   (none)   Ärzte GmbH             ← snapshot, not a ledger entry
2025-09  booked      -42,17  Wohnen   REWE SAGT DANKE; FILIALE 42
2025-09  booked      -42,17  (none)   REWE SAGT DANKE; FILIALE 42
2025-09  booked     -832,90  Wohnen   Müller GmbH
```

`SELECT categoryId, SUM(amountCents) … WHERE bookingDate >= '2025-09-01' AND < '2025-10-01' GROUP BY
categoryId` returns exactly two rows: `Wohnen → -87 507` and `null → +92 033`. The uncategorized
bucket is **positive**, because the salary is in it. A dashboard that prints that column as
"spending" prints a number no user will recognise.

Also note `research 03` §8's standing decision about counts: `uncategorizedCount` deliberately
describes the whole account, not the filtered view (`filter.ts:52-63`), "because a number that moves
while the user narrows the list cannot answer _how much is left_".

### 5. Summing per category for one month — measured

Probed against a copy of `apps/api/data/e2e.db` with `better-sqlite3@12.11.1` (SQLite **3.53.2**) —
the engine `@prisma/adapter-better-sqlite3@7.10.0` drives — and against 50 000 synthetic rows in
the same engine (§13). Real index names, real schema.

| Query shape                                                                                           | `EXPLAIN QUERY PLAN`                                                                                                                                      | 50 000 rows              |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `accountId = ? AND deletedAt IS NULL AND bookingDate >= ? AND bookingDate < ?`, `GROUP BY categoryId` | `SEARCH Transaction USING INDEX Transaction_accountId_bookingDate_idx (accountId=? AND bookingDate>? AND bookingDate<?)` + `USE TEMP B-TREE FOR GROUP BY` | **0.162 ms**             |
| same, plus `status = 'booked' AND amountCents < 0`                                                    | same index, same temp B-tree                                                                                                                              | **0.166 ms**             |
| `substr(bookingDate,1,7) = ?`, `GROUP BY categoryId`                                                  | `SEARCH Transaction USING INDEX Transaction_accountId_dedupKey_key (accountId=?)` + temp B-tree                                                           | **2.411 ms**             |
| every month at once: `GROUP BY substr(bookingDate,1,7), categoryId`                                   | `SEARCH … USING INDEX Transaction_accountId_dedupKey_key (accountId=?)` + temp B-tree                                                                     | **22.2 ms** (1 152 rows) |

The half-open range is the index-using form and the `substr()` form is a per-account scan — the same
result `research 03` §5 recorded for filtering, now confirmed for grouping. The `GROUP BY` itself
always adds a temp B-tree, because no index covers `categoryId` within an account.

Three behaviours of the result set, measured on the real database:

- **Uncategorized rows come back as a `null` key**, not as a missing bucket.
- **A month with no rows returns zero rows**, and the scalar form returns SQL `NULL` —
  `SELECT SUM(amountCents), COUNT(*) … WHERE bookingDate >= '1990-01-01' AND < '1990-02-01'` gives
  `{ s: null, n: 0 }`. A category that was budgeted and not spent is _absent_, so the zeros a
  dashboard shows have to be supplied by whatever assembles the rows, not by the query.
- `typeof total === 'number'` for every row (not `bigint`), subject to §2's 2^53 note.

### 6. Grouping by month in Prisma — what the generated client can express

The generated client does support aggregation, even though nothing uses it
(`apps/api/src/generated/prisma/models/Transaction.ts`):

```ts
// :34-37
export type TransactionSumAggregateOutputType = {
  amountCents: number | null
  lineNumber: number | null
}

// :286-298
export type TransactionGroupByArgs<…> = {
  where?: Prisma.TransactionWhereInput
  orderBy?: …
  by: Prisma.TransactionScalarFieldEnum[] | Prisma.TransactionScalarFieldEnum
  having?: …
  _count?: … ; _avg?: … ; _sum?: TransactionSumAggregateInputType ; _min?: … ; _max?: …
}
```

Two limits follow from `by: TransactionScalarFieldEnum[]`:

- **`by` takes columns, not expressions.** `substr(bookingDate, 1, 7)` is not expressible, so
  "every month, grouped" is not a single Prisma `groupBy`: it is one query per month (each of them
  the index-using range shape from §5), a `$queryRaw`, or a grouping done in JavaScript over rows
  the query returns.
- **`_sum.amountCents` is `number | null`**, matching §5's empty-set behaviour at the type level.

`StringFilter` carries `gte`/`lt` (`commonInputTypes.ts:17-29`), so the half-open month range is
expressible without raw SQL — the same fact `research 03` §5 records. `apps/api` has never called
`groupBy`, `aggregate` or `$queryRaw`; its only aggregation is `.count()` in two places
(`category.service.ts:88-89`, `rule.service.ts:197`).

### 7. Where the aggregation could run — both sides measured

The same seam `research 03` §9 left explicit, re-measured for sums rather than filters. Node
24.15.0, 50 000 payload-shaped rows, mean of twenty passes:

| Operation                                                     | Cost                                       |
| ------------------------------------------------------------- | ------------------------------------------ |
| SQL: `GROUP BY categoryId` over one month's range             | 0.162 ms (server)                          |
| JS: one month, grouped by category, over loaded rows          | **0.478 ms**                               |
| JS: the same, booked and negative rows only                   | 0.533 ms                                   |
| JS: every month × every category in one sweep (1 152 buckets) | **3.355 ms**                               |
| JSON of a month's aggregate, 12 categories                    | **1 291 bytes**                            |
| JSON of twelve months × 12 categories                         | **15 516 bytes**                           |
| JSON of one `TransactionPayload` row                          | **399 bytes** (`research 03` measured 407) |
| …×3 840 rows (≈40/month for eight years)                      | **1.46 MiB**                               |
| …×50 000 rows                                                 | 19.03 MiB                                  |

Both ends are fast enough that neither is a performance argument. What differs is what each costs
the codebase:

- **In the browser**, over `AccountPage`'s existing array: no endpoint, no query parameter, no new
  payload — the rows are already there, the pattern is `useMemo` over `transactions`
  (`AccountPage.tsx:169-179`), and the pure module to put it in has a precedent in `filter.ts`. But
  the limits themselves still have to come from somewhere, and a dashboard that is a second page
  would have to load the whole account's rows again (1.46 MiB) to show twelve numbers.
- **In the API**, as an aggregate endpoint: 1 291 bytes instead of 1.46 MiB, and the first
  `@Query` parameter in the codebase (§ _What the codebase forces_ 6), the first `groupBy`, and a
  second source of truth for numbers the browser can also compute.

Both sides need the same decisions from §4 first — sign, pending, uncategorized — and whichever side
runs it, **the arithmetic itself is what `packages/core` is for** (§11): a pure function over rows
and limits, testable without a server or a browser, which is also what makes the two sides agree if
both ever run it (the posture `match.ts:10-12` records for rules).

### 8. The month selector is already built

Everything a "selected month" needs exists and is tested:

- `monthOf(transaction)` — `bookingDate.slice(0, 7)` (`filter.ts:42-44`), a substring rather than a
  `Date` because "`new Date('2025-09-01')` is UTC midnight — which is September or August depending
  on where the browser is standing".
- `monthsOf(transactions)` — the distinct months, newest first, "A history has holes"
  (`filter.ts:47-50`).
- `formatMonth('2025-09')` → `September 2025` (`format.ts:51-60`), with `MONTH_KEY`
  (`format.ts:37`) guarding the shape because `Intl` throws `RangeError` on an invalid `Date` and
  `'2025-'` would otherwise render as `Dezember 2024`.
- The control itself: a `TextField select` with no visible label, `displayEmpty`, an `aria-label`
  from i18n, `''` meaning "Alle Monate" (`TransactionFilters.tsx:52-68`), fed by `months`
  from `AccountPage.tsx:169`. Its accessible name is `Monat` (`i18n/transactions.ts:36`), and the
  Playwright spec drives it by that name (`e2e/transactions.spec.ts:67`).

Two notes for anything reusing it. First, `''` is the sentinel for "every month" throughout
(`filter.ts:14`, `:94-96`) — a dashboard that requires exactly one month is a different state than
the list's. Second, the month list is derived from the loaded rows, so it only contains months the
account has; a budget set for a month with no transactions would not appear in it.

### 9. Over-budget highlighting — what emphasis looks like in this codebase today

There is no "alert" or "threshold" concept anywhere. The vocabulary that exists:

- **Semantic palette tokens as strings, never raw hex.** `TransactionList.tsx:125`:
  `color: transaction.amountCents < 0 ? 'text.primary' : 'success.main'` — income is green, spending
  is ordinary. Also `'primary.main' | 'text.secondary'` (`Nav.tsx:31`), `'text.disabled'`
  (`CategoryCell.tsx:45`, `:95`), `'divider'`/`'action.hover'` (`ImportPanel.tsx:75-76`). Zero
  occurrences of `styled(`, `useTheme`, `alpha(` or `palette.` in `apps/web/src`.
- **`Chip` for a count that is also a control.** `TransactionFilters.tsx:124-136`:
  `color="warning"`, label from `describeUncategorized(count)`, clicking it applies the filter;
  below zero it degrades to an inert outlined chip (`:140`), "a control that does nothing is worse
  than none".
- **`Alert severity` for outcomes** — `error` (`AccountPage.tsx:229`), `warning`/`success` chosen by
  data (`ImportPanel.tsx:127`), `info` (`:144`).
- **Numbers align.** `align="right"` plus `fontVariantNumeric: 'tabular-nums'`
  (`TransactionList.tsx:121-124`).
- **The theme sets no palette.** `theme.ts:3-13` is `colorSchemes: { light: true, dark: true }`,
  `shape.borderRadius: 10`, a system font stack — so MUI's default `error`/`warning`/`success` are
  what those tokens resolve to, and **both a light and a dark scheme are live**, which is what makes
  hand-picked colours a second decision rather than one.
- **Colour is not the only channel the codebase uses for meaning**, and where it is, there is a
  label beside it: the pending row is ⏳ with `aria-label="vorgemerkt"`
  (`TransactionList.tsx:102-104`), the locked row is 🔒 with a title
  (`CategoryCell.tsx:120`), and the uncategorized chip's `aria-label` deliberately carries both its
  count and its action (`TransactionFilters.tsx:130-132`) because "`aria-label` replaces the visible
  label in the accessible name rather than adding to it" — a correction commit `adab39b` made.
- Playwright asserts on German accessible names (`e2e/transactions.spec.ts:46-80`), so whatever an
  over-budget row is called, it is called that in `src/i18n`.

There is no `Tooltip`, `Badge`, `LinearProgress`, `Skeleton` or `ToggleButton` in use today, though
all of them ship in `@mui/material@9.4.0` and are available without a new dependency.

### 10. The chart — what is installed, and what is not

`apps/web/package.json` dependencies, in full: `@emotion/react`, `@emotion/styled`,
`@household-budget/core`, `@mui/material@^9.4.0`, `react@^19.3.0`, `react-dom`,
`react-router@^7.18.4`. That is the whole runtime surface the browser has.

| Library                                                                      | Status in this repo                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@mui/x-charts`                                                              | absent — no `@mui/x-*` package of any kind                                                                                                                                                                               |
| `recharts`, `chart.js`, `victory`, `nivo`, `apexcharts`, `echarts`, `plotly` | absent from every `package.json` and from `pnpm-lock.yaml`                                                                                                                                                               |
| `@mui/icons-material`                                                        | absent (the app uses emoji)                                                                                                                                                                                              |
| `d3-shape@3.2.0`, `d3-scale`, `@visx/*@4.0.1-alpha.0`                        | present in `pnpm-lock.yaml` **only** as transitive dependencies of `@prisma/studio-core@0.33.0`, itself a dependency of the `prisma` CLI devDependency in `apps/api`. Not declared by `apps/web`, not resolvable from it |

So one chart means either a new dependency or hand-drawn marks. What exists today for the second
option: `Box`/`Stack` with `sx`, `LinearProgress`, `Table`, and inline SVG — React 19 renders SVG
without any library, and `theme.ts`'s tokens are reachable through `sx` colour strings.

What a new dependency would touch (§ _What the codebase forces_ 10): `apps/web/package.json`,
`pnpm-lock.yaml`, possibly `pnpm-workspace.yaml`'s `minimumReleaseAgeExclude` if the version is
recent, and the jsdom-based unit suite — `vite.config.ts:25-30` runs component tests in `jsdom`,
where SVG layout APIs (`getBBox`, `getComputedTextLength`) are absent, which is what most chart
libraries measure with.

`pnpm lint:deps` does not constrain this: the root script cruises `packages/core/src` only
(`package.json:16`), and the rule it enforces forbids React _inside core_, not a chart library
inside `apps/web`.

### 11. What `packages/core` allows budget math to be

`packages/core` is described in its own `package.json` as "CSV parsing, categorization rules,
**budget math**. No framework dependencies." — the third of those is the only one with no code
behind it. There is no `src/budget/`, no month helper and no aggregation of any kind.

The constraints such a module inherits:

- **`"types": []` and `"lib": ["ES2023"]`** (`packages/core/tsconfig.json:6-7`): no Node globals, no
  DOM. `Date` and `Intl` do typecheck, but the package's stated posture is to avoid both —
  `transaction.ts:4-7`, `normalize.ts:9-11`, `rule.ts:83` ("A string, not a `Date`: core has no
  `Date` to spare").
- **Framework-free, type-only imports included** (`.dependency-cruiser.cjs:14-31`), with a
  `not-to-unresolvable` tripwire so the rule cannot become vacuous (`:32-41`). Test files are
  deliberately in scope.
- **Two entry points**: the root barrel is browser-safe and re-exports every public symbol
  (`index.ts:7-47`); `./csv` holds anything that needs Node. Budget math is root-entry material — it
  is exactly what both ends would want to agree on.
- **Both apps import the built `dist/`, never the source**, and `dev`, `test` and `typecheck` build
  core first; a stale `dist` shows up as bogus "has no exported member" errors (CLAUDE.md HOW).
- **Strictness that shapes the code**: `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
  are on for every package (`tsconfig.base.json:9-10`), so a `Map.get()` is `T | undefined` at the
  type level and an optional field is declared `?: T | undefined` and passed explicitly
  (`TransactionList.tsx:31-36`).

Two shapes in core are the obvious templates:

- **`matchRule`/`categorize` (`rules/match.ts:66-121`)** — pure decisions over a structurally-typed
  input. `MatchableTransaction` (`:22-26`) is satisfied by both core's `Transaction` (optional
  fields) and the API's `TransactionPayload` (nullable fields), "which is why nothing here imports
  either". A budget function over rows would face exactly that shape problem.
- **`parseRuleInput` (`rules/rule.ts:111-165`)** — validation that returns _every_ problem as
  `{ code, field }` codes, never sentences, so the API rejects a bad body and the browser marks the
  bad field with the same function, and `apps/web/src/i18n` supplies the wording. A budget amount
  typed into a form is the same kind of input.

### 12. Conventions a change here would be held to

- **State is plain hooks.** No Redux, no TanStack Query, no context. Loads use an `AbortController`
  in a `useRef` and abort the previous request (`AccountPage.tsx:91-121`, `RulesPage.tsx:119`);
  per-row writes carry a sequence guard (`AccountPage.tsx:136-164`).
- **A page owns the loads and the writes; components stay presentational** and take callbacks
  (`TransactionList`, `TransactionFilters`, `CategoryCell`).
- **There is no layout component.** Each page renders its own
  `<Container maxWidth="md" sx={{ py: 6 }}>` + heading + `<Nav/>` (`AccountPage.tsx:188-200`,
  `RulesPage.tsx:173-179`), so a third page duplicates that block and `Nav.tsx:14-18` gains a third
  link.
- **Strings live in `src/i18n`** as `Record<Locale, …>` with `locale: Locale = 'de'`, German by
  default and English written and tested; counts that read differently at zero are _functions_, not
  labels a page concatenates (`i18n/transactions.ts:81-95`, `i18n/rules.ts:191-209`). The
  exhaustiveness test walks every leaf in both locales (`i18n/transactions.test.ts:9-16`).
- **Tests.** Vitest everywhere; core and api in `node`, web in `jsdom` with Testing Library and
  `fireEvent` (no `user-event` installed). Page tests mock `../api/client` with hand-resolved
  promises (`AccountPage.test.tsx:25-42`) and wrap in `MemoryRouter`. API service tests run against
  a real SQLite file rebuilt by `test/global-setup.ts`, with `fileParallelism: false`. Core tests
  are pure, with a local factory per file.
- **E2E is serial, shares one database and one account**, and asserts on German accessible names;
  `apps/web/e2e/transactions.spec.ts:11-20` records why no spec asserts absolute row counts.
- **Commits**: research doc → plan doc → implementation → review-fix, each on its own branch, with a
  lowercase conventional subject describing the effect.

### 13. How the measurements were taken

Three probes, synthetic data only. `apps/api/data/budget.db` was not opened.

- **`better-sqlite3@12.11.1` from this checkout's store (SQLite 3.53.2), read-only, against a
  _copy_ of `apps/api/data/e2e.db`** — the database the Playwright suite builds from
  `fixtures/sparkasse-camt-18.csv`. Source of the query plans and result-set behaviour in §5, the
  nine-row listing in §4, and the `null`-bucket and empty-`SUM` findings.
- **The same engine, in memory, over 50 000 generated rows** with the same indexes the schema
  declares — the per-query timings in §5 (mean of twenty runs after a warm-up) and the 2^53 `SUM`
  result in §2. The rows are one account across 96 months (2018-01 … 2025-12), 12 categories, about
  one row in nine uncategorized, one in fifty pending and one in twenty positive; month, category,
  status and sign are each drawn from a seeded PRNG rather than from the loop counter, because a
  counter makes the category a function of the month and collapses the bucket count.
- **Node 24.15.0**, same rows as plain objects, for the JavaScript sweep timings and the
  `JSON.stringify` byte counts in §7 (mean of twenty passes). The per-row figure, 399 bytes, is the
  payload shape from `api.ts:49-70` filled with the fixture's own values; `research 03` §9 measured
  407 bytes for its generator, and both are quoted here rather than reconciled.

## Code references

- `packages/core/package.json:5` — "CSV parsing, categorization rules, budget math", the third with
  no code behind it.
- `packages/core/src/csv/transaction.ts:9-21` — `Cents`, `toCents`, and why no amount is a float.
- `packages/core/src/csv/transaction.ts:50` — "Booking date, 'YYYY-MM-DD'. Primary date for
  budgeting."
- `packages/core/src/csv/fields.ts:24-47` — `parseGermanAmount`; the `parseFloat(x) * 100` warning.
- `packages/core/src/api.ts:1-7` — the contract's posture: plain data, no `Date`, integer cents.
- `packages/core/src/api.ts:49-70` — `TransactionPayload`, the row shape a dashboard would sum.
- `packages/core/src/index.ts:20-27` — `Cents` and `toCents` on the browser-safe entry.
- `packages/core/src/rules/match.ts:22-26` — `MatchableTransaction`, the structural-typing precedent.
- `packages/core/src/rules/rule.ts:93-165` — result-object validation returning codes, not sentences.
- `packages/core/tsconfig.json:6-7` — `"lib": ["ES2023"]`, `"types": []`.
- `.dependency-cruiser.cjs:14-41` — the two rules `pnpm lint:deps` enforces over `packages/core/src`.
- `apps/api/prisma/schema.prisma:50-97` — `Transaction`: `bookingDate String`, `amountCents Int`,
  `categoryId`, `categoryLockedAt`, `deletedAt`, and the three indexes.
- `apps/api/prisma/schema.prisma:99-107` — `Category`, "a monthly report groups by this and by
  nothing else".
- `apps/api/src/accounts/account.service.ts:113-122` — `listTransactions`: no filter, no `select`,
  no aggregate.
- `apps/api/src/rules/category.service.ts:77-100` — the delete refusal and the two counts it makes.
- `apps/api/src/rules/rules.module.ts:8-13` — the module shape a fourth resource would mirror.
- `apps/api/src/generated/prisma/models/Transaction.ts:34-37, 286-298` — `_sum.amountCents:
number | null`, and `by` taking scalar fields only.
- `apps/api/src/test/global-setup.ts:23-34` — how the unit suite rebuilds its database from the
  schema.
- `apps/web/src/App.tsx:6-17` — two routes, and the comment naming reporting as the third.
- `apps/web/src/filter.ts:42-63` — `monthOf`, `monthsOf`, `uncategorizedCount`.
- `apps/web/src/format.ts:15-17, 34-60` — `formatAmount`, `formatMonth`, `MONTH_KEY`.
- `apps/web/src/pages/TransactionFilters.tsx:52-68` — the month `<Select>` as built.
- `apps/web/src/pages/TransactionFilters.tsx:124-141` — the warning chip, and its inert zero state.
- `apps/web/src/pages/TransactionList.tsx:120-129` — right-aligned, tabular, coloured by sign.
- `apps/web/src/pages/AccountPage.tsx:93-121, 169-179` — the load pattern and the derived values.
- `apps/web/src/theme.ts:3-13` — light and dark schemes, no palette override.
- `apps/web/src/i18n/transactions.ts:34-95` — the strings, and the count-as-a-function convention.
- `apps/web/package.json:15-23` — the seven runtime dependencies; no chart library among them.
- `apps/web/vite.config.ts:25-30` — component tests run in `jsdom`.
- `pnpm-workspace.yaml:8-35` — `allowBuilds` and `minimumReleaseAgeExclude`, what a new dependency
  may have to touch.
- `docs/research/03-transactions-list.md:233-263` — month filtering, measured (the index shapes this
  document extends to `GROUP BY`).
- `docs/research/03-transactions-list.md:339-364` — where filtering runs, both sides measured.
- `docs/research/02-categorization-rules.md` §3 — why matching is not a `WHERE` clause.

## Still open

Questions this research can state but not answer, because they are product decisions rather than
facts about the code:

1. **What counts as spending.** §4: sign, `status = 'pending'`, and the uncategorized bucket each
   change the printed number, and the e2e database shows a positive "spend" column if none of them
   is decided. Does the dashboard sum only negative booked rows, and does income get its own
   treatment or none?
2. **Whether a budget belongs to an account or to the household.** `Transaction` is scoped to an
   `Account` and `Category` is global (`schema.prisma:101-107`); a limit could be either, and the
   month selector today is built from one account's rows (§8).
3. **What a budget month is.** One row per category per month (`'2025-09'`), or one standing limit
   per category that applies until changed. The second needs no month column and no copying forward;
   the first can record that October differed.
4. **What happens to a category with a limit and no transactions in the month.** §5: the query
   returns no row for it at all.
5. **Whether the uncategorized bucket is shown on the dashboard.** It is the largest bucket in the
   fixture data, and `research 03` §8 already decided that the _account's_ uncategorized count is
   shown prominently rather than hidden.
6. **Where the aggregation runs** (§7) — the browser over rows already loaded, or a new endpoint
   with the codebase's first `@Query` parameter — and, separately, that the arithmetic lives in
   `packages/core` either way.
7. **What "over budget" looks like.** §9: the palette is MUI's default in two colour schemes, the
   repo has no threshold vocabulary, and every existing emphasis carries a label as well as a
   colour.
8. **What the one chart shows** — spend per category for the selected month, or one category over
   time — and whether it is hand-drawn SVG or the repo's first charting dependency (§10).
9. **Whether `CategoryService.remove` should count budgets too** (§3), so deleting a category with a
   limit is refused the way one with rules already is.

## Next step: the implementation plan

`docs/plans/04-monthly-budgets.md`, once the questions above are decided. The three previous rounds
each went research → plan → implementation → review fix, with the plan citing this document by
section number rather than restating its measurements.
