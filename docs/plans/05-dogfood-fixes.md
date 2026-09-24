---
date: 2026-09-24T08:35:21Z
git_commit: 0e37f0da23872b5dd69539b31f06d169cb4f8f7e
branch: test/e2e-monthly-totals
topic: 'Dogfood fixes: lock-cell alignment, budget field grouping, case-insensitive category names, undo for category delete, budgets month switch without blanking'
tags: [plan, dogfood, apps-web, apps-api, categories, budgets]
status: ready
---

# PLAN: Dogfood fixes (2026-09-23 session)

This plan fixes five findings from the exploratory test session recorded in
[`dogfood-output/report.md`](../../dogfood-output/report.md). Issue numbers below are the report's.
That report is also the change log for this work. Each phase ends by writing a **Resolution** note
under its issue there, so the report stays the one place that tracks each finding from start to finish.
This plan does **not** edit plans 01–04.

| Report issue                                      | Decision                                            | Phase |
| ------------------------------------------------- | --------------------------------------------------- | ----- |
| ISSUE-001 pending row missing from import summary | Out of scope: could not reproduce                   | —     |
| ISSUE-002 raw "Failed to fetch"                   | Out of scope: goes to the separate translation plan | —     |
| ISSUE-003 chevron misaligned on locked rows       | **Fix**                                             | 1     |
| ISSUE-004 case-variant category names accepted    | **Fix** (low priority)                              | 2     |
| ISSUE-005 English API errors in German UI         | Out of scope: goes to the separate translation plan | —     |
| ISSUE-006 budget field drops thousands separator  | **Fix**                                             | 1     |
| ISSUE-007 budgets only for months with bookings   | Out of scope: not important                         | —     |
| ISSUE-008 headline counts unbudgeted spend        | Out of scope: not now                               | —     |
| ISSUE-009 month switch blanks budgets page        | **Fix**                                             | 4     |
| ISSUE-010 category delete without confirm/undo    | **Fix**                                             | 3     |

## Acceptance Criteria

- In the transactions list, category chevrons line up in one column on both locked and unlocked
  rows. Locked rows still show 🔒.
- At rest, the budget field shows `1.234,56`, with the thousands dot. Typing `1.234,56` or `1234,56`
  saves `123456` cents.
- `POST /api/categories` and `PATCH /api/categories/:id` refuse, with 409, a name equal to another
  category's name under core `normalize()`. For example, `Wohnen`, `wohnen`, `WOHNEN` and
  `wohnen` all collide. Renaming a category to a case-variant of its own name is allowed. Duplicates
  already in the database are left untouched.
- Deleting a category removes it at once and shows a snackbar `„<name>“ gelöscht` with
  **RÜCKGÄNGIG**. Undo re-creates the same name. The snackbar hides itself after 6 s, and a second
  delete replaces it.
- Switching month on `/budgets` never blanks the page. The picker, table and chart stay mounted, and
  the new month's spending shows at once. Until that month's limits arrive, the Budget and Rest
  cells show `…` and the headline leaves out `von X €`.
- A month already loaded on the page shows its limits instantly when you return to it. Budget
  writes update the cached month.
- `pnpm check` passes. Each changed behavior has a unit test.

## Technical Key Decisions and Tradeoffs

1. **Lock slot (003): always render a fixed-width slot after the select; 🔒 only when locked.**
   - Why: the select is `flex: 1`, so today its width depends on whether the lock is present.
   - Impact: `CategoryCell.tsx` only. The read-only (pending) branch is unchanged.
2. **Draft format (006): `draftOf` groups the integer euros with `Intl.NumberFormat('de-DE')` and
   still builds the cents by hand.**
   - Why: the value never passes through a float, and the parser (`parseGermanAmount`) already
     accepts grouped input.
   - Impact: `BudgetField.tsx` plus its test.
3. **Case-insensitive names (004): check in the service with core `normalize()`; no schema
   change.**
   - Why: this is the same fold rules and search use (the JS-over-rows invariant in CLAUDE.md). A
     unique index on a folded column would make `db push` fail on data that already has a
     case-duplicate (the live DB holds `Test` and `test`).
   - Impact: `CategoryService.create` and `rename` load the existing names first. There is a
     check-then-insert race, accepted because this is a single-user local app. The exact-match
     `@unique` stays as a backstop.
