---
date: 2026-09-23T10:35:50Z
git_commit: 1fbea9b1837974f819879c0ad95e57e12cf56243
branch: feat/categorization-rules
topic: 'Transactions list: month, category and text filters, inline category override, uncategorized count'
tags: [research, transactions, filtering, search, apps-web, apps-api, packages-core, prisma, sqlite]
status: complete
---

# Research: The transactions list

## Research question

The transactions list in `apps/web` should filter by month, by category and by free text, let a
category be changed inline as a manual override, and show the uncategorized count prominently.
What exists today, and what does the codebase force on each of those four?

## Summary

**One of the four is already built.** The inline override shipped with the rules engine
(`c9961e0`, then `fba54a2`, `19e7c81`, `d56271f`, `1fbea9b`): `CategoryCell.tsx` is a select on
every booked row, `PATCH /api/transactions/:id` writes `categoryId` and `categoryLockedAt`, the
lock is rendered as 🔒, and the behaviour is covered by unit tests, service tests and a Playwright
spec. What is missing is everything that helps a user _find_ the row to override — there is no
filter, no search box, no month selector and no count anywhere in the app.

**The three that are missing split along the seam this repo already found once.** A month filter
and a category filter are ordinary SQL: `bookingDate` is a sortable `'YYYY-MM-DD'` string with
`@@index([accountId, bookingDate])`, and `categoryId` is an indexed foreign key. **A text search
is not**, for exactly the reason `docs/research/02-categorization-rules.md` §3 gives for rule
matching: measured on this checkout, SQLite `LIKE '%müller%'` does not match `MÜLLER GmbH`, and
the generated Prisma `StringFilter` has no `mode`. The normalizer that solves it —
`normalize()` — is already exported from the browser-safe root entry of `packages/core` and
already bundled by `apps/web`.

**Nothing in the API takes a query parameter.** There is not one `@Query` decorator in
`apps/api/src`. `GET /api/accounts/:id/transactions` takes a path param, hardcodes
`where: { accountId, deletedAt: null }`, has no `select`, no `take`, no `skip` and no count in
its response. `AccountPage` loads every row of the selected account into one `useState` array and
`TransactionList` renders every one of them — so today the browser already holds the full data a
client-side filter would need, and the payload is the cost.

Key files:

```
apps/web/src/
  pages/AccountPage.tsx        Owns accounts, transactions, categories, the category write.
  pages/TransactionList.tsx    Presentational table. Renders every row it is given.
  pages/CategoryCell.tsx       The inline override — select + 🔒, read-only when pending.
  pages/ImportPanel.tsx        The repo's one precedent for a prominent count line.
  pages/RulesPage.tsx          The repo's one precedent for a page with controls above a table.
  api/client.ts                Every call; none passes a query string.
  i18n/rules.ts                Record<Locale, …> UI strings — already has `uncategorized`.
  format.ts                    formatAmount, formatBookingDate. No month formatter yet.
apps/api/src/
  accounts/account.controller.ts  GET :id/transactions, PATCH /transactions/:id.
  accounts/account.service.ts     listTransactions (no filters), setTransactionCategory.
  rules/category.service.ts       The only transaction count()s in the codebase.
  prisma/schema.prisma            Transaction: bookingDate TEXT, categoryId, categoryLockedAt.
packages/core/src/
  api.ts                       TransactionPayload — the contract both ends agree on.
  rules/normalize.ts           normalize() — the one definition of "the same text".
```

What a row's life looks like today, end to end:

```
apps/web                                  apps/api                       SQLite
────────────────────────────────────────────────────────────────────────────────────────
AccountPage
  useEffect ─ listTransactions(id) ──► GET /api/accounts/:id/transactions
              (AbortController)          AccountService.listTransactions
                                           where { accountId, deletedAt: null }   [index]
                                           orderBy bookingDate desc, lineNumber asc
              ◄── TransactionPayload[] ─── every live row, every column read
  useState transactions[]   ← the whole account history, unfiltered, unpaged
    │
    └─► TransactionList  renders every row
          └─► CategoryCell (booked rows only)
                onChange ─ setTransactionCategory ──► PATCH /api/transactions/:id
                                                        categoryId + categoryLockedAt = now()
                ◄── TransactionPayload ──────────────── the one row, replaced in place
```

