---
date: 2026-09-23T13:05:00Z
git_commit: adab39b15cb2252936b583dbe0606bf68438b50b
branch: docs/03-transactions-list
topic: 'Monthly budgets per category: a dashboard of actual against budget for one month, over-budget highlighting, and one spending chart'
tags: [plan, budgets, reporting, packages-core, apps-api, apps-web, prisma, charts]
status: implemented
---

# PLAN: Monthly budgets per category

The third of import → categorize → **report**. A category gets a limit for a month, the dashboard
shows what was actually spent against it, says which categories are over, and draws the month once
as a chart. `apps/web` gains its third page and `apps/api` its fourth resource; the arithmetic is a
new pure module in `packages/core`, which is the one place both ends can agree on it.

[docs/research/04-monthly-budgets.md](../research/04-monthly-budgets.md) is the authority for
everything measured here — do not re-derive it. In particular §2 (integer cents, and the two places
they meet a float), §4 (what "actual" can mean: sign, pending, the `null` bucket, and the fixture
month whose uncategorized total is **positive** because a salary sits in it), §5 and §7 (the
grouping costs on both sides, and the payload sizes), §9 (how this codebase signals emphasis) and
§10 (nothing installed can draw).

**This plan adds one model, one API resource, one core module and one web page.** It changes the
transactions list only to accept a filter handed to it by the new page, and `CategoryService.remove`
only to count a third pointer. No change to the import pipeline, the rules engine, or how
transactions are fetched.

## Acceptance Criteria

- [x] `GET /api/budgets/2025-09` returns the limits set for that month, `[]` when none are set.
- [x] `PUT /api/budgets/2025-09/<categoryId>` with `{ amountCents: 70000 }` creates the limit, and
      the same call again updates it rather than failing — one row per category per month.
- [x] `DELETE /api/budgets/2025-09/<categoryId>` clears that one limit and returns 204; the month's
      other limits are untouched.
- [x] A malformed month (`2025-13`, `2025-9`, `2025-`) is refused with `BUDGET_INVALID` and a
      `{ code, field }` per bad field, the shape `RULE_INVALID` already uses.
- [x] A negative budget, a non-integer budget, and a budget above the cap are each refused with
      their own code; `0` is accepted and means "nothing may be spent here".
- [x] Deleting a category that has budgets is refused with
      `{ code: 'CATEGORY_IN_USE', rules, transactions, budgets }`, and the German and English
      sentences both name all three counts.
- [x] `/budgets` renders a month's categories with, per row: what was booked, what is still
      vorgemerkt as its own figure, the limit, and what is left.
- [x] With `fixtures/sparkasse-camt-18.csv` imported and `müller → Wohnen` applied, September 2025
      shows `Wohnen 875,07 €` booked and `0,00 € vorgemerkt`; setting the limit to `700,00 €` marks
      the row over by `175,07 €`.
- [x] The same month shows an **Ohne Kategorie** row of `1 510,67 €` booked plus `19,00 €`
      vorgemerkt, and that row has no budget field — it cannot be budgeted.
- [x] The `+2 450,00 €` salary row changes none of those numbers.
- [x] A month total line reads `2 385,74 € von 700,00 €` for that month with only Wohnen budgeted,
      and says how far over.
- [x] Over-budget is signalled by a word as well as a colour, and reads correctly in both the light
      and the dark colour scheme.
- [x] The month selector lists only the months the account has (`März 2014` and `September 2025` for
      the fixture), newest first, and defaults to the newest.
- [x] ~~Switching account resets the selected month and reloads; a response for the account the
      user just left never lands on screen.~~ Superseded after review: `/budgets` has no account
      picker and reports every account together — see _What changed while building it_.
- [x] A month with no budgets set shows every category with a dash and an inline field; nothing is
      written until a number is entered.
- [x] The chart shows one bar per category for the selected month — booked and vorgemerkt stacked,
      the limit beside it — and is absent, rather than empty, when the month has no spending.
- [x] Clicking the **Ohne Kategorie** row opens the transactions list already filtered to that month
      and to rows without a category.
- [x] `pnpm check` is green, and `pnpm check:all` including the new Playwright spec.

## Technical Key Decisions and Tradeoffs

1. **A budget is one row per category per month, household-wide.**
   `Budget { categoryId, month 'YYYY-MM', amountCents, @@unique([categoryId, month]) }`.
   - Why: the product is "spend per category against a limit" _per month_, and a month that differed
     is a fact worth keeping. Household-wide because `Category` is already global
     (`schema.prisma:101-107`) — a per-account budget would need a per-account category to mean
     anything. `month` is text for the reason `bookingDate` is (research §2, `schema.prisma:62-63`).
   - Impact: every month starts empty (decision 2), and a category's limits accumulate one row per
     month it was set in. At twelve categories over ten years that is 1 440 rows — a table that
     never needs paging.

2. **A month with no budgets is empty until set — no copy-forward, no inheritance.**
   - Why: it is the only rule with one state on screen. Inheritance puts a number in front of the
     user that belongs to another month; copy-forward needs a button, a "did it already run" flag,
     and an answer for what happens when last month is edited afterwards.
   - Impact: each new month is typed in. If that becomes tiresome, copy-forward is additive — a
     button that writes rows, changing no read path.