4. **Delete undo (010): MUI `Snackbar` with **RÜCKGÄNGIG**, where undo calls
   `createCategory(name)`.**
   - Why: the server already refuses to delete a category that is in use, so undo loses nothing.
     The re-created category gets a new id, but nothing pointed at the old one.
   - Impact: the categories card in `RulesPage.tsx`, plus new strings (de + en) in
     `i18n/rules.ts`.
5. **Month switch (009): build the report from the rows already in memory right away, show limits
   as pending, and cache limits per month.**
   - Why: no stale numbers under a new month's name, and no layout jump.
   - Impact: `BudgetsPage` state becomes `Map<month, rows>`. `BudgetTable` gets a `limitsLoading`
     prop. `describeMonthTotal` gets a loading variant.

## Current State

```
003  CategoryCell.tsx
     Box(flex) ─┬─ TextField select (flex:1)   ← narrower when the lock is there
                └─ 🔒 (only when locked)        → chevron sits ~20px further left

006  BudgetField.tsx  draftOf(123456) → "1234,56"   (parse side accepts "1.234,56")

004  schema.prisma  Category.name String @unique  (SQLite: case-sensitive)
     CategoryService.create/rename: trim → insert → P2002 → 409
     "Wohnen" vs "wohnen": no P2002 → 201

010  RulesPage.tsx  Chip onDelete → deleteCategory(id) → onChanged()   (no confirm, no undo)
     CategoryService.remove: in use → 409 CATEGORY_IN_USE with counts (already shown inline)

009  BudgetsPage.tsx
     budgets: { month, rows } | undefined
     loadedBudgets = budgets.month === month ? rows : undefined
     month switch → loadedBudgets undefined → whole page replaced by <CircularProgress/>
```

## Desired End State

### Transactions list (003)

```
Current                                   After
lebensmittel      ▾ 🔒  -8,90 €            lebensmittel        ▾ 🔒  -8,90 €
wohnen              ▾  -832,90 €           wohnen              ▾    -832,90 €
                    ↑ chevrons differ                          ↑ one column
```

### Budget field (006)

```
Current   [   1234,56 ✕]        After   [  1.234,56 ✕]
```

### Categories card (010)

```
Kategorien
[doctor ✕] [lebensmittel ✕] [wohnen ✕]
Name [__________] KATEGORIE ANLEGEN
                                   ┌─────────────────────────────────────┐
  (bottom-left, 6 s)               │ „Wohnen“ gelöscht       RÜCKGÄNGIG  │
                                   └─────────────────────────────────────┘
```

### Budgets month switch (009)

```
Current (while loading)            After (while loading März 2014 limits)
Household Budget  …nav             Household Budget  …nav
⟳                                  [März 2014 ▾]             1.143,41 € ausgegeben
                                   Kategorie   Gebucht  Vorgemerkt  Budget  Rest
(everything else gone)             doctor       0,00 €      —         …      …
                                   wohnen       0,00 €      —         …      …
                                   Ohne Kat.  1.143,41 €    —         —      —
                                   [chart: booked bars, no budget bars yet]
```

## Abstractions and Code Reuse

- `apps/web/src/pages`
  - `CategoryCell.tsx`: always render the lock slot (fixed width); the icon renders only when
    locked.
  - `BudgetField.tsx`: `draftOf` groups the euros.
  - `RulesPage.tsx`: the categories card keeps the last deleted name and shows a `Snackbar`.
  - `BudgetsPage.tsx`: `budgets` becomes `ReadonlyMap<string, readonly BudgetPayload[]>`. It fetches
    only months it hasn't cached, `write()` updates the entry for its month, and the whole-page
    spinner stays only for the first load of transactions.
  - `BudgetTable.tsx`: new prop `limitsLoading`. When it's true, `CategoryRow` renders `…` in the
    Budget and Rest cells instead of `BudgetField` and the remaining amount.