## What the codebase forces

1. **A text search cannot be a `WHERE` clause.** Re-measured for this feature on both engines that
   see this data — the `sqlite3` CLI (3.51.0) and the SQLite the API actually runs on,
   `better-sqlite3@12.11.1` behind `@prisma/adapter-better-sqlite3@7.10.0`, which reports
   **3.53.2** and answers identically: `'REWE SAGT DANKE' LIKE '%rewe%'` is 1, but
   `'MÜLLER GmbH' LIKE '%müller%'` is 0, `lower('MÜLLER GmbH')` is `'mÜller gmbh'`, and a needle
   spelled NFD misses an NFC haystack. The generated client's `StringFilter`
   (`apps/api/src/generated/prisma/commonInputTypes.ts:17-29`) offers `contains`/`startsWith`/
   `endsWith` and no `mode`. §6 below has the full table. This is the same wall §3 of
   `docs/research/02-categorization-rules.md` hit, and `normalize()` is the same way through.
2. **A month filter must be a range, not a prefix.** `bookingDate` is `String` `'YYYY-MM-DD'`
   (`schema.prisma:62`). Measured: `bookingDate >= '2025-09-01' AND bookingDate < '2025-10-01'`
   uses `Transaction_accountId_bookingDate_idx`; `LIKE '2025-09%'` and `substr(bookingDate,1,7)`
   both fall back to a scan under the `accountId` index. §5 has the query plans.
3. **Nothing counts transactions for display.** The only `count()` calls over `Transaction` are
   `category.service.ts:88-89` (internal to the delete refusal) and `rule.service.ts:175`
   (`ApplySummary.locked`). There is no index on `(accountId, categoryId)` — `@@index([categoryId])`
   exists but is not account-scoped — so a per-account uncategorized count in SQL is an
   `accountId`-index scan today.
4. **"Uncategorized" is `categoryId === null` and nothing else.** No sentinel category exists, and
   the word is already written in both languages: `rulesText().uncategorized` is `'Ohne Kategorie'`
   / `'Uncategorized'` (`i18n/rules.ts:74`, `:114`). §4 lists the five ways a row gets there.
5. **Pending rows can be uncategorized and cannot be fixed by hand.** `setTransactionCategory`
   throws `{ code: 'TRANSACTION_PENDING' }` 409 (`account.service.ts:146-148`) and `CategoryCell`
   renders read-only text for them (`CategoryCell.tsx:36-52`). A count of "rows needing a decision"
   and a count of "rows with no category" are therefore not the same number.
6. **There is no query-parameter convention to follow, in either app.** Zero `@Query` decorators in
   `apps/api/src`; zero reads of `useSearchParams`/`location.search` in `apps/web/src`. Filter
   state, wherever it goes, is the first of its kind here.
7. **Every row is already in the browser.** `listTransactions` returns the full account history
   and `AccountPage` holds it in state, so a client-side filter needs no new endpoint — but the
   payload grows with the history, and §9 measures both sides of that.

## Detailed findings

### 1. What the transactions list is today

`AccountPage.tsx` is the whole state owner. It holds four pieces of state — `accounts`,
`accountId`, `transactions`, `categories` — plus `error` and `savingIds`
(`AccountPage.tsx:31-35`, `:116`). Three effects load them: accounts on mount (`:41-58`),
categories on mount (`:60-74`), transactions whenever `accountId` changes (`:81-109`). The
transaction load keeps its `AbortController` in a `useRef` and aborts the previous one, so a slow
response cannot land under the wrong account (`:76-102`) — the guard `f819a10` added and
`AccountPage.test.tsx:88-115` pins.

