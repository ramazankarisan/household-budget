---
date: 2026-09-23T10:54:08Z
git_commit: 0113b1b9e5dbb9955b34bc84d3e662d6e9ed0e9c
branch: main
topic: 'Transactions list: month, category and text filters, and the uncategorized count'
tags: [plan, transactions, filtering, search, apps-web]
status: implemented
---

# PLAN: The transactions list

Make the list usable once it holds more than a screenful. Filter by month, by category and by free
text; show how many rows still have no category, and make that number the way into them. The
inline override already exists — this is what lets a user find the row to override.

Research: [`docs/research/03-transactions-list.md`](../research/03-transactions-list.md). Its
measurements were taken against this checkout; do not re-derive them — in particular §6, which is
why the search runs in JavaScript, and §9, which is why all of it runs in the browser.

**This plan changes `apps/web` only.** No endpoint, no schema, no `packages/core` export, no
migration.

## Acceptance Criteria

- [x] Choosing `September 2025` shows only rows whose `bookingDate` starts `2025-09`; the fixture's
      `2014-03` row disappears.
- [x] The month selector lists only months the account actually has, newest first, labelled
      `September 2025` — not a continuous range, because a history has holes.
- [x] Choosing a category shows only rows holding it; choosing `Ohne Kategorie` shows only rows
      with `categoryId === null`, pending rows included.
- [x] Typing `müller` finds `MÜLLER GmbH`. So does `MÜLLER`, and so does the NFD spelling where
      the umlaut is `u` + U+0308. This is the case SQLite cannot do, which is why it is a
      criterion and not an implementation detail.
- [x] Typing `miete oktober hauptstraße` finds the row whose stored purpose is
      `'Miete Oktober\r\nHauptstraße 12'` — the CRLF collapse.
- [x] The search matches payee, purpose and IBAN. An empty search matches every row.
- [x] The three filters combine: month **and** category **and** search.
- [x] The count chip reports the uncategorized rows of the **whole account** and does not move when
      a filter narrows the table.
- [x] Clicking the count chip sets the category filter to `Ohne Kategorie`.
- [x] At zero the chip reads `Alle kategorisiert` and is not clickable.
- [x] Setting a category by hand lowers the count by one, and the row leaves an active
      `Ohne Kategorie` filter immediately.
- [x] Switching account resets all three filters.
- [x] A filter that matches nothing says so and offers a reset — distinct from the empty state
      that invites an import.
- [x] Changing a filter issues **no** HTTP request: `listTransactions` is called once per account.
- [x] Every string the list UI shows exists in both `de` and `en`, asserted the way
      `i18n/rules.test.ts` already asserts it.
- [x] `pnpm check` is green at the end of every phase; `pnpm check:all` is green at the end.

## Technical Key Decisions and Tradeoffs

1. **Filtering runs in the browser, over the rows already loaded.**
   - Why: `AccountPage` already holds every live row of the account before any filter exists
     (research §2), and the text half could not have been a `WHERE` clause anyway — measured,
     `LIKE '%müller%'` does not match `MÜLLER GmbH` on either engine this repo runs
     (`sqlite3` 3.51.0 and `better-sqlite3@12.11.1` / SQLite 3.53.2), and the generated Prisma
     `StringFilter` has no `mode` (research §6).
   - Impact: no query parameters, no endpoint change, no new index — `apps/api` is untouched. The
     cost is the payload that already exists: 407 bytes per row, ~1.5 MiB for an eight-year
     history, transferred on every account switch as it is today.
2. **Filter state is component state in `AccountPage`, not the URL.**
   - Why: nothing in this app reads or writes a query string, and the account selector — the one
     control of the same kind — is `useState` (`AccountPage.tsx:32`).
   - Impact: a filtered view is not reloadable or shareable. `useSearchParams` stays available
     (`react-router@7` is a dependency) if that is ever wanted; moving there later changes one
     hook, not the filter logic, which is why the logic lives in a pure module.
3. **The filter logic is a pure module, `apps/web/src/filter.ts`.**
   - Why: `format.ts` is the precedent — a pure module at `src/` root with its own unit test and no
     React in it. The German cases this must get right (`MÜLLER`, NFD, the CRLF purpose) are
     testable as string-in/boolean-out, without rendering a table.
   - Impact: the component keeps no logic beyond `useMemo`. It also keeps the door open for
     decision 2's URL variant.