3. **Actual spending is booked **and** pending, money out only, and the two are never added into one
   number.**
   - Why: research §4 — pending rows are a snapshot the next import replaces wholesale, so a total
     that silently contains them can fall without explanation; and a sum that includes income prints
     a positive "spend" (the fixture's uncategorized bucket is `+920,33 €` net). Keeping the two
     figures apart is what the transactions table already does visually with ⏳
     (`TransactionList.tsx:99-105`).
   - Impact: every per-category result carries `bookedCents` and `pendingCents`, the over/under
     comparison uses their sum, and the UI always has the settled number available on its own.

4. **The report is computed in the browser, over the rows the page loads, by a function in
   `packages/core`.**
   - Why: research §7 — 0.478 ms for a month over 50 000 rows, against 0.162 ms server-side and a
     1 291-byte payload. The saving is real but it buys the codebase's first `@Query` parameter, its
     first `groupBy`, and a second place where "what counts as spending" is decided. Decision 3 is
     the kind of rule that must exist once.
   - Impact: `/budgets` loads the account's transactions the same way `AccountPage` does — about
     1.46 MiB for an eight-year history (research §7) — on top of the budgets themselves. If that
     becomes the complaint, the core function is already the seam: an endpoint can feed it grouped
     rows without the browser changing its mind about the arithmetic.

5. **Spending is reported as a positive magnitude; budgets are positive; cents throughout.**
   - Why: `spentCents: 87507` for "875,07 € spent" is what every comparison in the feature wants
     (`spent > budget`), and the alternative — carrying `-87507` and flipping the comparison — puts a
     sign error between the data and the word "über". `Cents` stays integer end to end (research §2).
   - Impact: one documented deviation from `amountCents`'s signed convention, at the boundary where
     rows become a report. The function that crosses it is the only place `Math.abs` appears, and it
     is named for it.

6. **Budgets are addressed by path, not by query string, and set with `PUT`.**
   `GET /api/budgets/:month`, `PUT /api/budgets/:month/:categoryId`, `DELETE` the same.
   - Why: research § _What the codebase forces_ 6 — there is not one `@Query` decorator in
     `apps/api`, and a month is a natural path segment. `PUT` because the cell being set may or may
     not exist yet: `POST` then `PATCH` would make the UI ask which, and the verb is idempotent,
     which is what a spreadsheet cell wants.
   - Impact: the first `PUT` in the codebase, and one `upsert` in the service. `GET /api/budgets`
     without a month is deliberately not offered — nothing needs every month at once.

7. **Month validation and the report both live in `packages/core`, and the web's `monthOf` starts
   delegating to it.**
   - Why: `'YYYY-MM'` is currently understood in two places that cannot see each other —
     `filter.ts:42-44` and `format.ts:37`. The API now needs the same rule. Core is where a rule both
     ends run belongs (`match.ts:10-12`), and `parseRuleInput` is the precedent for validation that
     returns codes rather than sentences (`rule.ts:105-165`).
   - Impact: `packages/core` gains `isMonthKey`, `monthOfDate` and `parseBudgetInput`; `filter.ts`
     keeps its exported `monthOf` name and calls core, so no caller changes.

8. **`@mui/x-charts` at `^9.13.0`, the community package.**
   - Why: MIT, and the free tier is exactly this chart — bar series with a band axis; Pro is funnel,
     heatmap, sankey, zoom and export, none of which this needs. It peers
     `@mui/material ^7.3.0 || ^9.0.0` and `react ^19`, matching this repo's pins, and it reads the
     existing theme, so the chart follows both colour schemes without a palette being restated.
   - Impact: the first runtime dependency added since the skeleton, and it brings
     `@mui/x-charts-vendor` (a bundled d3), `@mui/x-internals`, `clsx`, `reselect` and
     `prop-types` with it. Pinned below `9.14.0` deliberately: that version was published
     2026-09-17, six days before this plan, and pnpm 12 quarantines very recent releases unless the
     exact version is listed in `pnpm-workspace.yaml`'s `minimumReleaseAgeExclude`. `9.13.0`
     (2026-09-04) needs no entry.

9. **The chart is grouped bars per category, not a reference line.**
   - Why: a reference line is one horizontal value; each category has its own limit. Booked and
     vorgemerkt stack into one "Ist" bar (decision 3 keeps them distinguishable), with "Budget"
     beside it.
   - Impact: the chart reads the same numbers the table does, from the same report object — it takes
     no data path of its own. It is given explicit `width`/`height` and `skipAnimation`, which is
     what lets it render without measuring: the same requirement MUI X documents for server-side
     rendering, and what makes it renderable in the `jsdom` unit suite.

10. **Over budget is a word and a colour, never a colour alone.**
    - Why: research §9 — every existing signal in this app carries a label (⏳ `aria-label`
      "vorgemerkt", 🔒 with a title, the count chip whose `aria-label` carries its number), the theme
      declares both a light and a dark scheme with no palette override (`theme.ts:3-13`), and
      Playwright asserts on German accessible names.
    - Impact: an over row renders `175,07 € über` in `error.main` with the word, and the Playwright
      spec can assert the word rather than a colour.

11. **`CategoryService.remove` counts budgets as a third pointer.**
    - Why: it refuses a delete while rules or transactions point at a category
      (`category.service.ts:87-96`), precisely so a decision the user made is not silently discarded.
      A limit is such a decision.
    - Impact: the `CATEGORY_IN_USE` payload gains `budgets`, and `describeCategoryInUse` gains a
      third number in both locales — one `Record<Locale, …>` entry and its test.

12. **Out of scope, deliberately.** Rollover of unspent budget into the next month; per-account
    budgets; budgets for income; more than one chart, or a chart across months; editing budgets
    anywhere but the dashboard; exporting the report; deep-linking a month through the URL (the
    uncategorized row navigates with router state, not a query parameter, so no route learns to
    parse one); any currency but EUR.

## Current State

Two pages, four resources, and no arithmetic anywhere over amounts.

```
packages/core/src/
  index.ts                 Barrel. Cents + toCents already exported          ← reuse
  api.ts                   AccountPayload, CategoryPayload, TransactionPayload ← extend
  csv/transaction.ts       Cents, toCents, bookingDate 'YYYY-MM-DD'          ← reuse
  rules/rule.ts            parseRuleInput — the validation shape to copy     ← pattern
  rules/match.ts           the "both ends run it" posture                    ← pattern
                           (no budget/ — this plan adds it)
apps/api/src/
  prisma/schema.prisma     Account, ImportBatch, Transaction, Category, Rule ← add Budget
  rules/category.service.ts  remove() counts rules + transactions            ← add budgets
  rules/rules.module.ts    the module shape to mirror                        ← pattern
  accounts/account.service.ts  listTransactions, unchanged by this plan
                           (no budgets/ — this plan adds it)
apps/web/src/
  App.tsx                  two routes                                        ← add /budgets
  pages/Nav.tsx            two links                                         ← add the third
  pages/AccountPage.tsx    the load/derive/own-the-writes pattern            ← pattern
  pages/TransactionFilters.tsx  the month <Select>, built                    ← reuse shape
  filter.ts                monthOf, monthsOf, UNCATEGORIZED                  ← reuse
  format.ts                formatAmount, formatMonth                         ← reuse
  i18n/transactions.ts     Monat, Alle Monate, Ohne Kategorie                ← reuse keys
  api/client.ts            13 calls, none about budgets                      ← extend
  theme.ts                 light + dark, no palette override
```

What this plan must not trip over:

- **A month is a string, and only `'YYYY-MM'` is one.** `format.ts:37-50` records what `'2025-'`
  does if the shape is checked after parsing instead of before: it renders as `Dezember 2024`.
- **`new Date('2025-09-01')` is UTC midnight** and belongs to August west of Greenwich
  (`filter.ts:38-41`, `format.ts:20-25`). Nothing here constructs a `Date` from a string.
- **`GROUP BY`/sum semantics do not supply zeros.** Research §5: a category with a limit and no
  spending produces no row at all. The report builds its rows from the _category list_, not from the
  transactions.
- **The uncategorized bucket is `null`, not a category** (`filter.ts:26`, research §4). It has a row
  and never a budget field.
- **Pending rows cannot be categorized by hand** (`account.service.ts:146-148`) but a rule may
  categorize them, so a pending figure can appear under a real category.
- **`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on** (`tsconfig.base.json:9-10`):
  a `Map.get` is `T | undefined`, and an absent prop is passed as `undefined` explicitly
  (`TransactionList.tsx:31-36`).
- **`packages/core` may not import React, NestJS or Prisma**, type-only included, and has
  `"types": []` (`.dependency-cruiser.cjs:14-31`). The report module holds no `Date`, no `Intl`.
- **Both apps consume core's built `dist/`.** A new export is invisible until `pnpm core:build`, and
  `dev`/`test`/`typecheck` already run it first.
- **The e2e database is shared and the specs are serial** (`playwright.config.ts`,
  `e2e/transactions.spec.ts:11-20`). A budgets spec must create what it needs and assert on values it
  set, not on absolute row counts.

## Desired End State

```
apps/web/BudgetsPage                     apps/api                    SQLite
─────────────────────────────────────────────────────────────────────────────────────
  listAccounts() ───────────────────► GET  /api/accounts
  listCategories() ─────────────────► GET  /api/categories
  listTransactions(accountId) ──────► GET  /api/accounts/:id/transactions   [index]
  listBudgets(month) ───────────────► GET  /api/budgets/:month              [unique]
        │
        ├─ monthsOf(rows)                        ← filter.ts, already built
        └─ monthlyReport(rows, budgets, month)   ← packages/core/src/budget/report.ts
                 │
                 ├─► BudgetTable    per category: gebucht · vorgemerkt · Budget · Rest
                 │        └─ inline field ── setBudget(month, categoryId, cents)
                 │                              └─► PUT    /api/budgets/:month/:categoryId
                 │        └─ clear ─────────── clearBudget(month, categoryId)
                 │                              └─► DELETE /api/budgets/:month/:categoryId
                 └─► SpendingChart  @mui/x-charts BarChart, same report object
```

New files:

```
packages/core/src/budget/month.ts          isMonthKey, monthOfDate, MonthKey
packages/core/src/budget/month.test.ts
packages/core/src/budget/budget.ts         Budget, BudgetInput, parseBudgetInput, MAX_BUDGET_CENTS
packages/core/src/budget/budget.test.ts
packages/core/src/budget/report.ts         monthlyReport, CategoryReport, MonthlyReport
packages/core/src/budget/report.test.ts
apps/api/src/budgets/budget.controller.ts
apps/api/src/budgets/budget.service.ts
apps/api/src/budgets/budget.service.test.ts
apps/api/src/budgets/budgets.module.ts
apps/web/src/pages/BudgetsPage.tsx         + BudgetsPage.test.tsx
apps/web/src/pages/BudgetTable.tsx         + BudgetTable.test.tsx
apps/web/src/pages/BudgetField.tsx         + BudgetField.test.tsx
apps/web/src/pages/SpendingChart.tsx       + SpendingChart.test.tsx
apps/web/src/pages/AccountSelect.tsx
apps/web/src/i18n/budgets.ts               + budgets.test.ts
apps/web/e2e/budgets.spec.ts
```

Changed files:

```
packages/core/src/index.ts                 export the budget module
packages/core/src/api.ts                   BudgetPayload
apps/api/prisma/schema.prisma              model Budget
apps/api/src/app.module.ts                 BudgetsModule
apps/api/src/rules/category.service.ts     remove() counts budgets
apps/api/src/rules/category.service.test.ts
apps/web/src/App.tsx                       route /budgets
apps/web/src/pages/Nav.tsx                 third link
apps/web/src/pages/AccountPage.tsx         use AccountSelect; accept a filter from router state
apps/web/src/filter.ts                     monthOf delegates to core
apps/web/src/api/client.ts                 listBudgets, setBudget, clearBudget
apps/web/src/i18n/rules.ts                 describeCategoryInUse gains budgets
apps/web/package.json                      @mui/x-charts ^9.13.0
```

### UI

```
┌ Household Budget    Umsätze  Regeln  Budgets            [ Konto: Giro · DE89… ▾ ] ┐
│                                                                                    │
│  [ September 2025 ▾ ]                            2 385,74 € von 700,00 € · 1 685,74 € über │
│                                                                                    │
│  ┌──────────────────────────────────────────────────────────────────────────────┐ │
│  │ Kategorie        Gebucht     Vorgemerkt    Budget          Rest              │ │
│  ├──────────────────────────────────────────────────────────────────────────────┤ │
│  │ Wohnen           875,07 €          —       [ 700,00 ]      175,07 € über  ⚠  │ │
│  │ Lebensmittel       0,00 €          —       [ 400,00 ]      400,00 € übrig    │ │
│  │ Ohne Kategorie  1 510,67 €    19,00 € ⏳        —              —             │ │
│  └──────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                    │
│  ┌ Ausgaben nach Kategorie ─────────────────────────────────────────────────────┐ │
│  │  875 ┤ ██▓                                                                    │ │
│  │      │ ██▓ ░░░                                                                │ │
│  │    0 ┼─██▓─░░░──────────────────────────                                      │ │
│  │        Wohnen  Lebensm.  Ohne Kat.        ██ gebucht ▓ vorgemerkt ░ Budget    │ │
│  └──────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────┘
```

A month nobody has budgeted yet:

```
│  [ März 2014 ▾ ]                                     1 143,41 € von — · kein Budget gesetzt │
│  Kategorie        Gebucht    Vorgemerkt   Budget            Rest                            │
│  Wohnen             0,00 €        —       [ Budget setzen ]   —                             │
│  Ohne Kategorie  1 143,41 €       —            —              —                             │
│  (no chart: nothing budgeted and nothing to compare)                                        │
```

No account yet, or an account with no transactions:

```
│  Noch keine Umsätze. Importieren Sie einen CSV-Export.   [ Zu den Umsätzen ]                │
```

## Abstractions and Code Reuse

- **`Cents` / `toCents`** (`packages/core/src/csv/transaction.ts:13-21`) — the report's amounts are
  produced through `toCents`, so a non-integer cannot reach a total.
- **`monthOf` / `monthsOf`** (`filter.ts:42-50`) — the month selector's options and the row→month
  mapping already exist and are tested; `monthOf` starts calling core's `monthOfDate`.
- **`formatMonth` / `formatAmount`** (`format.ts:15, 51`) — no new formatter; the report hands the
  UI cents and the UI formats them, the posture `api.ts:1-7` states.
- **`parseRuleInput`'s result shape** (`rules/rule.ts:93-165`) — `parseBudgetInput` returns
  `{ ok: true, budget } | { ok: false, errors: [{ code, field }] }`, so the API rejects a body and
  the browser marks the field with one function.
- **`describeRuleErrors`** (`i18n/rules.ts:164-173`) — the same "codes in, marked fields out" mapping
  for budget errors.
- **`CategoryService.requireCategory`** (`category.service.ts:103-109`) — a budget for a category
  that does not exist is a 404 from the existing guard, not a new check.
- **`AccountPage`'s in-flight `AbortController`** (`AccountPage.tsx:91-121`) — copied wholesale, for
  the reason it exists there: switching accounts twice must not land the first account's rows.
- **`TransactionFilters`' month `<Select>`** (`TransactionFilters.tsx:52-68`) — same `TextField
select` + `slotProps` + `displayEmpty` shape, minus the `''` option: the dashboard is always
  showing exactly one month.
- **`i18n/transactions.ts` keys** — `month`, `uncategorized`, `noTransactions` are reused;
  `i18n/budgets.ts` holds only what is new.
- **`AccountSelect`** — extracted from `AccountPage.tsx:202-225` unchanged in behaviour, so two pages
  cannot drift on how an account is chosen.

## Logging & Observability

Nothing new to log. The API's only writes here are single-row upserts whose outcome is the response;
the one refusal worth explaining, `CATEGORY_IN_USE`, already logs its counts
(`category.service.ts:93-95`) and gains the third. No user data — a category name, an amount — goes
to a log, the rule `rule.service.ts:369-372` states.

## Implementation

### Phase 1: The budget math in `packages/core`

`Dependencies: none.` Pure functions and their tests, no app touched. This is the phase that fixes
what "actual" means, so every later phase inherits one answer.

**Tasks**

- [x] `src/budget/month.ts` — `type MonthKey = string & { readonly __brand: 'MonthKey' }`,
      `isMonthKey(value: unknown): value is MonthKey` using the `/^\d{4}-(0[1-9]|1[0-2])$/u` shape
      `format.ts:37` already proved is needed, and `monthOfDate(isoDate: string): string` returning
      `isoDate.slice(0, 7)`. No `Date` is constructed.
- [x] `src/budget/budget.ts` — `Budget { categoryId, month, amountCents }`, `BudgetInput`,
      `MAX_BUDGET_CENTS` (100_000_000 — one million euro, "a limit no household types by accident"),
      and `parseBudgetInput(body: unknown): ParseBudgetInputResult` reporting **every** problem:
      `MONTH_INVALID`, `CATEGORY_REQUIRED`, `AMOUNT_NOT_AN_INTEGER`, `AMOUNT_NEGATIVE`,
      `AMOUNT_TOO_LARGE`. `0` is valid.
- [x] `src/budget/report.ts` — the one function both the table and the chart read:

      ```ts
      export interface CategoryReport {
        readonly categoryId: string | null;   // null is the uncategorized bucket
        /** Money out, booked, as a positive magnitude. See the module comment. */
        readonly bookedCents: number;
        /** Money out on rows still vorgemerkt. Never added into bookedCents. */
        readonly pendingCents: number;
        /** The limit for this month, or null when none is set (and always null when categoryId is). */
        readonly budgetCents: number | null;
        /** budgetCents - (booked + pending). Negative means over. null when unbudgeted. */
        readonly remainingCents: number | null;
        readonly isOver: boolean;
        readonly transactionCount: number;
      }

      export interface MonthlyReport {
        readonly month: string;
        readonly categories: readonly CategoryReport[];   // category order, uncategorized last
        readonly totalBookedCents: number;
        readonly totalPendingCents: number;
        /** Sum of the limits actually set, or null when the month has none. */
        readonly totalBudgetCents: number | null;
      }

      export function monthlyReport(
        rows: readonly MonthlyReportRow[],      // structurally satisfied by TransactionPayload
        budgets: readonly Budget[],
        categories: readonly { readonly id: string }[],
        month: string,
      ): MonthlyReport;
      ```

- [x] Rows are selected by `monthOfDate(row.bookingDate) === month` **and** `row.amountCents < 0`;
      `status === 'pending'` routes the magnitude to `pendingCents`, everything else to
      `bookedCents`. `Math.abs` appears once, in this function, with the comment explaining why the
      report leaves the signed convention behind (decision 5).
- [x] Every category gets a row whether or not it was spent in — the rows come from `categories`,
      not from the transactions (Current State, third hazard). The `null` bucket is appended only
      when it has something in it.
- [x] `src/index.ts` exports the three modules' public names; nothing from `budget/` imports
      anything outside `packages/core/src`.
- [x] `src/api.ts` — `BudgetPayload { categoryId, month, amountCents }`, the contract both ends read.
- [x] Tests, one file per module, in the repo's style (a local factory, `describe('<fn>')`):
      the fixture month end to end (`Wohnen 875,07 €` booked, `0` pending; `null` bucket
      `1 510,67 €` booked and `19,00 €` pending; the `+2 450,00 €` salary ignored); a budgeted
      category with no spending (`0` spent, full `remainingCents`); `isOver` exactly at the limit
      (not over) and one cent past it (over); `budgetCents: 0` with any spending is over; a month
      with no rows; `'2025-13'`, `'2025-9'`, `'2025-'` and `'x-y'` all rejected by `isMonthKey`;
      `parseBudgetInput` reporting two bad fields at once.

**Automated Verification**

- [x] `pnpm --filter @household-budget/core test` green.
- [x] `pnpm lint:deps` green — `budget/` imports nothing framework-shaped.
- [x] `pnpm typecheck` green with `packages/core` rebuilt.
- [x] `pnpm check` green.

### Phase 2: The API resource

`Dependencies: Phase 1` (for `parseBudgetInput` and `BudgetPayload`).

**Tasks**

- [x] `prisma/schema.prisma` — add, with the doc comments the file's other models carry:

      ```prisma
      /// A limit for one category in one month. Household-wide: Category is global, so a
      /// per-account limit would need a per-account category to mean anything.
      model Budget {
        id          String   @id @default(cuid())
        categoryId  String
        category    Category @relation(fields: [categoryId], references: [id])
        /// 'YYYY-MM'. Text for the reason bookingDate is text: a month has no time and no zone.
        month       String
        /// Positive integer cents. 0 is a real limit and means "nothing may be spent here".
        amountCents Int
        createdAt   DateTime @default(now())
        updatedAt   DateTime @updatedAt

        @@unique([categoryId, month])
        @@index([month])
      }
      ```
      plus `budgets Budget[]` on `Category`.

- [x] `pnpm --filter @household-budget/api db:push` and `prisma generate`; the unit and e2e suites
      rebuild their own databases from the schema already.
- [x] `budgets/budget.service.ts` — `list(month)`, `set(month, categoryId, body)` (validate through
      `parseBudgetInput`, `requireCategory`, then `upsert` on the `[categoryId, month]` unique),
      `remove(month, categoryId)` (idempotent: clearing a limit that is not set is a 204, the posture
      `softDeleteTransaction` takes at `account.service.ts:178-180`). Invalid input throws
      `BadRequestException({ code: 'BUDGET_INVALID', errors })`, mirroring `RULE_INVALID`.
- [x] `budgets/budget.controller.ts` — `@Controller('budgets')`, thin, one method per route, a
      `/** METHOD /api/path */` comment on each, `@HttpCode(204)` on the delete.
- [x] `budgets/budgets.module.ts` importing `RulesModule` for `CategoryService`; register in
      `app.module.ts`.
- [x] `rules/category.service.ts` — `remove()` counts budgets alongside rules and transactions and
      includes `budgets` in the `CATEGORY_IN_USE` payload and its log line.
- [x] `budget.service.test.ts` against the real SQLite test database, in the existing harness shape
      (module-level `beforeEach` compile, truncate in FK order — `budget` now comes before
      `category`): set then re-set the same cell (one row, new amount); set for two months
      independently; delete one; delete a cell that was never set; a month that is not `'YYYY-MM'`;
      a `categoryId` that does not exist (404); `amountCents: -1`, `1.5`, `MAX + 1`; `0` accepted.
- [x] `category.service.test.ts` — deleting a category with a budget is refused and the payload
      carries `budgets: 1`.

**Automated Verification**

- [x] `pnpm --filter @household-budget/api test` green.
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm lint:deps` green.
- [x] `curl` (or the e2e spec in Phase 3) shows the three routes behaving: `GET` empty → `PUT` →
      `GET` one → `PUT` again → still one, new amount → `DELETE` → `GET` empty.

### Phase 3: The dashboard, without the chart

`Dependencies: Phases 1 and 2.` A vertical slice that is useful on its own: the numbers, the
editing, the highlighting and the month total, with no new dependency yet.

**Tasks**

- [x] `api/client.ts` — `listBudgets(month, signal?)`, `setBudget(month, categoryId, amountCents)`,
      `clearBudget(month, categoryId)`, each `encodeURIComponent`-ing its segments, `clearBudget`
      through the existing `remove()` helper because 204 has no body (`client.ts:141-147`).
- [x] `pages/AccountSelect.tsx` — lifted from `AccountPage.tsx:202-225`, same label, same
      `MenuItem` content, `onChange` as a prop. `AccountPage` uses it and keeps its own reset
      behaviour.
- [x] `i18n/budgets.ts` — `Record<Locale, BudgetsText>` with `navBudgets`, `title`, the four column
      headers, `setBudget`, `clearBudget`, `over`, `left`, `noBudget`, `noBudgets`, `pendingHint`,
      plus `describeMonthTotal(report, locale)` and `describeOverBy(cents, locale)` as functions —
      not labels a page concatenates, the rule `i18n/rules.ts:200-206` records.
- [x] `pages/BudgetField.tsx` — the inline editor for one cell: a `TextField size="small"` holding a
      **string** while typed (the `RuleDraft` precedent, `RulesPage.tsx:60-68`), parsed to cents on
      blur or Enter, `error` + `helperText` from the core error code, "Budget setzen" as the empty
      state, and a clear affordance for a set one. Disabled while its own write is in flight.
- [x] `pages/BudgetTable.tsx` — presentational. One row per `CategoryReport`: name, booked,
      vorgemerkt (the ⏳ marker and `aria-label` "vorgemerkt" reused from
      `TransactionList.tsx:99-105`, a dash when zero), the field, and the remainder. Amounts
      `align="right"` with `fontVariantNumeric: 'tabular-nums'`. An over row renders the amount and
      the word (`175,07 € über`) in `error.main`, and carries the same wording in its row
      `aria-label` so a screen reader gets the state without the colour. The uncategorized row has no
      field and a button that navigates to the list.
- [x] `pages/BudgetsPage.tsx` — owns the loads (accounts, categories, transactions, budgets), the
      selected month, and the writes. One `AbortController` in a `useRef` per load, aborting the
      previous (`AccountPage.tsx:91-121`); a per-cell sequence guard for writes, the shape
      `changeCategory` uses (`AccountPage.tsx:136-164`); `useMemo` for `monthsOf(transactions)` and
      for `monthlyReport(...)`. Month defaults to `months[0]` and resets when the account changes.
      A write replaces the one budget in state rather than reloading the month.
- [x] `App.tsx` route `/budgets`; `Nav.tsx` third link from `i18n/budgets.ts`.
- [x] `AccountPage.tsx` — read `useLocation().state` once on mount: `{ month, categoryId }` seeds
      `filters` so the uncategorized row's button lands on exactly those rows. Router state, not a
      query parameter (decision 12).
- [x] `filter.ts` — `monthOf` delegates to core's `monthOfDate`; its exported name and tests stay.
- [x] Unit tests: `BudgetsPage.test.tsx` with `vi.mock('../api/client')` and hand-resolved promises
      (`AccountPage.test.tsx:25-42`), wrapped in `MemoryRouter`; a month switch re-derives the table
      without refetching transactions; a failed write surfaces in the one `Alert` and leaves the
      previous number on screen. `BudgetTable.test.tsx` for the over/under/unbudgeted rows and the
      uncategorized row having no field. `BudgetField.test.tsx` for `700` → `70000` cents, a comma
      decimal, an empty field clearing, and a rejected value keeping focus. `budgets.test.ts` walks
      every string in both locales, the shape `i18n/transactions.test.ts:9-16` uses.
- [x] `e2e/budgets.spec.ts`, serial and self-seeding like the others: import the fixture if the
      account has nothing, create `Wohnen` and the `müller` rule if absent, apply, open `/budgets`,
      pick `September 2025`, assert `875,07 €` on the Wohnen row, type `700`, assert
      `175,07 € über`, assert the Ohne-Kategorie row reads `1 510,67 €` and has no field, click it
      and assert the transactions list shows only uncategorized September rows.

**Automated Verification**

- [x] `pnpm --filter @household-budget/web test` green.
- [x] `pnpm check` green.
- [x] `pnpm check:all` green, including the new spec.
- [x] `pnpm typecheck` green for all three tsconfigs in `apps/web` (`tsconfig`, `node`, `e2e`).

**Manual Verification**

- [x] `pnpm dev`, import `fixtures/sparkasse-camt-18.csv`, set a budget, and confirm the numbers
      match what the transactions list shows for the same month and category.
- [x] Switch the OS colour scheme to dark and confirm the over row is legible and still says "über".

### Phase 4: The chart

`Dependencies: Phase 3.` One component reading the report object Phase 3 already computes.

**Tasks**

- [x] `pnpm --filter @household-budget/web add @mui/x-charts@^9.13.0`. If pnpm quarantines the
      resolved version, add that exact version to `pnpm-workspace.yaml`'s
      `minimumReleaseAgeExclude` with a comment saying why, the way the existing entries are
      annotated.
- [x] `pages/SpendingChart.tsx` — `BarChart` from `@mui/x-charts/BarChart`, one band axis of
      category names, three series: `Gebucht` and `Vorgemerkt` stacked (`stack: 'ist'`) and `Budget`
      beside them. Explicit `height` and `width` and `skipAnimation` (decision 9). Amounts are cents
      in the data and `valueFormatter` is `formatAmount`, so the axis and tooltip read `875,07 €`.
      Colours come from the theme's semantic tokens; nothing is a hex literal.
- [x] The chart renders only when the month has something to show — no bars for a month with no
      spending and no budgets, matching the second UI sketch.
- [x] `BudgetsPage` renders it under the table from the same `MonthlyReport`; no second data path.
- [x] `SpendingChart.test.tsx` — renders in `jsdom` with explicit dimensions and `skipAnimation`;
      asserts the series values it was given, and that a month with nothing renders nothing.
- [x] `e2e/budgets.spec.ts` gains one assertion that the chart is present for September 2025.

**Automated Verification**

- [x] `pnpm --filter @household-budget/web test` green — in particular the chart test, which is the
      one that proves the explicit-size + `skipAnimation` route works under `jsdom`.
- [x] `pnpm check:all` green.
- [x] `pnpm build` green — `vite build` bundles the new dependency.
- [x] `pnpm lint:deps` still green (it cruises `packages/core/src`; the new dependency is in
      `apps/web` and core gains nothing).

**Manual Verification**

- [x] The chart's bars agree with the table's numbers for the same month, in both colour schemes.
- [x] A month with one budgeted category and one unbudgeted one reads correctly — the unbudgeted
      category shows its spending with no Budget bar beside it.

## What changed while building it

- **Budgets are measured against every account, and `/budgets` has no account picker.** Review
  caught that decision 1 made a limit household-wide while the page compared it with one account's
  spending: 400 € on each of two cards against a 700 € limit read "übrig" on both while the
  household was 100 € over, and the same limit flipped between over and under as the account
  changed. The page now loads every account's rows, the month list is their union, and the
  uncategorized row opens the list on the first account holding that month's uncategorized
  spending. `AccountSelect` stays, used by `AccountPage` alone.
- **Write state is per cell, not per category.** The in-flight flag and the "refused, remount"
  counter are keyed by month and category, so a slow September write no longer disables the
  category's August field, and one refused write no longer discards what is being typed in
  another cell.
- **`875,07 €` needs more than the rule.** `müller → Wohnen` alone puts `832,90 €` in Wohnen. The
  research §4 database also had one of the two REWE rows set to Wohnen by hand (that is what
  `rules.spec.ts` does), and `875,07 €` / `1.510,67 €` are that state. The Playwright spec seeds
  both, conditionally, so it converges on the same database whichever spec ran first.
- **The spec is `e2e/monthly-budgets.spec.ts`, not `budgets.spec.ts`.** One worker runs files in
  name order, and `import.spec.ts` asserts it is the first to create the account and see
  `8 importiert`. `budgets` sorts before `import`; `monthly-budgets` sorts after it.
- **Amounts render as `2.385,74 €`.** `de-DE` groups with a dot and puts U+00A0 before the `€`; the
  `2 385,74 €` spellings above are notation. Tests assert the real output.
- **The month total is booked against budgeted.** The acceptance numbers (`2.385,74 € von
700,00 € · 1.685,74 € über`) exclude the `19,00 €` vorgemerkt, so the headline does too and names
  pending money after it. Per-row `isOver` still counts booked + pending (decision 3).
- **Router state carries the account.** `{ accountId, month, categoryId }`, parsed by
  `listEntryOf` in `filter.ts`: without it the list opens on the first account, which is not the
  bucket that was counted when a second account is selected.
- **`describeCategoryInUse` takes `{ rules, transactions, budgets }`.** Three adjacent `number`
  parameters are a transposition the compiler cannot see.
- **`@mui/x-charts` resolved `9.14.0` without quarantine.** The lockfile was pinned back to `9.13.0`
  as decided above (spec `^9.13.0`); its `@mui/x-internals` dependency resolves `9.14.0` and passes
  the supply-chain policy, so `minimumReleaseAgeExclude` is unchanged.
- **`vite build` now warns the bundle is 870 kB (> 500 kB).** Most of it is the chart's bundled d3.
  A `lazy()` import of `BudgetsPage` would split it; not done here.
- `BudgetsPage` aborts its loads through effect cleanup rather than a `useRef` controller —
  `AccountPage` needs the ref because an import re-triggers its load; nothing here does.
- `BudgetField` parses with core's `parseGermanAmount`, so `1.234,56` and `12,3` mean what they
  mean on a statement, and refuses `700.50` rather than guessing which separator was meant.

- **The manual checks were run in a browser through Playwright**, against a throwaway database
  seeded to the research §4 state: numbers against the list, the over row in both colour schemes,
  the chart's tooltip against the table, and a budgeted category beside an unbudgeted one. Two
  dev-only reselect warnings from inside `@mui/x-charts` appear when the tooltip opens; they are
  the library's and are absent from a production build.

## References

- [docs/research/04-monthly-budgets.md](../research/04-monthly-budgets.md) — §2 integer cents, §4
  what "actual" can mean, §5 and §7 the measured costs, §9 how this app signals emphasis, §10 what is
  installed.
- [docs/research/03-transactions-list.md](../research/03-transactions-list.md) §5, §9 — the month
  range measurements and the payload size this page inherits.
- [docs/plans/03-transactions-list.md](03-transactions-list.md) — the phase and verification shape
  this plan follows.
- `packages/core/src/csv/transaction.ts:9-21` — `Cents`, `toCents`.
- `packages/core/src/rules/rule.ts:93-165` — the validation shape `parseBudgetInput` copies.
- `packages/core/src/api.ts:1-7` — the contract's posture: plain data, cents, no formatting.
- `apps/api/src/rules/category.service.ts:77-109` — the delete refusal that gains a third count, and
  `requireCategory`.
- `apps/api/src/rules/rules.module.ts:8-13` — the module shape `BudgetsModule` mirrors.
- `apps/api/src/test/global-setup.ts:23-34` — why a new model needs no migration for the suites.
- `apps/web/src/pages/AccountPage.tsx:91-179` — the load, guard and derive pattern `BudgetsPage`
  copies.
- `apps/web/src/pages/TransactionFilters.tsx:52-68` — the month `<Select>` shape.
- `apps/web/src/pages/TransactionList.tsx:99-129` — ⏳ with an `aria-label`, and the numeric column
  treatment.
- `apps/web/src/i18n/rules.ts:164-209` — errors as marked fields, and counts as functions.
- `pnpm-workspace.yaml:17-35` — `minimumReleaseAgeExclude`, and how its entries are annotated.
- `CLAUDE.md` — the rules this plan is held to, and `pnpm check` as the gate.