`TransactionList.tsx` is presentational and stateless. It takes `transactions`, `categories`,
`onCategoryChange` and `savingIds` (`:15-22`), returns a German empty state when the array is
empty (`:30-36`), and otherwise renders one `TableRow` per element with **no windowing, no
pagination, no sort control and no memoization** (`:66-105`). The table is `tableLayout: 'fixed'`
with a five-column `colgroup` — `6.5rem` date, two flexible columns for Empfänger and Zweck,
`11rem` Kategorie, `7rem` Betrag (`:47-55`) — a layout `fba54a2` and `19e7c81` arrived at so a long
`Verwendungszweck` cannot push Betrag off the page. Any new control competes for that width.

Strings on this page are inline German (`'Datum'`, `'Empfänger'`, `'Zweck'`, `'Kategorie'`,
`'Betrag'`, `'Noch keine Umsätze. Importieren Sie einen CSV-Export.'`), unlike `RulesPage`, which
reads every string from `rulesText()`. `CategoryCell` is the exception on this page: it already
uses `rulesText()` (`CategoryCell.tsx:33`).

There is no route state. `App.tsx:12-17` declares `/` and `/rules` inside a `BrowserRouter` and
nothing in the app reads or writes a query string; `Nav.tsx` uses `NavLink` with `end`.

### 2. What the API gives it

`GET /api/accounts/:id/transactions` (`account.controller.ts:45-48`) takes the path param and
nothing else. The service behind it is nine lines (`account.service.ts:113-122`):

```ts
const rows = await this.prisma.transaction.findMany({
  where: { accountId, deletedAt: null },
  orderBy: [{ bookingDate: 'desc' }, { lineNumber: 'asc' }],
});
```

- No `select`, so every column is read — including `raw`, the verbatim CSV row kept for re-keying.
  Measured on the e2e database: `raw` averages **555 bytes** per row against 23 bytes of `purpose`
  and 19 of `counterpartyName`. `toPayload` (`:44-61`) then drops it, along with
  `counterpartyBic`, `endToEndRef`, `mandateRef`, `creditorId`, `accountId`, `importBatchId`,
  `dedupKey`, `lineNumber` and `deletedAt`. The bytes are read from SQLite and never sent.
- No `take`/`skip`/`cursor` — the response is the account's entire live history in one array.
- No total, no per-category counts, no "of which uncategorized" — `TransactionPayload[]` is the
  whole response body (`packages/core/src/api.ts:49-70`).
- `deletedAt: null` is the one filter, so soft-deleted rows are invisible to the UI already.

`PATCH /api/transactions/:id` (`account.controller.ts:65-72`) validates by hand — `categoryId`
must be a `string` or `null`, and **an absent key 400s**, so clearing is an explicit `null`.
There is no global `ValidationPipe`, no `class-validator` and no `zod` anywhere in `apps/api`;
validation is inline guards in controllers, hand-checks in services, or `parseRuleInput` from
`packages/core` for rules.

### 3. The inline override — already built, and what it guarantees

`CategoryCell.tsx` is the single place a human overrides a rule. Its contract, from the file's own
doc comment (`:18-31`) and the code:

- A `TextField select` with `displayEmpty`, `variant="standard"` and no visible label — the column
  header carries the name, and `aria-label` `'Kategorie'` carries it for everyone else (`:61-73`).
- The empty option reads `'Ohne Kategorie'` when the row has no category and `'Kategorie entfernen'`
  when it has one (`:94-98`); choosing it sends `null`, which clears the category **and** the lock.
- `categoryLockedAt !== null` renders 🔒 with the title `'von Hand gesetzt — Regeln ändern das
nicht'` (`:105-114`). The lock is the server's timestamp, so it can only appear after the
  response lands.
- Read-only in two cases: a `pending` row, because the next import replaces the pending set
  wholesale and the API refuses it anyway; and while `categories` is still empty, because a MUI
  `Select` whose value matches no option warns and renders blank (`:36-52`).

`AccountPage.changeCategory` (`:119-152`) writes through the API and replaces the one row in place
rather than reloading the list — "re-fetching every row to learn one row's new state would scroll
the table out from under the click". It keeps a per-row sequence number in a `useRef` map so a
superseded response is dropped, and a `savingIds` set that disables the cell while its own write is
unanswered.