4. **The search normalizes with `normalize()` from `packages/core`.**
   - Why: it is the one definition of "the same text" in this codebase — NFKC, whitespace
     collapsed, trimmed, lower-cased — already exported from the browser-safe root entry
     (`index.ts:30`) and already bundled by `apps/web`. A second definition would let the search
     disagree with the rules engine about `MÜLLER GmbH`, which is the bug the extraction of that
     function existed to prevent.
   - Impact: nothing new in `packages/core`. IBAN matching uses `normalizeIban` so a typed
     `DE89 3704 …` finds a stored `de89370400…`.
5. **The haystack is normalized once per loaded list, not once per keystroke.**
   - Why: measured at 50 000 rows — normalizing two fields per row on every keystroke is 17.3 ms;
     precomputing once costs 23.8 ms and makes each keystroke 0.99 ms.
   - Impact: one `useMemo` keyed on `transactions`, producing `{ row, text, iban }` triples. Note
     what that key means with decision 8: `changeCategory` builds a new array
     (`AccountPage.tsx:134`), so setting a category by hand rebuilds the haystack — the 23.8 ms
     figure is at 50 000 rows, so ~1.9 ms for the eight-year history of §9, once per click. That is
     accepted rather than cached per row id: a `Map` surviving renders is more machinery than a
     2 ms rebuild is worth, and it would have to be invalidated on exactly the same event.
     No debounce and no `useDeferredValue` either: at 0.99 ms a keystroke there is nothing to
     defer, and a debounce would only add a state machine to own.
6. **The count describes the whole account, and counts every live row with no category.**
   - Why: a per-filter count moves while the user works and cannot answer "how much is left".
     Pending rows are included because the count is a fact about the account, and excluding them
     would make the chip disagree with a table the user is looking straight at.
   - Impact: the number has a floor a user cannot always reach by hand — a pending row with no
     category is uncategorizable until it books (`TRANSACTION_PENDING`, `account.service.ts:146`).
     That is a property of the data, and the `Ohne Kategorie` filter the chip opens shows exactly
     which rows those are.
7. **The count is a clickable `Chip` in the toolbar, not a banner.**
   - Why: prominent and actionable in one control, on the row that already carries the filters it
     drives. An `Alert` would cost a row of vertical space above a table this repo has twice fought
     to keep narrow (`fba54a2`, `19e7c81`).
   - Impact: `color="warning"` and clickable above zero; a plain outlined `Alle kategorisiert`
     below it. `Chip` is already used for the import encoding and for categories on `/rules`.
8. **A row that stops matching disappears at once.**
   - Why: the list is derived from state during render, so the row replaced in place by
     `changeCategory` (`AccountPage.tsx:131-136`) simply fails the next filter pass. Anything else
     means a set of recently-written ids to own, and a visible list that no longer equals the
     filter.
   - Impact: categorizing a row while filtered to `Ohne Kategorie` makes it vanish under the
     cursor. That is the intended feedback — the count drops by one at the same moment.
9. **Filters reset when the account changes.**
   - Why: a month or category chosen for one account is meaningless for the next — `September 2025`
     against an account whose history ends in 2023 silently shows nothing, which reads as a bug.
   - Impact: the reset sits with the `setTransactions([])` the selector already does
     (`AccountPage.tsx:180-186`).
10. **The list's own strings move to `src/i18n/transactions.ts`.**
    - Why: this feature adds generated text — a count, a filtered-empty sentence — and the repo's
      rule is that wording lives in `src/i18n` with both locales written and tested
      (`describeApplySummary` is the precedent for a sentence built from a number). Leaving the
      table headers inline while the toolbar above them is translated is the drift worth closing
      in the same pass, and the file is the one being edited anyway.
    - Impact: `TransactionList`'s five headers and both empty states come from
      `transactionsText()`. `CategoryCell` keeps `rulesText()`, where its lock and category wording
      already lives.
11. **Out of scope, deliberately.** Sorting by column; an amount or date-range filter; pagination
    or virtualization (measured: the filters cost under 1 ms at 50 000 rows, so neither is load
    bearing yet); saved filters; filtering by pending status; anything server-side.

## Current State

The list renders every row it is given, with no way to narrow it and no count anywhere.