- `apps/web/src/i18n`
  - `rules.ts`: `undo` and `describeCategoryDeleted(name)` (de + en).
  - `budgets.ts`: `describeMonthTotal(report, locale, { limitsLoading })`. When loading, it prints
    `<booked> ausgegeben` (en: `spent`), plus the pending part as today.
- `apps/api/src/rules`
  - `category.service.ts`: a private `assertNameFree(name, exceptId?)` built on core `normalize`,
    called by `create` and `rename`.
- Reused as-is: core `normalize` (`packages/core/src/rules/normalize.ts`),
  `createCategory`/`deleteCategory` from `api/client`, `monthlyReport`, `SpendingChart`.

## Logging & Observability

`CategoryService` already logs refused deletes. Add one line for a refused case-variant name,
matching the existing format:

```
[CategoryService] create refused name="Wohnen" collides with cmu…kb "wohnen"
```

## Implementation

### Phase 1: Row and field polish (ISSUE-003, ISSUE-006)

Dependencies: None

Line up the category chevrons and group thousands in the budget field.

**Tasks**:

- [x] `apps/web/src/pages/CategoryCell.tsx`: in the editable branch, always render the trailing
      `Box` with a fixed width (e.g. `width: '1rem', flexShrink: 0`). Render 🔒 plus its
      `aria-label`/`title` inside it only when `locked`. When unlocked, the slot is empty and
      `aria-hidden`.
- [x] `apps/web/src/pages/CategoryCell.test.tsx`: an unlocked row renders the lock slot with no
      lock label; a locked row renders the lock with `text.lockedHint`.
- [x] `apps/web/src/pages/BudgetField.tsx`: in `draftOf`, format `euros` with a module-level
      `new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0, useGrouping: true })`, then append
      `,` and the fraction. Update the doc comment example to `123456` → `1.234,56`.
- [x] `apps/web/src/pages/BudgetField.test.tsx`: stored `123456` shows `1.234,56`. Typing
      `1.234,56` and blurring saves `123456` and shows `1.234,56`. Typing `1234,56` saves the same.
      Stored `70000` still shows `700,00`.
- [x] `dogfood-output/report.md`: set Status to `fixed (<date>)` in the triage table and add a `**Resolution**` line under ISSUE-003 and ISSUE-006 (date,
      what changed, files).

**Automated Verification**:

- [x] `pnpm --filter @household-budget/web exec vitest run src/pages/CategoryCell.test.tsx src/pages/BudgetField.test.tsx` passes
- [x] `pnpm check` passes

**Manual Verification**:

- [ ] On `/`, with a hand-set row among rule-set rows, the chevrons line up in one column.
- [ ] On `/budgets`, entering `1.234,56` shows `1.234,56` after blur.

### Phase 2: Case-insensitive category names (ISSUE-004)

Dependencies: None

Refuse names that only differ from an existing one under `normalize()`.

**Tasks**:

- [x] `apps/api/src/rules/category.service.ts`: add a private
      `assertNameFree(name: string, exceptId?: string)`. It does a `findMany({ select: { id, name } })`
      and finds any category other than `exceptId` where `normalize(c.name) === normalize(name)`. On a
      match, it logs the line above and throws `ConflictException(\`A category named ${existing.name} already exists\`)`.
The message names the **existing** spelling. Import `normalize`from`@household-budget/core`.
- [x] `create`: call `assertNameFree(trimmed)` before `category.create`. Keep the P2002 catch.
- [x] `rename`: call `assertNameFree(trimmed, categoryId)` after `requireCategory`. Keep the P2002
      catch.
- [x] `apps/api/src/rules/category.service.test.ts` cases:
  - [x] with `wohnen` present, creating `Wohnen`, `WOHNEN` or `wohnen` gets 409, and the message
        contains `wohnen`
  - [x] renaming `wohnen` to `Wohnen` succeeds and returns `Wohnen`
  - [x] renaming `doctor` to `WOHNEN` gets 409 while `wohnen` exists
  - [x] with two case-duplicates already stored (inserted directly via Prisma), `list()` returns
        both and creating a third variant gets 409
- [x] `dogfood-output/report.md`: set Status to `fixed (<date>)` in the triage table and add a `**Resolution**` line under ISSUE-004. Note that existing
      duplicates (e.g. `Test`/`test`) are left for the user to merge by hand.