Server side, `setTransactionCategory` (`account.service.ts:138-159`) sets
`categoryLockedAt: new Date()` on a set and `null` on a clear, 404s on unknown or soft-deleted
rows, 409s on pending ones, and validates the category via `CategoryService.requireCategory`.
`RuleService.applyAll` never loads a locked row (`where: { categoryLockedAt: null }`) and
re-asserts that filter in every `updateMany`.

Coverage that already exists: `CategoryCell.test.tsx` (11 cases, including "marks a row the user
set by hand", "does not offer a category on a pending row", "does not accept a second change while
the first is still in flight"), `AccountPage.test.tsx:118-163` (the in-flight write, and the
refusal path), `rule.service.test.ts:449-600` (the decisions that must not be undone), and
`e2e/rules.spec.ts:80-104` ("a category set by hand survives the next apply").

### 4. What "uncategorized" means in the data

`categoryId: string | null` on `TransactionPayload` (`api.ts:64`) and `categoryId String?` in the
schema. Five ways a live row holds `null`:

1. **Never matched.** `categorize()` returns `undefined` when no rule claims the row
   (`match.ts:116-121`), and an import writes what it gets (`ImportSummary.categorized` counts the
   rest).
2. **No rules exist yet.** The empty-database case: every imported row is uncategorized until the
   user writes a rule or picks a category by hand.
3. **Cleared by an apply.** A re-apply writes `null` as well as matches, so a category never
   outlives the rule that explains it (`docs/research/02-categorization-rules.md:315-319`;
   `rule.service.ts:269-346`).
4. **Cleared by hand.** `PATCH { categoryId: null }` clears the category and the lock, which is
   also what makes the row eligible for the next apply.
5. **Pending.** A pending row is categorized only by a rule; it cannot be set by hand at all, and
   the pending set is replaced wholesale on the next import.

The fixture data shows the shape a user sees: on the e2e database, 9 live rows, **7 with no
category**, spread over two months (8 rows in `2025-09`, 6 of them uncategorized; 1 row in
`2014-03`, uncategorized — the deliberately ancient row from `fixtures/sparkasse-camt-18.csv`).
That single stray month is worth knowing for a month selector: the months present in a real
history are not contiguous.

### 5. Month filtering — measured

`bookingDate` is text, `'YYYY-MM-DD'`, "never a `DateTime`: a booking date has no time and no
zone" (`schema.prisma:60-62`). The relevant index is `@@index([accountId, bookingDate])`
(`:94`). Measured with the `sqlite3` CLI (3.51.0) against a copy of `apps/api/data/e2e.db`:

| Query shape                                                                    | `EXPLAIN QUERY PLAN`                                                                                           |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `accountId = ? AND deletedAt IS NULL AND bookingDate >= ? AND bookingDate < ?` | `SEARCH … USING INDEX Transaction_accountId_bookingDate_idx (accountId=? AND bookingDate>? AND bookingDate<?)` |
| `accountId = ? AND bookingDate LIKE '2025-09%'`                                | `SEARCH … USING INDEX Transaction_accountId_dedupKey_key (accountId=?)`                                        |
| `accountId = ? AND substr(bookingDate,1,7) = '2025-09'`                        | `SEARCH … USING INDEX Transaction_accountId_dedupKey_key (accountId=?)`                                        |
| `SELECT DISTINCT substr(bookingDate,1,7) … ORDER BY 1 DESC`                    | `SEARCH … USING COVERING INDEX Transaction_accountId_bookingDate_idx (accountId=?)` + two temp B-trees         |

So a half-open range is the index-using form, a prefix match is not, and the list of months an
account actually has is a covering-index scan. The `orderBy` the list already uses adds
`USE TEMP B-TREE FOR LAST TERM OF ORDER BY` in every case, because `lineNumber` is not in the
index.

Prisma can express the range without raw SQL: `StringFilter` carries `gte`/`lt`
(`commonInputTypes.ts:17-29`), so `{ bookingDate: { gte: '2025-09-01', lt: '2025-10-01' } }` is
available — while `startsWith` compiles to `LIKE`, the form the plans above show scanning.