```
apps/web/src/
  pages/AccountPage.tsx     accounts, accountId, transactions, categories, error, savingIds
    │                       loads all rows for the account, aborts the previous load
    ├─► ImportPanel
    └─► TransactionList     renders every row; empty state invites an import
          └─► CategoryCell  select + 🔒, read-only on pending rows      ← already built
  api/client.ts             listTransactions(accountId) — no query string
  format.ts                 formatAmount, formatBookingDate
  i18n/  importErrors.ts, rules.ts                                      ← no transactions.ts
```

What the plan must not trip over:

- **The table is `tableLayout: 'fixed'` with a five-column `colgroup`**
  (`TransactionList.tsx:47-55`). Two commits exist solely to stop a long `Verwendungszweck`
  pushing Betrag off the page. The toolbar sits **above** the table and must wrap, not widen it.
- **`CategoryCell` renders read-only while `categories` is empty**, and the filter's category
  options come from the same array. Both arrive from `GET /api/categories`, loaded once on mount.
- **`changeCategory` replaces one row in place** rather than reloading, precisely so the table does
  not scroll out from under the click (`AccountPage.tsx:119-136`). A filter must derive from that
  state, not cache its own copy of the rows.
- **The in-flight load guard** (`AccountPage.tsx:76-102`) drops a response for an account the user
  has already left. Filters are downstream of it and must not introduce a second source of rows.
- **Pending rows** carry `status: 'pending'`, cannot be categorized by hand, and are already
  rendered with ⏳. They are ordinary rows for every filter here.
- **`e2e` specs share one database and one account**, run with `workers: 1`, and are re-run whole
  on a CI retry — so a new spec asks for what it needs only when it is not already there, the way
  `rules.spec.ts:33-68` does, and asserts nothing about absolute counts another spec sets.
- **`packages/core` may not import React** (`pnpm lint:deps`), and nothing here needs it to:
  `normalize` is already exported from the root entry.

## Desired End State

```
 browser only — no request crosses the wire when a filter changes
 ─────────────────────────────────────────────────────────────────
 AccountPage
   transactions[]  ── useMemo ──► searchable[]  { row, text, iban }  normalize() per load
   filters { month, categoryId, search }   ← useState, reset on account switch
        │
        └─ useMemo ──► visible[] = filterTransactions(searchable, filters)
        └─ useMemo ──► months[]  = monthsOf(transactions)        newest first
        └─          ── uncategorizedCount(transactions)          whole account, all live rows
        │
        ├─► TransactionFilters   [Monat ▾] [Kategorie ▾] [🔍 Suche…]  (7 ohne Kategorie)
        │                                                              └─ click → categoryId
        └─► TransactionList      visible[], or a filtered-empty line with [Filter zurücksetzen]
              └─► CategoryCell   unchanged — set a category, row leaves the filter, count −1
```

New files:

- `apps/web/src/filter.ts`, `apps/web/src/filter.test.ts`
- `apps/web/src/i18n/transactions.ts`, `apps/web/src/i18n/transactions.test.ts`
- `apps/web/src/pages/TransactionFilters.tsx`, `apps/web/src/pages/TransactionFilters.test.tsx`
- `apps/web/e2e/transactions.spec.ts`

Changed files: `apps/web/src/pages/AccountPage.tsx`, `apps/web/src/pages/TransactionList.tsx`,
`apps/web/src/format.ts`, `apps/web/src/format.test.ts`,
`apps/web/src/pages/AccountPage.test.tsx`, `apps/web/src/pages/TransactionList.test.tsx`,
`README.md`, `CLAUDE.md`.

### UI

Today — no way to narrow the list, and nothing says how much is uncategorized:

```
┌────────────────────────────────────────────────────────────┐
│  Household Budget        Umsätze · Regeln      [Giro ▾]    │
│  ┌ CSV importieren ─────────────────────────────────────┐  │
│  │  Sparkasse-Export hierher ziehen oder klicken        │  │
│  └──────────────────────────────────────────────────────┘  │
│  Datum       Empfänger      Zweck      Kategorie    Betrag │
│  22.09.2025  Müller GmbH    Rechn…   [Wohnen   ▾]  -832,90 │
│  21.09.2025  REWE SAGT…     Einkauf  [Ohne Kat ▾]   -42,17 │
│  24.03.2014  Versicherung…  Altver…  [Ohne Kat ▾]  -120,00 │
└────────────────────────────────────────────────────────────┘
```