**Automated Verification**:

- [x] `pnpm --filter @household-budget/api exec vitest run src/rules/category.service.test.ts` passes
- [x] `pnpm check` passes

### Phase 3: Undo for category delete (ISSUE-010)

Dependencies: None

Deleting stays one click and immediate. A snackbar offers undo.

**Tasks**:

- [x] `apps/web/src/i18n/rules.ts`: add `undo` to `RulesText` (de `Rückgängig`, en `Undo`). It is
      stored in title case like `addCategory`, and MUI's button renders it uppercase. Add an exported
      `describeCategoryDeleted(name: string, locale: Locale = 'de'): string` (de `„${name}“ gelöscht`,
      en `"${name}" deleted`), following the pattern of `describeCategoryInUse`.
- [x] `apps/web/src/pages/RulesPage.tsx`: in the categories card, add state
      `deleted: { key: number; name: string } | undefined`. On a successful `deleteCategory`, set it
      with an incremented `key` (so a second delete replaces the snackbar and restarts its timer), then
      call `onChanged()`.
- [x] Same file: render `<Snackbar key={deleted.key} open autoHideDuration={6000} onClose={clear}
message={describeCategoryDeleted(name)} action={<Button onClick={undo}>{text.undo}</Button>} />`.
      `undo` clears the state and calls `createCategory(name).then(onChanged).catch(onError)`, so a 409
      (the name was taken meanwhile) goes to the page's existing error alert.
- [x] Ignore `onClose` with reason `'clickaway'` so a click elsewhere on the page doesn't dismiss
      the undo.
- [x] `apps/web/src/pages/RulesPage.test.tsx` cases (fake timers where needed):
  - [x] deleting an unused category shows `„X“ gelöscht` and the chip is gone
  - [x] clicking RÜCKGÄNGIG calls `createCategory('X')`, and the chip is back after refresh
  - [x] after 6 s the snackbar is gone and `createCategory` was not called
  - [x] deleting A then B shows only B's snackbar
  - [x] a refused delete (409 CATEGORY_IN_USE) shows the existing inline refusal and **no** snackbar
- [x] `dogfood-output/report.md`: set Status to `fixed (<date>)` in the triage table and add a `**Resolution**` line under ISSUE-010.

**Automated Verification**:

- [x] `pnpm --filter @household-budget/web exec vitest run src/pages/RulesPage.test.tsx` passes
- [x] `pnpm check` passes

**Manual Verification**:

- [ ] On `/rules`, create `Probe`, delete it, click RÜCKGÄNGIG, and `Probe` is back.

### Phase 4: Budgets month switch without blanking (ISSUE-009)

Dependencies: None

Keep the page mounted on a month switch, show the new month's spending at once, and show limits as
pending until they load. Cache limits per month.

**Tasks**:

- [x] `apps/web/src/pages/BudgetsPage.tsx`: replace `budgets: LoadedBudgets | undefined` with
      `budgets: ReadonlyMap<string, readonly BudgetPayload[]>` (initially an empty `Map`). Remove the
      `LoadedBudgets` interface.
- [x] Same file, the limits effect: add `const budgetsRef = useRef(budgets)`, kept current with
      `budgetsRef.current = budgets` during render. The effect stays keyed on `[month, fail]`, returns
      early when `budgetsRef.current.has(month)`, and otherwise fetches and runs
      `setBudgets(prev => new Map(prev).set(month, rows))`. Keep abort handling. A write never
      retriggers the fetch because `budgets` is not a dependency.
- [x] Same file, `write()`: update the entry for `forMonth` in the Map, not the single-month
      object. The `stored?.month !== forMonth` guard becomes "entry exists".
- [x] Same file: `const loadedBudgets = budgets.get(month)` and `const limitsLoading =
loadedBudgets === undefined`. The report uses `loadedBudgets ?? []`.
- [x] Same file, render: the whole-page `<CircularProgress/>` shows only while
      `transactions === undefined`. Pass `limitsLoading` to `BudgetTable` and to
      `describeMonthTotal(report, undefined, { limitsLoading })`.