Client side, the same filter on the loaded array is `bookingDate.startsWith('2025-09')`, and
deriving the selector's options is `new Set(rows.map((r) => r.bookingDate.slice(0, 7)))`.
`Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' })` labels `2025-09` as
`September 2025`; `format.ts` has `formatAmount` and `formatBookingDate` and no month formatter
yet. Note `formatBookingDate`'s existing warning: the date is split by hand because
`new Date('2025-09-22')` parses as UTC midnight and renders as the day before west of Greenwich.

`valueDate` also exists and is nullable; the list sorts and displays `bookingDate` only.

### 6. Text search — measured

Same probe, same database. The haystacks a search would run over are `counterpartyName` (avg 19
bytes), `purpose` (avg 23 bytes, and it contains the bank's own CRLF — `'Miete Oktober\r\n
Hauptstraße 12'`) and `counterpartyIban`.

| Expression                                                          | Result          |
| ------------------------------------------------------------------- | --------------- |
| `'REWE SAGT DANKE' LIKE '%rewe%'`                                   | `1`             |
| `'MÜLLER GmbH' LIKE '%müller%'`                                     | **`0`**         |
| `'Müller GmbH' LIKE '%müller%'`                                     | `1`             |
| `lower('MÜLLER GmbH')`                                              | `'mÜller gmbh'` |
| `upper('müller gmbh')`                                              | `'MüLLER GMBH'` |
| `'Müller GmbH' LIKE '%M' \|\| char(117,776) \|\| 'l%'` (NFD needle) | **`0`**         |

ASCII folds, German does not, and a needle in the other Unicode normal form misses entirely. The
first three rows were re-run against `better-sqlite3@12.11.1` (SQLite **3.53.2**), the engine
`@prisma/adapter-better-sqlite3` drives in `apps/api`, with the same answers — this is not a
quirk of the CLI build. The generated Prisma client offers no escape: `StringFilter` has `contains`, `startsWith`, `endsWith`
and `not`, and **no `mode`** field. This is the finding `docs/research/02-categorization-rules.md`
§3 recorded for rule matching, re-confirmed here for free-text search over the same columns.

What already solves it is in the browser: `normalize()` (`packages/core/src/rules/normalize.ts:23`)
is NFKC → collapse whitespace runs → trim → `toLowerCase()`, it is exported from the root entry
(`index.ts:30`), that entry is browser-safe by construction, and `apps/web` already bundles it
through `matchRule`'s sibling exports. `normalizeIban` adds the space strip. Because whitespace is
collapsed before the compare, a needle spanning the `Verwendungszweck`'s line break —
`miete oktober hauptstraße` — matches through the normalizer and matches nothing without it.

Measured cost of doing that over 50 000 synthetic rows in Node 24.15.0 (`performance.now`, mean of
five runs): normalizing both haystack fields on every keystroke is **17.3 ms**; normalizing once
into a parallel array costs **23.8 ms** and makes each subsequent keystroke **0.99 ms**. For
comparison, `match.ts:8` records 21 ms to normalize and 6 ms to match 50 000 rows × 20 rules.

### 7. Category filtering

`categoryId` is an ordinary indexed column (`@@index([categoryId])`), so equality is plain SQL, and
on the client it is `row.categoryId === selected`. The option list needs no new request:
`AccountPage` already loads `GET /api/categories` on mount and passes `categories` to
`TransactionList` for the cells (`AccountPage.tsx:60-74`, `:213-218`). `CategoryPayload` is
`{ id, name }`, sorted by name server-side (`category.service.ts:28`).

"Ohne Kategorie" is not a category id, so a category filter that includes it is a filter over two
different things — `categoryId === x` and `categoryId === null`. The same union already appears in
`CategoryCell`'s empty `MenuItem`, where `''` stands for "no category" because MUI reads `null` as
uncontrolled.

A category can be deleted only while nothing points at it: `DELETE /api/categories/:id` refuses
with `{ code: 'CATEGORY_IN_USE', rules, transactions }` 409 (`category.service.ts:77-100`), so a
filter's selected category cannot vanish from under it while rows still carry it.

### 8. The uncategorized count

Nothing counts anything for display today. The count-shaped things that exist:

- `ApplySummary` — `{ evaluated, assigned, cleared, locked }`, returned by `POST /api/rules/apply`
  and rendered as one line by `describeApplySummary` (`i18n/rules.ts:191-209`):
  `'12 geprüft · 5 zugeordnet · 1 gelöscht · 2 manuell'`. `locked` is a **whole-database** total,
  not per account.
- `ImportSummary` — rendered by `ImportPanel`'s `ImportResult` as
  `'{imported} importiert · {skipped} Duplikate übersprungen · {restored} wiederhergestellt ·
{failed} fehlerhaft'` inside an `Alert` whose severity switches on failures, with the detected
  encoding in a `Chip` (`ImportPanel.tsx:120-150`). This is the repo's one existing pattern for
  putting a count where the user cannot miss it.
- `CATEGORY_IN_USE` — rule and transaction counts carried on a 409 and worded by
  `describeCategoryInUse` (`i18n/rules.ts:175-189`).

Deriving the count client-side from the loaded array is exact today, because the array is the whole
account: `rows.reduce((n, r) => n + (r.categoryId === null ? 1 : 0), 0)` measured **0.27 ms** at
50 000 rows. Deriving it server-side means a new response shape or a new endpoint plus an index —
`(accountId, categoryId)` is not indexed, and `@@index([categoryId])` alone does not scope to an
account. Whether the number refers to the account, the current filter, or the rows a human can
actually act on (booked only — see §4) is a product question, not a data one; all three are
computable from what is already loaded.

### 9. Where the filtering runs — both sides measured

The trade-off is stated here, not resolved. Measured with a synthetic array of 50 000 payload-shaped
rows under Node 24.15.0:

| Operation                                                 | Cost                              |
| --------------------------------------------------------- | --------------------------------- |
| `JSON.stringify` of 50 000 rows                           | 19.43 MiB (**407 bytes per row**) |
| `JSON.parse` of that payload                              | 23.4 ms                           |
| Text filter, normalizing two fields per row per keystroke | 17.3 ms                           |
| Text filter over a precomputed normalized haystack        | 0.99 ms (23.8 ms to build)        |
| Month filter, `bookingDate.startsWith('2025-09')`         | 0.60 ms                           |
| Distinct months, sorted descending                        | 1.65 ms                           |
| Uncategorized count                                       | 0.27 ms                           |

407 bytes per row is the scale that matters: a household importing ~40 transactions a month for
eight years holds ~3 840 rows ≈ **1.5 MiB** per account load, and that is what `AccountPage`
already transfers on every account switch, before any filter exists. 50 000 rows is roughly a
century of that household and is included only as the ceiling `match.ts` also measured against.

Against that: keeping the filter server-side means introducing the first query parameters in this
codebase (§6 of _What the codebase forces_), and the text half of it cannot go into SQL at all
(§6) — it would have to be a `findMany` of the candidate rows followed by the same JavaScript
`normalize()` pass on the server, which is precisely what `RuleService.applyAll` already does for
rules.

### 10. Conventions a change here would be held to

- **State is plain hooks.** No Redux, no TanStack Query, no context. Loads use an
  `AbortController` kept in a `useRef`, aborting the previous request; both `AccountPage` and
  `RulesPage` do this and both document why.
- **A page owns writes; components stay presentational.** `TransactionList` and `CategoryCell` take
  callbacks; `AccountPage` owns the request, the in-flight bookkeeping and the row replacement.
- **Strings.** `src/i18n/*` uses `Record<Locale, …>` plus a `locale: Locale = 'de'` default
  parameter — German by default, English written and tested, no switcher and no locale state.
  `rules.ts` already holds `uncategorized`, `category`, `clearCategory`, `lockedHint`,
  `pendingHint`, `navTransactions`. `TransactionList`'s own headers are still inline German.
- **MUI 9.4.0 only** (`@mui/material`). `Autocomplete`, `Badge`, `Chip`, `InputAdornment`,
  `ToggleButton`, `ToggleButtonGroup` and `Tooltip` are all present; there is **no**
  `@mui/x-date-pickers` and no icon package — the app's icons are emoji (⏳, 🔒, ✕).
- **Tests.** Vitest + jsdom + Testing Library, `src/**/*.test.{ts,tsx}`; the page-level pattern is
  `vi.mock('../api/client')` with promises the test resolves by hand (`AccountPage.test.tsx:14-37`).
  Playwright specs are serial, share one SQLite file and one account, and assert on German accessible
  names. The gate is `pnpm check`, and `pnpm check:all` for anything touching HTTP or UI.
- **Contract types live in `packages/core/src/api.ts`**, and `packages/core` may not import React,
  NestJS or Prisma — enforced by `pnpm lint:deps`. A filter shape shared by both ends would live
  there; anything React-flavoured may not.

### 11. How the measurements were taken

Three probes, all against synthetic data only:

- `sqlite3` 3.51.0 (`/usr/bin/sqlite3`) against a **copy** of `apps/api/data/e2e.db` — the database
  the Playwright suite builds from `fixtures/sparkasse-camt-18.csv` — for the query plans in §5, the
  `LIKE`/`lower`/`upper` results in §6 and the row-size averages in §2.
- `better-sqlite3@12.11.1` from this checkout's store, in memory, for the same `LIKE` and `lower`
  expressions: it reports SQLite 3.53.2 and answers identically. This is the engine
  `@prisma/adapter-better-sqlite3@7.10.0` drives, so it is the one the API's own queries meet.
- A Node 24.15.0 script over 50 000 generated payload-shaped rows (German payees, a CRLF purpose,
  one row in four uncategorized) for the timings in §6 and §9, each the mean of five runs after a
  warm-up.

No real bank data was read; `apps/api/data/budget.db` was not touched.

## Code references

- `apps/web/src/pages/AccountPage.tsx:31-35` — the four pieces of state the page owns
- `apps/web/src/pages/AccountPage.tsx:81-109` — the transaction load, and the abort that guards it
- `apps/web/src/pages/AccountPage.tsx:119-152` — the category write, sequence guard and in-place row
  replacement
- `apps/web/src/pages/TransactionList.tsx:15-22` — the props; no filter, no page, no sort
- `apps/web/src/pages/TransactionList.tsx:47-55` — the fixed five-column layout a new control shares
- `apps/web/src/pages/CategoryCell.tsx:32-52` — the override, and the two read-only cases
- `apps/web/src/pages/CategoryCell.tsx:94-114` — the empty option and the 🔒 lock marker
- `apps/web/src/pages/ImportPanel.tsx:120-150` — the existing "counts, prominently" pattern
- `apps/web/src/api/client.ts:114-122` — `listTransactions`; no query string anywhere in this file
- `apps/web/src/api/client.ts:184-193` — `setTransactionCategory`, `null` clears the lock
- `apps/web/src/i18n/rules.ts:42-78` — `uncategorized` = `'Ohne Kategorie'`, and the lock wording
- `apps/web/src/i18n/rules.ts:191-209` — `describeApplySummary`, the four-count line
- `apps/web/src/format.ts:15-32` — amount and date formatting; the UTC-midnight trap
- `apps/api/src/accounts/account.controller.ts:45-48` — the list route, path param only
- `apps/api/src/accounts/account.controller.ts:65-72` — `PATCH /transactions/:id`, hand-validated
- `apps/api/src/accounts/account.service.ts:113-122` — the whole read path: fixed `where`, no
  `select`, no paging
- `apps/api/src/accounts/account.service.ts:138-159` — the lock write, and the pending refusal
- `apps/api/src/rules/category.service.ts:87-96` — the only transaction `count()`s in the codebase
- `apps/api/src/rules/rule.service.ts:170-216` — `applyAll`; `locked` is a global total
- `apps/api/src/generated/prisma/commonInputTypes.ts:17-29` — `StringFilter`: `gte`/`lt` yes,
  `mode` no
- `apps/api/prisma/schema.prisma:60-96` — `bookingDate` as text, `categoryLockedAt`, the three
  indexes
- `packages/core/src/api.ts:49-70` — `TransactionPayload`, the contract both ends render
- `packages/core/src/rules/normalize.ts:23-30` — `normalize` / `normalizeIban`
- `packages/core/src/index.ts:30` — `normalize` exported from the browser-safe entry
- `apps/web/src/pages/AccountPage.test.tsx:14-37` — the `vi.mock` + deferred-promise page pattern
- `apps/web/e2e/rules.spec.ts:80-104` — the hand-set category surviving an apply, end to end
- `docs/research/02-categorization-rules.md:185-243` — §3, the original case-folding measurement
- `docs/research/02-categorization-rules.md:286-324` — §5, the manual override and its protection
- `docs/plans/02-categorization-rules.md:573-626` — Phase 5, how the category cell reached the list

## Decisions confirmed (2026-09-23)

Five of the eight decisions below were made by the user; the other three follow from them. They are
recorded here rather than only in the plan, because this document is what the next person reads
first.

1. **Filter state is component state**, not the URL. `useSearchParams` is available — `react-router`
   7 is already a dependency — but nothing in this app reads or writes a query string today, and the
   account selector, the one control of the same kind that exists, is `useState` in `AccountPage`
   (`:32`). A filtered view is therefore not reloadable or shareable; the cost is paid on refresh,
   which for a local single-user app is the same cost the account selector already has.
2. **Filtering runs in the browser**, over the rows already loaded. §9 is what makes this cheap:
   every row of the account is in `AccountPage` state before any filter exists, and month, category
   and text filters over 50 000 rows cost 0.60 ms, well under a frame, against 0.99 ms for a search
   over a precomputed normalized haystack. The text half could not have gone into SQL anyway (§6),
   so this keeps one filter implementation rather than a split one.
3. **The uncategorized count describes the whole account**, not the current filter. It is
   `transactions.filter((row) => row.categoryId === null).length` over the unfiltered array —
   0.27 ms at 50 000 rows — so it does not move when a filter narrows the table, and a user who
   filters down to one month still sees how much work is left overall.

Following from those three:

4. **No API change is needed for this feature.** Client-side filtering (2) needs no query
   parameters, and a whole-account count (3) is derived from a response the page already has. The
   entire change lands in `apps/web/src`, which also means `pnpm check` covers it and `check:all`
   only re-proves what already worked.
5. **The month selector lists the months the account actually has**, newest first, derived from the
   loaded rows with `new Set(rows.map((row) => row.bookingDate.slice(0, 7)))` — 1.65 ms at 50 000
   rows. A continuous range would invent months the fixture proves are not there (`2025-09` and
   `2014-03`, nothing between).
6. **Nothing new goes into `packages/core`.** The one core export this needs, `normalize()`, is
   already exported from the browser-safe root entry (`index.ts:30`) and already bundled. No shared
   query shape is needed, because no request carries the filter.

Two further questions were settled while the plan was written:

7. **The count includes pending rows** — every live row with `categoryId === null`. It is a fact
   about the account, and excluding pending rows would make the chip disagree with the table the
   user is looking at. The consequence is accepted: a pending uncategorized row cannot be
   categorized by hand (§4), so the number has a floor until that row books.
8. **A row that stops matching disappears at once.** The visible list is derived from state during
   render, so the row `changeCategory` replaces in place (`AccountPage.tsx:131-136`) fails the next
   filter pass and leaves the table, while the count drops by one. The alternative — a set of
   recently-written ids that survive the filter — is new state to own, and makes the visible list
   stop equalling the filter.

## Still open

- **Sorting, and an amount or date-range filter.** Out of scope for this feature. They are the
  first things the three filters cannot express, and the second of them is what a report will want
  anyway.
- **When client-side stops being enough.** §9 puts the cost at under 1 ms per filter and 407 bytes
  per row, so the ceiling is the payload, not the filtering: an account would need tens of
  thousands of rows before the initial load is the thing a user notices. Nothing measures that
  threshold today because no history here is near it.

## Next step: the implementation plan

Written: [`docs/plans/03-transactions-list.md`](../plans/03-transactions-list.md). Two phases —
month and category filters with the count chip, then the text search — each a vertical slice with
its own tests and one Playwright spec at the end.