After — one toolbar row, wrapping on a narrow window, with the count on the right:

```
┌────────────────────────────────────────────────────────────┐
│  Household Budget        Umsätze · Regeln      [Giro ▾]    │
│  ┌ CSV importieren ─────────────────────────────────────┐  │
│  └──────────────────────────────────────────────────────┘  │
│  [Monat ▾] [Kategorie ▾] [🔍 Suche…]      (7 ohne Kategorie)│
│  Datum       Empfänger      Zweck      Kategorie    Betrag │
│  22.09.2025  Müller GmbH    Rechn…   [Wohnen   ▾]  -832,90 │
│  21.09.2025  REWE SAGT…     Einkauf  [Ohne Kat ▾]   -42,17 │
└────────────────────────────────────────────────────────────┘
```

The chip clicked — the category filter is now `Ohne Kategorie`, and the count has not moved,
because it describes the account and not the view:

```
│  [Monat ▾] [Ohne Kategorie ▾] [🔍 Suche…] (7 ohne Kategorie)│
│  21.09.2025  REWE SAGT…     Einkauf  [Ohne Kat ▾]   -42,17 │
│  20.09.2025  Ärzte GmbH ⏳   Gebühr    Ohne Kategorie -30,00│
```

Everything categorized:

```
│  [Monat ▾] [Kategorie ▾] [🔍 Suche…]      (Alle kategorisiert)│
```

A filter that matches nothing — not the same sentence as an account with no rows at all:

```
│  [September 2025 ▾] [Wohnen ▾] [🔍 rewe    ]  (7 ohne Kat.) │
│                                                            │
│   Keine Umsätze für diese Auswahl.  [Filter zurücksetzen]  │
```

## Abstractions and Code Reuse

- **`normalize` / `normalizeIban`** (`packages/core/src/rules/normalize.ts:23-30`) — the search's
  canonical form, imported, never reimplemented.
- **`format.ts`** (`formatAmount`, `formatBookingDate`) — the precedent for a pure `src/` module
  with its own test, and where `formatMonth` joins them. Its existing warning applies verbatim:
  build the `Date` from parts, never from `new Date('2025-09-01')`, which is parsed as UTC.
- **`rulesText()` / `describeApplySummary`** (`i18n/rules.ts:133`, `:207`) — the
  `Record<Locale, …>` + `locale: Locale = 'de'` shape `transactionsText` and
  `describeUncategorized` follow, including the both-locales test.
- **`AccountPage`'s `useRef` load guard** (`:76-102`) — untouched; filters derive from the state it
  already owns.
- **`RulesPage`'s header `Stack`** (`RulesPage.tsx:175-180`) — `direction="row"`, `spacing`,
  `flexWrap: 'wrap'`, the shape the toolbar copies so it wraps rather than widening the table.
- **`ImportPanel`'s `Chip`** (`ImportPanel.tsx:139`) and **`CategoryStrip`'s `Chip` with an
  accessible delete control** (`RulesPage.tsx:287-306`) — the count chip's precedent, including
  giving the control a name that says what it does.
- **`CategoryCell`'s empty-option convention** (`CategoryCell.tsx:94-106`) — `''` stands for "no
  category" because MUI reads `null` as uncontrolled. The category filter uses the same `''` for
  "all" and a named constant for "uncategorized", so the two never collide.
- **`AccountPage.test.tsx`'s `vi.mock('../api/client')` with hand-resolved promises** (`:24-38`) —
  the pattern the new page-level assertions extend. It does **not** count calls today:
  `listTransactions` is a plain arrow storing a resolver in a `Map` keyed by `accountId`, so a
  second call for the same account overwrites the entry unseen. Wrapping it in `vi.fn` is what
  makes "no request on filter change" assertable at all.

## Logging & Observability

Nothing to log. No request crosses the wire when a filter changes, no row is written, and the app
is local and single-user. The one observable this feature adds is the count itself, which is on
screen by design.

## Implementation

### Phase 1: Month and category filters, and the count

Dependencies: none.

A vertical slice: the pure module, the toolbar, the wiring and the count, tested end to end. The
search field is deliberately absent until Phase 2, so this phase's tests are about selection and
counting only.

**Tasks**:

- [x] Add `apps/web/src/filter.ts` with no React in it:

```ts
/** `''` means "every month"; otherwise `'YYYY-MM'`. */
export interface TransactionFilterState {
  readonly month: string;
  /** `''` = every category, `UNCATEGORIZED` = rows with none, else a category id. */
  readonly categoryId: string;
  readonly search: string;
}

/**
 * Not a category id and never mistakable for one: every id here is a cuid, which is
 * lower-case alphanumeric and 25 characters long.
 */
export const UNCATEGORIZED = 'uncategorized';

export const NO_FILTERS: TransactionFilterState = { month: '', categoryId: '', search: '' };

/** The months the rows actually cover, `'YYYY-MM'`, newest first. A history has holes. */
export function monthsOf(transactions: readonly TransactionPayload[]): readonly string[];

/** Every live row with no category, pending included — a fact about the account, not the view. */
export function uncategorizedCount(transactions: readonly TransactionPayload[]): number;
```

- [x] Add `monthOf(transaction)` as `bookingDate.slice(0, 7)` — a substring, not a `Date`, for the
      same reason `bookingDate` is stored as text: a booking date has no zone.
- [x] Add `searchableOf(rows)` returning `{ row, text, iban }` — `text` is
      ``normalize(`${counterpartyName ?? ''} ${purpose ?? ''}`)`` and `iban` is
      `normalizeIban(counterpartyIban)`. The `?? ''` is not optional: both fields are
      `string | null` (`api.ts:57-61`), and a template literal would otherwise put the literal
      `"null"` into the haystack, where a search for `null` would find every blank row. Built here
      rather than in Phase 2 so the filter signature never changes.
- [x] Add `filterTransactions(searchable, filters): readonly TransactionPayload[]` — takes the
      pairs, returns rows. Handles `month` and `categoryId` in this phase; the `search` branch is
      `true` until Phase 2 fills it in, so Phase 2 is one function body and no rewiring.
- [x] Add `formatMonth('2025-09')` to `format.ts` using
      `Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' })` over
      `new Date(year, month - 1, 1)`. Return the input unchanged when it does not parse — and guard
      on `Number.isNaN` as well as a short split, which `formatBookingDate:27-30` does not need and
      this does: `Intl` throws `RangeError` on `new Date(NaN, NaN, 1)`, so `'x-y'` would crash the
      page rather than render as itself.