- [x] `apps/web/src/pages/BudgetTable.tsx`: add an optional `limitsLoading?: boolean` prop (default `false`, so existing `renderTable()` calls in `BudgetTable.test.tsx` keep compiling). When it's true,
      `CategoryRow` renders `…` (with `aria-label={text.loadingLimits}`) in the Budget and Rest cells,
      with no `BudgetField`, no `isOver` colour and no row `aria-label`. `UncategorizedRow` is
      unchanged.
- [x] `apps/web/src/i18n/budgets.ts`: `describeMonthTotal` takes an optional
      `{ limitsLoading?: boolean }`. When it's set, the first part is `${booked} ${words.spent}` and the
      remaining/no-budgets part is left out. Add `spent` (de `ausgegeben`, en `spent`) and
      `loadingLimits` (de `Budgets werden geladen`, en `loading budgets`).
- [x] Tests:
  - [x] `BudgetsPage.test.tsx`: with the second month's `listBudgets` held pending, switching month
        keeps the month picker and the table in the DOM, shows that month's booked amounts, and shows
        `…` in the Budget cells. After it resolves, the fields show the limits.
  - [x] `BudgetsPage.test.tsx`: switching A → B → A calls `listBudgets` once per month.
  - [x] `BudgetsPage.test.tsx`: a write in month A, then switching to B and back, shows the written
        value without a refetch.
  - [x] `BudgetTable.test.tsx`: with `limitsLoading` set, there's no textbox and `…` appears, and
        no row is marked over.
  - [x] budgets i18n test (or an existing `describeMonthTotal` test): the loading variant gives
        `2.413,64 € ausgegeben` and keeps the pending part.
- [x] `dogfood-output/report.md`: set Status to `fixed (<date>)` in the triage table and add a `**Resolution**` line under ISSUE-009.

**Automated Verification**:

- [x] `pnpm --filter @household-budget/web exec vitest run src/pages/BudgetsPage.test.tsx src/pages/BudgetTable.test.tsx` passes
- [x] `pnpm check` passes
- [x] `pnpm check:all` passes (Playwright covers `/budgets`)

**Manual Verification**:

- [ ] On `/budgets`, switch September 2025 → März 2014 → September 2025. The page never goes blank,
      and the return to September is instant.

## Implementation Notes

During implementation, document user feedback, problems, and decisions here.

- 2026-09-24: The `format` step of `pnpm check` fails on two untracked files from other work
  (`docs/plans/05-security-hardening.md`, `docs/reports/2026-09-24-security-review.html`). This
  plan leaves them alone. Every other step (lint, deps, typecheck, unit) was run directly and
  passes, and this plan's own files are formatted.
- Phase 1: the lock slot carries `data-testid="lock-slot"` so tests can check that an empty slot
  exists on unlocked rows. It has no accessible name there to query by.

- Phase 3: undo tests use `vi.useFakeTimers({ shouldAdvanceTime: true })` from before render.
  Switching to fake timers after the snackbar opened didn't catch its already-scheduled timer.
- Phase 4, deviation from the plan: `budgetsRef.current = budgets` during render fails lint
  (`react-hooks/refs`). The ref is synced in a `useEffect` declared _before_ the fetch effect
  instead. Effects run in declaration order, so the fetch still sees the current cache.
- Phase 4: `renderTable(limitsLoading = false)` in `BudgetTable.test.tsx`. An `undefined`
  argument would break `exactOptionalPropertyTypes`.
- Verification: lint, deps, typecheck, unit tests (all packages) and `pnpm test:e2e` (13/13) pass.
  The `pnpm check` / `check:all` format step still fails only on the two untracked files from
  other work named above.

## References

- Findings and change log: [`dogfood-output/report.md`](../../dogfood-output/report.md)
- Invariants: [CLAUDE.md](../../CLAUDE.md), where rule matching and search run in JS, and budgets
  are household-wide
- Prior plans for context (not edited): [02 categorization rules](02-categorization-rules.md),
  [03 transactions list](03-transactions-list.md), [04 monthly budgets](04-monthly-budgets.md)
- Core fold: `packages/core/src/rules/normalize.ts`