- [x] Add `apps/web/src/i18n/transactions.ts` — `transactionsText(locale: Locale = 'de')` with:
      `month`, `allMonths` (`'Alle Monate'`), `filterCategory`, `allCategories`
      (`'Alle Kategorien'`), `uncategorized` (`'Ohne Kategorie'`), `showUncategorized` (the chip's
      accessible name, `'Nur Umsätze ohne Kategorie zeigen'`), `search` (`'Suche'`), `resetFilters`
      (`'Filter zurücksetzen'`), `noTransactions` (today's import invitation, moved),
      `noMatches` (`'Keine Umsätze für diese Auswahl.'`), and the five column headers. Add
      `describeUncategorized(count, locale = 'de')` returning `'7 ohne Kategorie'` or
      `'Alle kategorisiert'` at zero, following `describeApplySummary`'s shape. Reuse `Locale`
      from `importErrors.ts`.
- [x] Add `apps/web/src/pages/TransactionFilters.tsx` — presentational, props
      `{ filters, months, categories, uncategorized, onChange }`. Two `TextField select`s and the
      count `Chip`, inside a `Stack direction="row"` with `flexWrap: 'wrap'`. The chip is
      `color="warning"` and `onClick`-able above zero, plain and inert at zero, and carries
      `showUncategorized` as its `aria-label`. **The category filter's accessible name is
      `filterCategory` (`'Kategorie filtern'`), not `'Kategorie'`** — `CategoryCell` already puts a
      combobox named `'Kategorie'` on every row (`CategoryCell.tsx:71`), and
      `AccountPage.test.tsx:77,81,85` query it page-scoped, so a second control by that name turns
      three passing tests into strict-mode locator failures. The distinct name comes from
      `slotProps={{ select: { 'aria-label': text.filterCategory } }}`.

      **Built differently.** `aria-label` does *not* win over the label element: MUI turns
      `label` into an `aria-labelledby`, which outranks `aria-label` in the accessible-name
      computation, so the visible `'Kategorie'` named the control `'Kategorie'` and the
      collision stayed. Neither select carries a visible label in the end. Nothing is lost —
      a filter select displays its own value, and at rest that value is the words
      `'Alle Monate'` and `'Alle Kategorien'`, which is what `displayEmpty: true` buys and
      what `CategoryCell` already sets it for.

- [x] Wire `AccountPage`: `filters` state, `useMemo` for `months` and for `searchableOf`, `useMemo`
      for the visible rows, `uncategorizedCount` over the unfiltered array, reset to `NO_FILTERS`
      in the account selector's `onChange` beside the existing `setTransactions([])`.
- [x] `TransactionList` renders its headers from `transactionsText()` and gains two **optional**
      props — `emptyMessage`, defaulting to `transactionsText().noTransactions`, and `onResetFilters`,
      which renders the reset control beside the message when it is supplied. Optional because
      `TransactionList.test.tsx:13-21` builds the component with three props and must keep passing
      untouched, which is also the assertion that the default path is the import invitation.
      `AccountPage` passes `noMatches` and a reset handler only while a filter is active.
- [x] Write `filter.test.ts`, `i18n/transactions.test.ts` and `TransactionFilters.test.tsx`;
      extend `AccountPage.test.tsx` and `TransactionList.test.tsx`. The page mock's
      `listTransactions` is a plain arrow today (`AccountPage.test.tsx:34-37`) — wrap it in a
      `vi.fn` so "a filter change issues no request" is assertable by call count.

**Automated Verification**:

- [x] `monthsOf` on rows spanning `2025-09` and `2014-03` returns exactly those two, newest first,
      and returns `[]` for no rows.
- [x] `filterTransactions` with `month: '2025-09'` drops the `2014-03` row.
- [x] `filterTransactions` with `categoryId: UNCATEGORIZED` returns only `categoryId === null`
      rows, **including** a pending one; with a category id, only rows holding it.
- [x] `uncategorizedCount` counts a pending uncategorized row and ignores a categorized one.
- [x] `formatMonth('2025-09')` is `'September 2025'`; `formatMonth('nonsense')` and
      `formatMonth('x-y')` each return their input and neither throws.
- [x] `describeUncategorized(0)` is `'Alle kategorisiert'` for `de` and its own English sentence for
      `en` — one literal per locale, the way `i18n/rules.test.ts:113-122` asserts each; every key of
      `transactionsText('de')` and `transactionsText('en')` is a non-empty string with no
      `undefined`.
- [x] `TransactionFilters` renders each month option through `formatMonth` — `'2025-09'` appears as
      `September 2025`, never as the raw key.
- [x] Clicking the chip calls `onChange` with `categoryId: UNCATEGORIZED`; at zero the chip has no
      click handler.
- [x] The filter select and the row selects coexist: `getByRole('combobox', { name: 'Kategorie' })`
      still resolves to exactly one element per row, and `AccountPage.test.tsx:77,81,85` pass
      unchanged.
- [x] On the page: choosing a month narrows the table, the chip's number does not change, and
      `vi.mocked(listTransactions)` has exactly one call.
- [x] Setting a category by hand while filtered to `Ohne Kategorie` removes the row from the table
      and lowers the chip by one.
- [x] Switching account resets month and category to "all".
- [x] A filter matching nothing renders `noMatches` and the reset control; an account with no rows
      renders `noTransactions` and no reset control.
- [x] `pnpm --filter @household-budget/web test` and `pnpm check` green.

### Phase 2: Text search

Dependencies: Phase 1.

The half that cannot be SQL. The German cases are the point of the phase, and they are unit tests
over strings before they are anything on screen.

**Tasks**:

- [x] Implement the `search` branch of `filterTransactions` against the two haystacks Phase 1
      already builds. **Two needles, not one**: `normalize(search)` compared against `text`, OR
      `normalizeIban(search)` compared against `iban`. One joined haystack cannot serve both —
      `normalize` keeps single spaces (`normalize.ts:24`), so a typed `DE89 3704 0044 …` never
      `includes`-matches the stored `de89370400440532013000`, and normalizing the needle with
      `normalizeIban` instead would strip the spaces out of `miete oktober` and break the purpose
      search. An empty needle matches everything; the IBAN compare is skipped when
      `normalizeIban(search)` is empty. Combine with month and category as AND.
- [x] Add the search `TextField` to `TransactionFilters` — `size="small"`, an `aria-label` from
      `transactionsText().search`, and a clear affordance. No debounce (decision 5).
- [x] Extend `filter.test.ts` with the fixture's own strings as literals: `'Müller GmbH'`,
      `'MÜLLER GmbH'`, the NFD spelling, `'REWE SAGT DANKE; FILIALE 42'`,
      `'Miete Oktober\r\nHauptstraße 12'`, an absent payee, and a stored
      `'DE89370400440532013000'` searched as `'DE89 3704 0044 0532 0130 00'`.
- [x] Add `apps/web/e2e/transactions.spec.ts` as a `test.describe.serial`: ensure the account and
      the fixture import exist the way `rules.spec.ts:33-46` does, then search `müller` and assert
      the `Müller GmbH` row is the one left; clear it; choose the month the fixture's stray 2014
      row is not in and assert that row is gone; click the count chip and assert every visible row
      shows `Ohne Kategorie` and that their number equals the chip's. Assert **no** absolute count,
      because `rules.spec.ts` categorizes rows in the same database.
- [x] Update `README.md`'s feature paragraph and `CLAUDE.md`'s status paragraph — the list can now
      be searched and filtered — and link this plan and
      [`docs/research/03-transactions-list.md`](../research/03-transactions-list.md) from
      `CLAUDE.md`, per its "Link, do not inline" rule.

**Automated Verification**:

- [x] `müller`, `MÜLLER` and the NFD spelling each match `'MÜLLER GmbH'`; `rewe` matches
      `'REWE SAGT DANKE; FILIALE 42'`.
- [x] `miete oktober hauptstraße` matches `'Miete Oktober\r\nHauptstraße 12'`.
- [x] A row with `counterpartyName: null` and `purpose: null` neither matches a non-empty needle
      nor throws — and searching `null` finds it no more than any other row, which is what the
      `?? ''` in `searchableOf` buys.
- [x] An IBAN typed in groups of four matches the stored unspaced form, and a purpose search
      containing a space still matches — the two needles, proven together.
- [x] An empty needle returns every row; a needle matching nothing returns none.
- [x] Search combines with month and category: a needle matching a row in another month returns
      nothing while that month is selected.
- [x] Typing in the search box issues no request — `vi.mocked(listTransactions)` still has one call.
- [x] Switching account clears the search box as well as the month and category selects.
- [x] `pnpm test:e2e` passes, `transactions.spec.ts` included.
- [x] `pnpm check:all` green.

**Manual Verification**:

- [ ] Import your own export, type a payee with an umlaut in lower case, and confirm the row is
      found. This is the check that proves the measured SQLite finding matters in practice and not
      only in a fixture.
- [ ] Click the count chip on an account with a real backlog, categorize a handful of rows by
      hand, and confirm each disappears as it is categorized and the count falls with it.
- [ ] Narrow the window to phone width and confirm the toolbar wraps and the table keeps its
      columns — the failure mode `fba54a2` and `19e7c81` were about.

## References

- [`docs/research/03-transactions-list.md`](../research/03-transactions-list.md) — the measurements
  behind decisions 1, 4, 5 and 6, and the decisions confirmed on 2026-09-23
- [`docs/research/02-categorization-rules.md`](../research/02-categorization-rules.md) §3 — the
  original case-folding measurement, re-confirmed for search in 03 §6
- [`docs/plans/02-categorization-rules.md`](02-categorization-rules.md) — the phase and
  verification shape this plan follows, and where `CategoryCell` came from
- `apps/web/src/pages/AccountPage.tsx:76-136,181-185` — the load guard, the in-place row
  replacement, and the account switch the filter reset joins
- `apps/web/src/pages/TransactionList.tsx:30-36,47-55` — the empty state and the fixed layout
- `apps/web/src/pages/CategoryCell.tsx:94-106` — the `''`-means-none convention the filter reuses
- `apps/web/src/i18n/rules.ts:133,175-209` — `rulesText` and the sentence-from-a-number precedent
- `apps/web/src/format.ts:19-32` — why a date is never built from an ISO string
- `packages/core/src/rules/normalize.ts:23-30` — the one definition of "the same text"
- `apps/web/e2e/rules.spec.ts:23-68` — the serial, create-only-if-missing spec shape
- `CLAUDE.md` — `pnpm check` before done; research and plans committed under `docs/`
