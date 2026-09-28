---
date: 2026-09-28T11:44:41Z
git_commit: a4e09e91e5e2322eceee3e383b300a3a11522216
branch: main
topic: 'UI redesign "Kassenbuch": app shell, Überblick, Sortieren inbox, rules as sentences, day-grouped ledger and import history'
tags: [plan, apps-web, apps-api, packages-core, design, ux, mui, routing, e2e]
status: implemented
---

# PLAN: UI redesign „Kassenbuch“

Rebuild `apps/web` around the three questions a household asks — _how is this month going_,
_what still needs sorting_, _where did the money go_ — instead of around the three backend
features. Five phases, each shippable on its own with `pnpm check:all` green.

[docs/research/06-ui-design.md](../research/06-ui-design.md) is the evaluation and the
proposal; [DESIGN.md](../../DESIGN.md) is the rulebook every task builds against (tokens, type,
components, states, accessibility). Neither is re-derived here. Mockup canvas:
https://claude.ai/artifact/XdDJmDHfwciPa8H2ap22Rm.

## Acceptance Criteria

- [x] Every page renders inside `AppShell`: ≥ 1024 px a 232 px sidebar (Überblick, Umsätze,
      Sortieren with a count badge, Regeln, Importe; accounts; DE|EN; theme) and a top bar with
      the month stepper and `Importieren`; 720–1023 px a 64 px icon rail; < 720 px a bottom nav
      with four items plus „Mehr“ (Importe, accounts, DE|EN, theme).
- [x] The month lives in the URL as `?m=YYYY-MM`. `/` without `?m` shows the newest month with
      data; `/transactions` and `/inbox` without `?m` show all months, and offer „Alle Monate“ in
      the stepper menu. `‹ ›`, `[` and `]` step it; nav links carry `?m`.
- [x] `/` is Überblick:
  - hero: booked spend of the month against the summed limits and what is left of them
    (booked only, exactly as `describeMonthTotal` does today); vorgemerkt shown beside it, never
    added in; pace marker „Tag d von n“ in the current calendar month only;
  - one row per category with a `BudgetBar`: tone `ok` < 85 %, `near` 85–100 %, `over` > 100 %
    of the limit, measured on booked + vorgemerkt — exactly `monthlyReport`'s `isOver` /
    `remainingCents`; „über“ in the text and the accessible name when over;
  - an „Ohne Kategorie“ row and callout; a 6-month trend with the summed limit as a reference
    line; „Budgets bearbeiten“ switches the rows into `BudgetField`s.
- [x] `/budgets` redirects to `/`, keeping `?m`.
- [x] `/transactions` is a day-grouped ledger over all accounts by default, filterable by
      account, category and search; the category pill opens a searchable `CategoryMenu`.
- [x] „Ohne Kategorie“ means one thing everywhere: booked rows, money in or out, with no
      category. The sidebar badge, the list chip (for all accounts) and the inbox (all months)
      show the same number; the list chip follows the chosen account; the Überblick callout
      shows the month's count and the total.
- [x] `/inbox` shows those rows one at a time; `1`–`9` assign, `M` opens the full category menu,
      `S` skip, `J`/`K` move, `N` new category, `R` rule, `Z` undo, `Esc` close; after an assign
      it proposes a rule with a live count and can create-and-apply it.
- [x] `/rules` shows rules as sentences, each with how many rows it currently wins; order
      changes by ↑/↓ buttons, `Alt+↑`/`Alt+↓` and drag, saved through one atomic
      `PUT /api/rules/order`; a new rule is appended at the end; the composer previews matches
      live; the categories panel sets each category's colour.
- [x] Every category has a stored `colorIndex` 0–7, shown only next to its name.
- [x] Import runs in a dialog reachable from every page and by dropping a file anywhere on the
      window; `/imports` lists past imports from `GET /api/imports`.
- [x] Loading follows DESIGN.md §7: nothing for 300 ms, then a skeleton in the content's shape;
      spinners only inside buttons.
- [x] No emoji in the UI, no uppercase buttons, no hex/rgb or px font sizes in `pages/`, `ui/`,
      `shell/`.
- [-] Everything works in light + dark, DE + EN, at 390, 1024 and 1440 px, without horizontal
  page scroll.
- [x] `pnpm check:all` passes at the end of every phase.

## Technical Key Decisions and Tradeoffs

1. **One plan, five vertical phases:** Foundation + shell → Überblick → Sortieren → Regeln →
   Umsätze + Importe.
   - Why: the shell, the shared month and the shared data are what every screen stands on.
   - Impact: each phase rewrites exactly the tests its change breaks and updates the docs of the
     behaviour it changes.

2. **Routes:** `/` Überblick, `/transactions` Umsätze, `/inbox` Sortieren, `/rules` Regeln,
   `/imports` Importe; `/budgets` → `<Navigate to={{ pathname: '/', search }} replace />`.
   - Why: the app opens on the answer (DESIGN.md §1.1). Old bookmarks keep working.
   - Impact: e2e `page.goto('/')` meaning the list becomes `page.goto('/transactions')` in
     phase 2.

3. **The month is a URL search parameter**, read and written through `useMonth()`.
   - Why: a link is a view; reload, back/forward and bookmarks work.
   - Impact: the router-state hand-off (`filter.ts:43-67`, `BudgetsPage.tsx:341-348`) goes in
     phase 2. `TransactionFilterState.month` goes in phase 1; `hasFilters` and „Filter
     zurücksetzen“ then cover category, account and search only — the month is navigation, not
     a filter. An invalid or unknown `?m` falls back to the page's default (as
     `BudgetsPage.tsx:160-161` does). Other view state that must survive a link is also a search
     param: `?c=` (category filter) and, until phase 5, `?a=` (account). CLAUDE.md's invariant
     "no query parameter, no endpoint" becomes "no server query or endpoint — search params hold
     view state only".

4. **One shared data layer from phase 2:** `HouseholdProvider` / `useHousehold()` owns accounts,
   rows per account, categories and rules, and every page reads and writes through it.
   - Why: the badge, the callout and the list must never disagree, and a page must never show
     data another page already changed.
   - Impact: `AccountPage` and `RulesPage` move onto it in phase 2 (otherwise imports, assigns
     and rule applies leave Überblick stale). Writes go through its actions — `reload()`,
     `replaceTransaction(row)`, `setCategories(fn)`, `setRules(fn)`, `addAccount(a)`.

5. **„Ohne Kategorie“ is one function:** `uncategorizedRows(rows, { month?, accountId? })` in
   `filter.ts` — booked rows (`status === 'booked'`), `categoryId === null`, money in or out.
   - Why: today `uncategorizedCount` (`filter.ts:100`) counts pending and all months, the
     report's null bucket counts money out of one month, and the inbox can only sort booked rows
     (`TRANSACTION_PENDING`). Three numbers for one word.
   - Impact: the badge = the inbox (all months) = the chip with all accounts. The Überblick
     callout shows `uncategorizedRows(month)` and the total; the „Ohne Kategorie“ budget row
     keeps the report's money-out amount, labelled as such. Vorgemerkt rows without a category
     are no longer counted (they cannot be sorted until they book). `uncategorizedCount` is
     removed; its doc comment's reasoning moves to the new function.

6. **Budget semantics are unchanged from plan 04**, only named: the hero compares **booked**
   against the limits (`describeMonthTotal`, `sentences.ts:190-209`); a category's remaining and
   tone use **booked + vorgemerkt** (`monthlyReport`, `report.ts:141-151`). `budgetTone` takes
   the report entry, not a free `spent` number.
   - Why: changing what „über“ means is a product decision, not a redesign.
   - Impact: no core change; the hero shows vorgemerkt as a separate chip.

7. **`Category.colorIndex Int?`**, assigned by the server, changeable by the user.
   - Why: stable colours the user can choose (DESIGN.md §2.2); an index, not a hex.
   - Impact: nullable column via `db:push`. One rule for new and old rows: the next index is
     `(number of categories that already have an index) % 8`. `create` applies it;
     `onModuleInit` applies it to every `null` row in `createdAt` order, idempotently — an
     automatic backfill rather than a script to run by hand. `PATCH /api/categories/:id`
     accepts `{ name?, colorIndex? }`; invalid → 400 `CATEGORY_COLOR_INVALID`.
     `CategoryPayload.colorIndex: number`.

8. **Rule order: position is priority.** `PUT /api/rules/order { ids }` rewrites
   `priority = (index + 1) * 10` in one `$transaction`; 409 `RULE_ORDER_STALE` unless `ids` is
   exactly the stored set; 400 `RULE_ORDER_INVALID` for a malformed body or duplicates.
   `create` without a `priority` appends: `max(priority) + 10` (or `DEFAULT_RULE_PRIORITY` when
   there are no rules); edits send the stored priority; restore keeps the priority it had (the
   rule returns to where it was, as today).
   - Why: typing numbers was the research's complaint; one transaction means two quick moves
     cannot leave a half-applied order; without "append", a new rule would land at 100 in the
     middle of a renumbered list.
   - Impact: ↑/↓, `Alt+↑/↓` and drag (`@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0`,
     `@dnd-kit/utilities@^3.2.2`, peer `react >=16.8`) all call the same endpoint. Buttons are
     the unit-tested path; drag gets one Playwright test.

9. **Import: dialog + window drop overlay + `/imports` history** via `GET /api/imports`
   (`ImportBatchPayload[]`, newest first).
   - Why: import from anywhere; history answers "did I import August already?".
   - Impact: `ImportPanel` moves into `ImportDialog` with an account select; with no account the
     dialog asks for one first. e2e imports switch to "click `Importieren`, same labelled input"
     in phase 5.

10. **`BudgetBar` is DOM; the trend is MUI X.** A `BarChart` without `width` sizes to its
    parent (`useChartDimensions.types.d.ts:22-25`); `ChartsReferenceLine` takes `y`.
    - Impact: `BudgetTable`, `SpendingChart` and their tests go in phase 2; the write logic of
      `BudgetsPage` (`write`, `:203-243`, with its cache and guards) moves unchanged.

11. **Inbox suggestions are simple and visible** (`apps/web/src/inbox.ts`): category hint = most
    frequent category among other rows with the same normalized counterparty (tie → none); rule
    proposal = `counterpartyName contains <first normalized word with ≥ 3 letters>` → the chosen
    category; preview via `matchRule` over all loaded rows, reporting matches, how many are
    uncategorized, how many are locked.
    - Why: no hidden list of payment providers; a too-broad term shows in the count at once.
    - Impact: a new rule is appended (decision 8), so rows an earlier rule already wins are
      counted separately and labelled „schon von einer früheren Regel“.

12. **Rule "wins" use first-match semantics.** A rule's count on `/rules` is the number of
    unlocked rows for which `matchingRule(orderRules(rules), row)` is that rule — core functions
    (`match.ts:94,108`).
    - Why: `matchRule` alone would count rows a higher rule already claims.

13. **This logic stays in `apps/web`, not `packages/core`:** `uncategorizedRows`, `budgetTone`,
    `inbox.ts`, `trend.ts`, `ruleStats.ts`.
    - Why: they are presentation — how the UI groups and words what core computes. The domain
      rules they rest on (`monthlyReport`, `matchRule`, `matchingRule`, `orderRules`) are already
      core and are reused, not copied. Same posture as `filter.ts` today.

14. **The theme keeps today's colour-scheme mechanism** — `colorSchemes` without
    `cssVariables`.
    - Why: with `cssVariables: true` and both schemes, MUI defaults `colorSchemeSelector` to
      `'media'` (`@mui/material/styles/createThemeWithVars.js:126`), which ignores the stored
      `mui-mode` and breaks `ThemeToggle`. DESIGN.md §10 already says so.

15. **Page chrome is declared by the page:** `usePageChrome({ title, subtitle?, months?,
monthDefault: 'newest' | 'all', actions? })` sets what `TopBar` renders, through a context
    provided by `AppShell`.
    - Why: `AppShell` owns the top bar; only the page knows its title, its months and its
      actions.

16. **Keyboard shortcuts** go through `useShortcuts(map)`, which ignores events from `input`,
    `textarea`, `select`, `[contenteditable]` and events with `ctrlKey`/`metaKey`/`altKey`
    (except explicit `Alt+↑/↓` bindings). Every shortcut is also a visible control with a
    `KeyHint`.

17. **Fonts are bundled** (`@fontsource/ibm-plex-sans` 400/500/600, `@fontsource/ibm-plex-mono`
    400, `@fontsource/newsreader` 500) and imported in `main.tsx`. App name „Haushaltsbuch“ /
    "Household budget".

18. **Responsive inside each phase.** Shell layouts and „Mehr“ in phase 1; each screen phase adds
    its < 720 px layout and one Playwright check at 390×844.

## Current State

```
main.tsx ─ ThemeProvider(theme.ts: light+dark, radius 10, system font) ─ CssBaseline
 └─ App (BrowserRouter)
     ├─ /          AccountPage   AppHeader · AccountSelect · Card[ ImportPanel │ Filters │ TransactionList <table> ]
     ├─ /rules     RulesPage     AppHeader · Card[ category chips + form ] · Card[ RuleTable 7 cols ] · undo Snackbar
     └─ /budgets   BudgetsPage   AppHeader · month select · BudgetTable <table> · SpendingChart (width 800)
 every page: Container maxWidth="md"; loads its own data; owns its own month
 BudgetsPage ──location.state {accountId, month, categoryId}──▶ AccountPage (read once on mount)
```

`/budgets` today:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Household Budget   Umsätze  Regeln  Budgets              [DE|EN] [🌙] │
│ [September 2025 ▾]      2.413,64 € von 1.000,00 € · 1.413,64 € über   │
│ Kategorie      Gebucht   Vorgemerkt   Budget            Rest          │
│ wohnen       1.982,90 €      —       [ 700,00 ][✕]   1.282,90 € über ⚠ │
│ Ohne Kategorie 318,50 €      —           —               —            │
│ Ausgaben nach Kategorie   [grouped bars, 800 px, grey limit bar]      │
└──────────────────────────────────────────────────────────────────────┘
```

API: 20 routes, no read of `ImportBatch`. `Category` is `{ id, name }`, listed by name
(`category.service.ts:28`). `Rule.priority Int @default(100)`; `create` without a priority uses
100 (`rule.ts:57`); ties by `createdAt`, `id`.

## Desired End State

```
main.tsx ─ fonts ─ ThemeProvider(theme.ts: DESIGN.md tokens in colorSchemes) ─ CssBaseline
 └─ App (BrowserRouter)
     └─ HouseholdProvider   accounts · rowsByAccount · categories · rules · actions
         └─ AppShell  Sidebar | NavRail | BottomNav+Mehr · TopBar(usePageChrome) · DropOverlay · ImportDialog
             ├─ /              OverviewPage      Hero · Callout · BudgetRows(BudgetBar | BudgetField) · Trend · TopSpends
             ├─ /transactions  TransactionsPage  FilterBar · Ledger(day groups, CategoryMenu)
             ├─ /inbox         InboxPage         InboxCard · RuleProposal · Queue
             ├─ /rules         RulesPage         RuleComposer · RuleList(sortable) · CategoryPanel
             ├─ /imports       ImportsPage       ImportHistory
             └─ /budgets  →  /  (?m kept)
 view state: ?m month · ?c category · ?a account (phases 2–4)
```

Überblick, ≥ 1024 px (full mockup: canvas board „Überblick · hell“):

```
┌────────────┬──────────────────────────────────────────────────────────────────────┐
│ ▣ Haushalts│ Überblick                        [‹ September 2025 ›] [⤒ Importieren] │
│   buch     │ Alle Konten · Stand 18. September                                    │
│ ▦ Überblick│ ┌ Ausgegeben im September ─────────────────┐ ┌ ⧉ 12 zu sortieren  → ┐ │
│ ☰ Umsätze  │ │ 1.938,02 €  von 2.130,00 € · 191,98 € übrig│ │ 7 im September        │ │
│ ⧉ Sortieren│ │ [██████████████████████████│·······]       │ └───────────────────────┘ │
│    (12)    │ │            Heute · Tag 18 von 30   91 %    │ ┌ Einnahmen │ Überschuss┐ │
│ ⚙ Regeln   │ │ ◷ 23,40 € vorgemerkt, nicht mitgezählt     │ │ +3.240 €  │ +983,48 € │ │
│ ⤒ Importe  │ └────────────────────────────────────────────┘ └───────────────────────┘ │
│            │ ┌ Budgets nach Kategorie      [✎ Budgets bearbeiten] ┐ ┌ Verlauf ───┐ │
│ Konten     │ │ ● Lebensmittel [██████████▒▒│] 486,20/450  59,60 € über ⚠│ │ ▇ ▇ ▆ █ ▇ ▆│ │
│ Giro …0130 │ │ ● Versicherung [███████████ │] 214,55/220   5,45 € übrig │ │ - - budget │ │
│ Gem. …2051 │ │ ● Wohnen       [██████████  │] 950,00/1000 50,00 € übrig │ └────────────┘ │
│ [DE|EN] ☾  │ │ ◌ Ohne Kategorie  Ausgaben 318,50 €        Sortieren → │ │ Größte …  │
└────────────┴──────────────────────────────────────────────────────────────────────┘
 row bars: solid = gebucht, hatched = vorgemerkt, │ = limit; „über“ counts both (plan 04)
```

< 720 px: header `‹ Sep 2025 ›`, hero, callout, rows stacked (name + status above the bar),
bottom nav Überblick · Umsätze · Sortieren (badge) · Regeln · Mehr.

Sortieren:

```
 [███░░░░░░░░░]  3 von 12                                  ┌ Als Nächstes  J K ┐
 ┌──────────────────────────────────────────────────────┐ │ PayPal Europe ◀    │
 │ Mi, 17.09.2025 · Girokonto                  −10,99 € │ │ Amazon EU …        │
 │ PayPal Europe S.à r.l. et Cie, S.C.A.                │ │ Bäckerei Kraus     │
 │ 1042387465123 PP.4471.PP . SPOTIFY AB, Ihr Einkauf … │ └────────────────────┘
 │ [1 ● Wohnen] [2 ● Lebensmittel] [3 ● Versicherungen] │
 │ [4 ● Freizeit] [5 ● Mobilität] [6 ● Abos  Vorschlag] │
 │ [7 ● Gesundheit] [M Weitere…] [N + Neu] [S Überspringen]│
 └──────────────────────────────────────────────────────┘
 ┌ ✧ Regel daraus machen? ──────────────────────────────┐
 │ Wenn [Empfänger ▾] [enthält ▾] [paypal     ] → ● Abos │
 │ trifft 5 weitere · 4 ohne Kategorie · 1 von Hand bleibt│
 │ [✓ Regel anlegen und anwenden R]  [Nur diesen Umsatz ↵]│
 └──────────────────────────────────────────────────────┘
```

Regeln:

```
 ┌ Neue Regel ─────────────────────────────────────────────────────────────────┐
 │ Wenn [Empfänger ▾] [enthält ▾] [stadtwerke] → [● Wohnen ▾]   [+ Regel anlegen] │
 │ trifft 9 · 2 ohne Kategorie · 1 von Hand gesetzt bleibt · wird Regel 8         │
 └─────────────────────────────────────────────────────────────────────────────┘
 ┌ 7 Regeln ──────────────────────────────────────────┐ ┌ Kategorien ──────┐
 │ ⠿ 1 Wenn Empfänger enthält „rewe“ → ● Lebensmittel  │ │ ● Wohnen      26 │
 │        gewinnt 41   [↑][↓] (●) ✎ ✕                  │ │ ● Lebensmittel 58│
 │ ⠿ 2 Wenn IBAN ist DE02 1203 … → ● Wohnen    …       │ │ Neue Kategorie   │
 │ ⠿ 7 Wenn Zweck enthält „amazon“ → ● Freizeit inaktiv │ │ [Kinder ] ●●●●●●●●│
 └─────────────────────────────────────────────────────┘ └──────────────────┘
```

Umsätze:

```
 [⌕ Empfänger, Zweck oder IBAN   /] [Alle Kategorien ▾] [Alle Konten ▾]      [⧉ 12 ohne Kategorie]
 ┌ Donnerstag, 18. September ───────────────────────────────────── −117,01 € ┐
 │ (R) REWE Markt GmbH                              [● Lebensmittel ▾]  −54,12 € │
 │     REWE SAGT DANKE 48213 · Girokonto                                     │
 │ (N) Netflix International B.V.  [lock]           [● Abos ▾]         −13,99 € │
 ├ Mittwoch, 17. September ─────────────────────────────────────────────────┤
 │ (D) dm-drogerie markt  [◷ vorgemerkt]            [● Lebensmittel]    −23,40 € │
 │ (P) PayPal Europe …                              [◌ Ohne Kategorie ▾] −10,99 €│
 └───────────────────────────────────────────────────────────────────────────┘
```

## Abstractions and Code Reuse

- `packages/core/src/`
  - `api.ts` — `CategoryPayload.colorIndex: number`; `ImportBatchPayload { id, accountId,
fileName, encoding, importedAt, rowsParsed, rowsImported, rowsSkipped, rowsRestored,
rowsFailed }` (`schema.prisma:29-48`); `RuleOrderInput { ids: readonly string[] }`
  - `index.ts` — export them; `CATEGORY_COLOR_COUNT = 8`
- `apps/api/`
  - `prisma/schema.prisma` — `Category.colorIndex Int?`
  - `src/rules/category.service.ts` — `nextColorIndex()`, `create`, `update` (was `rename`),
    `onModuleInit`, `list` returns `colorIndex`
  - `src/rules/rule.service.ts` — `create` appends; `reorder(body)`
  - `src/rules/rule.controller.ts` — `@Put('order')`
  - `src/import/import.service.ts` — `listBatches()`; `import.controller.ts` — `@Get()`
- `apps/web/src/`
  - `theme.ts`, `theme.d.ts` (new) — DESIGN.md §2 tokens; augmentation of `Palette`,
    `PaletteOptions`, `PaletteColor` (`soft`), `TypeBackground` (`subtle`), new `status`,
    `category`, `border`
  - `ui/` (new) — `AmountText`, `CategoryPill`, `CategoryMenu`, `StatusIcon`, `KeyHint`,
    `EmptyState`, `DelayedSkeleton`, `BudgetBar`, `RuleSentence`, `DropOverlay`
  - `shell/` (new) — `AppShell`, `Sidebar`, `NavRail`, `BottomNav`, `MoreSheet`, `TopBar`,
    `MonthStepper`, `PageChrome.tsx` (`usePageChrome`), `useMonth.ts`, `useShortcuts.ts`,
    `nav.ts`
  - `household/` (new) — `HouseholdProvider.tsx`, `useHousehold.ts`, `useCategorize.ts`
  - `pages/` — `OverviewPage` (replaces `BudgetsPage`), `TransactionsPage` (replaces
    `AccountPage`), `InboxPage`, `RulesPage` (rewritten), `ImportsPage`, `ImportDialog`
  - `filter.ts` — month leaves `TransactionFilterState`; `accountId` joins it (phase 5);
    `uncategorizedRows` replaces `uncategorizedCount`; `ListEntryState` removed
  - `inbox.ts`, `trend.ts`, `ruleStats.ts` (new, pure)
  - `locales/{de,en}.ts`, `sentences.ts` — new keys per phase
- Reused unchanged: `formatAmount`, `formatBookingDate`, `formatMonth`, `monthlyReport`,
  `matchRule`, `matchingRule`, `orderRules`, `describeFailure`, `describeMonthTotal`,
  `describeRemaining`, every existing client function, `ImportPanel`'s upload logic, the undo
  snackbar pattern, `BudgetField`'s parser and write behaviour (its `✕` becomes a `StatusIcon`).
- Deleted by the end: `AppHeader`, `Nav`, `AccountSelect`, `AccountPage`, `BudgetsPage`,
  `BudgetTable`, `SpendingChart`, `TransactionList`, `CategoryCell`, `TransactionFilters` and
  their tests (ported into the replacements' tests).

## Logging & Observability

API only.

- `CategoryService.onModuleInit` backfill:
  `[CategoryService] Assigned colours to 7 categories without one` — nothing when there is
  nothing to do.
- `RuleService.reorder` refusal: `warn`
  `[RuleService] Rule order refused: 6 ids sent, 7 rules stored` (counts only, through the
  existing sanitized logger).
- `RuleService.create`: the existing `create rule=… field=…` line gains `priority=…`.

## Implementation

### Phase 1: Foundation, app shell and category colours

Dependencies: None.

The visual system and the shell land; the three existing pages move inside it. Routes stay
`/`, `/rules`, `/budgets`. The month moves to `?m`.

**Tasks**:

- [x] Fonts (decision 17):
      `pnpm --filter @household-budget/web add @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono @fontsource/newsreader`;
      import the weights in `main.tsx`.
- [x] Before writing `theme.ts`, run the DESIGN.md §2.2 category palette through the `dataviz`
      skill's validator in both schemes; adjust DESIGN.md if a value fails.
- [x] `theme.ts` — `createTheme({ colorSchemes: { light: { palette }, dark: { palette } }, … })`
      without `cssVariables` (decision 14). Palette: `primary` (+ `soft`), `error` =
      `status.over`, `success` = `status.income`, `warning` = `status.near`,
      `background.default` = canvas, `background.paper` = surface, `background.subtle`,
      `divider` = border, `border.strong`, `text.*`,
      `status.{income,ok,near,over,pending}.{main,soft}`, `category` (8 entries). Typography per
      DESIGN.md §2.3 (`h1` + custom `display` in Newsreader, body
      `fontVariantNumeric: 'tabular-nums'`). `shape.borderRadius: 6`. Overrides: `MuiButton`
      (`textTransform: 'none'`, `disableElevation`), `MuiCard` (outlined, radius 10), `MuiChip`
      (radius 999), `MuiTableCell` (caption head), `MuiOutlinedInput` (`border.strong`),
      focus-visible ring (2 px `primary`, offset 2).
- [x] `theme.d.ts` — augment `Palette`/`PaletteOptions` (`createPalette.d.ts:81`) with `status`,
      `category`, `border`; `PaletteColor`/`SimplePaletteColorOptions` with `soft`;
      `TypeBackground` with `subtle`; `TypographyVariants` with `display`.
- [x] `ui/StatusIcon.tsx` — `pending` `ScheduleRounded`, `locked` `LockRounded`, `over`
      `WarningAmberRounded`, `income` `SouthWestRounded`, `clear` `CloseRounded`, at `1.125em`;
      `label` → `aria-label`, else `aria-hidden`.
- [x] Replace every emoji with `StatusIcon`, keeping each accessible name: `⏳`
      `TransactionList.tsx:108`, `BudgetTable.tsx:126`; `🔒` `CategoryCell.tsx:125`; `⚠`
      `BudgetTable.tsx:233`; `✕` `TransactionFilters.tsx` (clear search), `RulesPage.tsx:381`,
      `RulesPage.tsx:510`, `BudgetField.tsx:175`.
- [x] `ui/AmountText.tsx` (`cents`, `tone: 'auto' | 'plain'`, `variant`; income `+` and
      `status.income`; `nowrap`, tabular) — used in `TransactionList`, `BudgetTable`.
- [x] `ui/CategoryPill.tsx` (dot `category[colorIndex]` + name; `null` → „Ohne Kategorie“, dashed
      outline; clickable variant is a `button`) — used in `CategoryCell` (closed state),
      `RulesPage` chips and rule table, `BudgetTable` names.
- [x] `ui/KeyHint.tsx`, `ui/EmptyState.tsx`, `ui/DelayedSkeleton.tsx` (nothing for 300 ms, then
      `Skeleton`s of a given shape). Replace the page-level `CircularProgress` in
      `AccountPage.tsx:233` and `BudgetsPage.tsx:298` with `DelayedSkeleton`.
- [x] `shell/nav.ts` — items `{ to, labelKey, icon, badge? }`; phase 1: Umsätze `/`, Regeln
      `/rules`, Budgets `/budgets`. Nav links build `to` with the current `?m` only.
- [x] `shell/Sidebar.tsx`, `NavRail.tsx` (icons, `Tooltip` + `aria-label`), `BottomNav.tsx`
      (first four items + „Mehr“), `MoreSheet.tsx` (bottom `Drawer`: remaining nav items, DE|EN,
      theme) — `nav` landmark labelled `common.navLabel`, `aria-current` from `NavLink`.
      Sidebar: app name in Newsreader, `LanguageToggle`, `ThemeToggle` (accounts list arrives in
      phase 2).
- [x] `shell/useMonth.ts` — `useMonth(available, { defaultTo: 'newest' | 'all' })` →
      `{ month, setMonth, step(delta) }` over `?m` (`useSearchParams`, push); unknown/invalid →
      the default; `'all'` valid only when `defaultTo === 'all'`.
- [x] `shell/MonthStepper.tsx` — `‹ label ›`; the label opens a `Menu` of `available` (+ „Alle
      Monate“ when allowed); arrows disabled at the ends; `formatMonth(month, locale)`.
- [x] `shell/useShortcuts.ts` (decision 16).
- [x] `shell/PageChrome.tsx` — context + `usePageChrome(...)` (decision 15); `TopBar.tsx` renders
      `h1`, subtitle, `MonthStepper` when `months` is set, the page's `actions`, `[`/`]`.
- [x] `shell/AppShell.tsx` — breakpoints via `useMediaQuery` at 1024/720; `main` landmark;
      content `maxWidth: 1200`, gutters 32/16 px.
- [x] `App.tsx` — routes inside `<AppShell>`. `AccountPage`, `RulesPage`, `BudgetsPage` drop
      `AppHeader` and `Container maxWidth="md"` and call `usePageChrome`. Delete `AppHeader.tsx`,
      `Nav.tsx`, `AppHeader.test.tsx`.
- [x] `BudgetsPage.tsx` — month from `useMonth(months, { defaultTo: 'newest' })`; month select
      removed; the uncategorized hand-off keeps `location.state` for account + category and
      passes the month as `?m` (the state's `month` field is dropped).
- [x] `AccountPage.tsx` / `TransactionFilters.tsx` / `filter.ts` — month from
      `useMonth(months, { defaultTo: 'all' })`; month select removed;
      `filterTransactions(rows, filters, month)`; `TransactionFilterState` and `ListEntryState`
      lose `month`; `hasFilters` covers category + search.
- [x] Core: `CategoryPayload.colorIndex`, `CATEGORY_COLOR_COUNT`. API: `schema.prisma`
      `Category.colorIndex Int?`; `CategoryService.nextColorIndex()` =
      `count({ where: { colorIndex: { not: null } } }) % 8`; `create` uses it; `onModuleInit`
      fills `null` rows in `createdAt` order with the same rule; `rename` →
      `update(id, { name?, colorIndex? })` (integer 0–7 else 400 `CATEGORY_COLOR_INVALID`);
      `list`/`create`/`update` return `colorIndex ?? 0`. Controller PATCH passes both fields.
- [x] `api/client.ts` — `updateCategory(id, { name?, colorIndex? })`.
- [x] Locales (both languages): `common.appTitle` „Haushaltsbuch“ / "Household budget";
      `common.navLabel`; `common.nav.more`; `common.month.{previous,next,choose,all}`; page
      titles `common.pages.{transactions,rules,budgets}`; `errors.api.CATEGORY_COLOR_INVALID`
      (and the `ApiRefusalCode` union, `de.ts:25`).
- [x] `README.md` — after pulling: `pnpm --filter @household-budget/api prisma:generate` and
      `db:push` (new column); layout section describes the shell and `?m`.
- [x] Tests (web, new): `ui/StatusIcon.test.tsx`, `ui/AmountText.test.tsx`,
      `ui/CategoryPill.test.tsx`, `ui/DelayedSkeleton.test.tsx` (fake timers: nothing before
      300 ms), `shell/useMonth.test.tsx` (default newest/all; invalid → default; `all` refused
      when not allowed; `step` at ends), `shell/useShortcuts.test.tsx` (ignored in inputs and
      with modifiers), `shell/AppShell.test.tsx` (sidebar at 1440, rail at 900, bottom nav + Mehr
      at 390 via a `matchMedia` stub; nav links carry `?m`).
- [x] Tests (web, updated): add `colorIndex` to every `CategoryPayload` fixture (`CategoryCell`,
      `TransactionFilters`, `RulesPage`, `TransactionList`, `BudgetTable`, `BudgetsPage`,
      `AccountPage` tests); `CategoryCell.test.tsx:136` lock → accessible name
      `rules.lockedHint`; `RulesPage.test.tsx` delete-chip queries; `filter.test.ts:68-126`
      (month cases → `filterTransactions(rows, filters, month)`) and `:171-185` (`listEntryOf`
      without month); `AccountPage.test.tsx` and `TransactionFilters.test.tsx` month cases via
      `MemoryRouter initialEntries` `?m=`; `BudgetsPage.test.tsx` month cases via the stepper
      (rendered inside `AppShell` + `MemoryRouter`).
- [x] Tests (api): `category.service.test.ts` — `toEqual({ id, name })` at `:78`, `:105`,
      `:198` gain `colorIndex`; `rename` calls at `:103`, `:112`, `:196` → `update`; new: create
      assigns `nextColorIndex`; update rejects `8`, `-1`, `1.5`, `'2'`; `onModuleInit()` called
      directly (not run by `compile()`) fills nulls in `createdAt` order and is a no-op the
      second time.
- [x] E2E (updated): `smoke.spec.ts:13` heading → the `Umsätze` page title, plus `Haushaltsbuch`
      in the sidebar; `transactions.spec.ts:67-77` month → the stepper menu („Alle Monate“
      default keeps the 2014 row visible); `preferences.spec.ts` nav lookups (sidebar landmark;
      English app name) and body colours (`rgb(246, 245, 241)` light, `rgb(15, 18, 17)` dark);
      `monthly-*.spec.ts` `chooseMonth()` → stepper. New `shell.spec.ts`: `]` then `[` change
      `?m`; browser back restores the month; 390×844 shows bottom nav + Mehr and
      `document.documentElement.scrollWidth <= 390`.

**Automated Verification**:

- [x] `pnpm --filter @household-budget/web exec vitest run src/ui src/shell src/filter.test.ts` passes
- [x] `pnpm --filter @household-budget/api exec vitest run src/rules/category.service.test.ts` passes
- [x] `rg -n '[⏳🔒⚠✕]' apps/web/src --glob '*.tsx'` finds nothing
- [x] `rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(|fontSize: *[0-9]|fontSize: *.[0-9.]+px' apps/web/src/pages apps/web/src/ui apps/web/src/shell` finds nothing
- [x] `pnpm check` passes
- [x] `pnpm check:all` passes (including `shell.spec.ts`)

**Manual Verification**:

- [ ] Light and dark, DE and EN, at 1440 / 900 / 390 px: sidebar → rail → bottom nav + Mehr;
      text renders in Plex Sans and Newsreader with no request to a font CDN (DevTools ›
      Network).

### Phase 2: Shared data and Überblick

Dependencies: Phase 1.

One data layer for every page, then `/` becomes the month answered. The list moves to
`/transactions`; `/budgets` redirects. The list stays one account at a time until phase 5,
fed from the provider.

**Tasks**:

- [x] `household/HouseholdProvider.tsx` + `useHousehold()` (decision 4) — loads as
      `BudgetsPage.tsx:111-154` does plus `listRules`, with abort handling; exposes
      `{ accounts, rowsByAccount, transactions, categories, rules, status, error, reload(),
replaceTransaction(row), addAccount(a), setCategories(fn), setRules(fn) }`; mounted in
      `App.tsx` above `AppShell`.
- [x] `household/useCategorize.ts` — `AccountPage.changeCategory` (`AccountPage.tsx:153-181`)
      with its per-row sequence guard and `savingIds`, writing through `replaceTransaction`.
- [x] `AccountPage.tsx` — rows from `rowsByAccount[accountId]`, categories from the provider,
      `useCategorize`; `ImportPanel` `onImported` → `reload()`; `NewAccountForm` →
      `addAccount`. Account from `?a=` (default: first account). Category filter from `?c=`.
- [x] `RulesPage.tsx` — rules and categories from the provider; after
      create/update/delete/restore → `setRules`/`setCategories`; after „Regeln anwenden“ →
      `reload()`.
- [x] `filter.ts` — `uncategorizedRows(rows, { month?, accountId? })` (decision 5) replaces
      `uncategorizedCount`; the `TransactionFilters` chip uses it for the account's rows;
      `ListEntryState` and `listEntryOf` removed.
- [x] `App.tsx` routes: `/` `OverviewPage`, `/transactions` `AccountPage`, `/rules`, `/budgets`
      → `Navigate` keeping `search`. `nav.ts`: Überblick `/`, Umsätze `/transactions`, Regeln
      `/rules`. The sidebar gains the accounts list (name + last four IBAN digits) from the
      provider.
- [x] Badge on Umsätze (moves to Sortieren in phase 3): `uncategorizedRows(transactions).length`.
- [x] `trend.ts` — `trailingMonths(month, 6)`;
      `monthTotals(transactions, budgetsByMonth, categories, months)` →
      `{ month, bookedCents, limitCents | null }[]` via `monthlyReport`.
- [x] `ui/BudgetBar.tsx` + exported `budgetTone(entry: CategoryReport)` (decision 6: booked +
      pending vs `budgetCents`; `null` limit → `none`); track 125 % of the limit; solid booked,
      hatched pending, limit tick; `role="img"`, `aria-label` from
      `describeBudgetBar(t, name, entry)`.
- [x] `pages/overview/Hero.tsx` — `report.totalBookedCents` in `display`, `describeMonthTotal`'s
      parts as structured text (booked vs limits, remaining booked-only), pace bar with the
      „Heute · Tag d von n“ marker only in the current calendar month, vorgemerkt chip,
      „schneller als der Monat“ chip when booked share > day share.
- [x] `pages/overview/BudgetRows.tsx` — rows sorted by (booked + pending) / limit descending,
      unbudgeted after, „Ohne Kategorie“ last with its money-out amount and a link to
      `/transactions?m=…&c=uncategorized&a=<first account holding one>` (the account rule from
      `BudgetsPage.tsx:265-272`). Loading limits → `…` as today.
- [x] Edit mode: „Budgets bearbeiten“ / „Fertig“ swap the right column for `BudgetField`;
      `OverviewPage` carries `BudgetsPage`'s `budgets` cache, `budgetsRef`, `savingCells`,
      `revisions`, `writeSeq` and `write` (`:203-243`) unchanged.
- [x] `pages/overview/TrendChart.tsx` — load the `dataviz` skill first. `BarChart` (no `width`
      except in tests), six months, current in `primary`, others `primary.soft`,
      `ChartsReferenceLine y` = summed limit when every month has limits; `figure` +
      `figcaption` with the six-month average; past months' limits via `listBudgets`, cached
      with the rest.
- [x] `pages/overview/Callout.tsx` (`uncategorizedRows(month)` and the total, linking like the
      budget row), `StatTiles.tsx` (Einnahmen = booked money in; Überschuss = income − booked
      spend, „ohne vorgemerkt“), `TopSpends.tsx` (four largest booked outflows).
- [x] `pages/OverviewPage.tsx` — `usePageChrome({ title, months, monthDefault: 'newest' })`;
      `DelayedSkeleton` while loading; `EmptyState` „Noch keine Umsätze“ + link to
      `/transactions` (import moves to a dialog in phase 5).
- [x] Delete `BudgetsPage.tsx`, `BudgetTable.tsx`, `SpendingChart.tsx` and their tests.
- [x] Locales: `common.nav.overview`, `common.pages.overview`, `overview.*` (spentIn, of, left,
      over, today, dayOf, pendingNotCounted, faster, byCategory, sortedByUse, edit, done, income,
      surplus, withoutPending, trend, average, topSpends, toSort, toSortMonth,
      uncategorizedSpend); `sentences.ts` `describeBudgetBar`, `describePace`.
- [x] Tests (web): `trend.test.ts`; `filter.test.ts` (`uncategorizedRows`: pending excluded,
      income included, month and account scopes); `ui/BudgetBar.test.tsx` (tone at 84.9 / 85 /
      100 / 100.01 % of booked + pending; pending segment only when > 0; accessible name has
      „über“); `pages/OverviewPage.test.tsx` — ports `BudgetsPage.test.tsx` (write sequencing,
      refused write resets one field, cached month, limits loading `…`, uncategorized link
      carries `?m`, `?c`, `?a`) by row text instead of `role="row"`; `TrendChart.test.tsx`;
      `household/HouseholdProvider.test.tsx` (an import on the list is visible on Überblick
      without a reload; `replaceTransaction` updates both); `AccountPage.test.tsx` and
      `RulesPage.test.tsx` rendered inside the provider; chip count test updated to decision 5.
- [x] E2E: list `page.goto('/')` → `'/transactions'` (`smoke`, `transactions`, `import`,
      `rules`, `monthly-*`, `preferences`); `transactions.spec.ts:80-92` chip test counts booked
      rows (decision 5); `monthly-budgets.spec.ts` and `monthly-totals.spec.ts` rewritten against
      Überblick rows; `preferences.spec.ts:113` 'Budgets' link → „Überblick“ and its chart
      caption assertion → the trend `figcaption`; new `overview.spec.ts` (`/budgets?m=2025-09` →
      `/?m=2025-09`; edit mode saves a limit; import on the list, then Überblick shows it without
      a reload; 390×844 no horizontal scroll).
- [x] Docs: `CLAUDE.md` — status; invariant "`/budgets` has no account picker" → "Überblick is
      household-wide; `/budgets` redirects to it"; invariant "no query parameter, no endpoint" →
      decision 3's wording; invariant "the uncategorized count describes the whole account" →
      decision 5 (booked, account scope, never the filtered view). Dated notes in
      `docs/plans/03-transactions-list.md` (router-state hand-off replaced by `?m`/`?c`/`?a`;
      pending no longer counted) and `docs/plans/04-monthly-budgets.md` (`/budgets` → Überblick;
      table and chart replaced; semantics unchanged). `README.md` walkthrough.

**Automated Verification**:

- [x] `pnpm --filter @household-budget/web exec vitest run src/trend.test.ts src/filter.test.ts src/ui src/household src/pages` passes
- [x] `pnpm check` passes
- [x] `pnpm check:all` passes (including `overview.spec.ts`)

**Manual Verification**:

- [ ] With `fixtures/sparkasse-camt-18.csv` imported and limits set: Überblick reads correctly
      in light/dark, DE/EN, 1440/390 px; the pace marker appears only in the current month.

### Phase 3: Sortieren

Dependencies: Phase 2.

**Tasks**:

- [x] `inbox.ts` (decision 11) — `inboxRows(transactions, month)` = `uncategorizedRows`, newest
      first (`'all'` → every month); `categoryHint(row, transactions)`;
      `proposeRule(row, categoryId)` → `RuleInput` without `priority`;
      `previewRule(input, transactions, rules)` →
      `{ matches, uncategorized, locked, claimedEarlier }` (`claimedEarlier` via
      `matchingRule(orderRules(rules), row)`).
- [x] `ui/CategoryMenu.tsx` — `Popover` with a search field, arrow keys, `Enter`, number keys for
      the first nine, „Kategorie entfernen“ when set, „Neue Kategorie „…““ which creates and
      assigns. Built here, reused in phase 5.
- [x] `pages/InboxPage.tsx` — `usePageChrome({ title, months, monthDefault: 'all' })`; progress
      („n von total“ for the session); `InboxCard` (date, account, counterparty, purpose in mono
      with the proposed term highlighted, amount in Newsreader); buttons for the first nine
      categories (`1`–`9`, hint marked „Vorschlag“), „Weitere…“ (`M`) opening `CategoryMenu`,
      „Neu“ (`N`), „Überspringen“ (`S`), `J`/`K`, `Z` undo last assign
      (`setTransactionCategory(id, null)` via `useCategorize`); queue on the right ≥ 1024 px,
      below otherwise; finished → `EmptyState` „Alles sortiert“ + link to Überblick.
- [x] `pages/inbox/RuleProposal.tsx` — after an assign: a sentence editor prefilled by
      `proposeRule`; live `previewRule` counts + three sample rows; „Regel anlegen und anwenden“
      (`R`) → `createRule` → `applyRules` → `reload()`; „Nur diesen Umsatz“ (`Enter`) / `Esc`
      dismiss; failures through `describeFailure`.
- [x] API: `RuleService.create` without `priority` → `max(priority) + 10`, or
      `DEFAULT_RULE_PRIORITY` when there are no rules (decision 8); the log line gains
      `priority=`.
- [x] Routes + nav: `/inbox`; nav Sortieren with the badge (moved from Umsätze); the Überblick
      callout and „Ohne Kategorie“ row now link to `/inbox?m=…`.
- [x] Locales: `common.nav.inbox`, `common.pages.inbox`, `inbox.*` (progress, suggestion, more,
      new, skip, undo, done, allDone, proposalTitle, proposalHint, createAndApply, onlyThis,
      matches, uncategorizedOf, lockedStay, claimedEarlier); `sentences.ts`
      `describeRulePreview`.
- [x] Tests: `inbox.test.ts` (pending excluded; hint tie → none; `MÜLLER GmbH` → `müller`;
      `PayPal Europe …` → `paypal`; `claimedEarlier` respects order); `ui/CategoryMenu.test.tsx`;
      `pages/InboxPage.test.tsx` (`2` assigns the second category; keys ignored while the value
      input has focus; `M` opens the menu; `Z` restores; `R` calls createRule then applyRules;
      last row → finished state); `rule.service.test.ts` (create without priority appends after
      priorities 10/20/30; an explicit priority is still honoured).
- [x] E2E: `inbox.spec.ts` — open Sortieren from the badge, assign with a number key, accept the
      proposal, the badge drops by the proposal's uncategorized matches + 1; 390×844 layout.
- [x] Docs: `README.md` Sortieren paragraph; `CLAUDE.md` status; dated note in
      `docs/plans/02-categorization-rules.md` (a rule created without priority is appended).

**Automated Verification**:

- [x] `pnpm --filter @household-budget/web exec vitest run src/inbox.test.ts src/ui/CategoryMenu.test.tsx src/pages/InboxPage.test.tsx` passes
- [x] `pnpm --filter @household-budget/api exec vitest run src/rules/rule.service.test.ts` passes
- [x] `pnpm check` passes
- [x] `pnpm check:all` passes (including `inbox.spec.ts`)

**Manual Verification**:

- [ ] Sort ten rows with the keyboard only, including one new category, one category past the
      ninth via `M`, and one accepted rule.

### Phase 4: Regeln

Dependencies: Phase 3 (`previewRule`, append-on-create).

**Tasks**:

- [x] Core `RuleOrderInput`. API `RuleService.reorder(body)` (decision 8): validate shape and
      duplicates (400 `RULE_ORDER_INVALID`), set equality with stored ids (409
      `RULE_ORDER_STALE`), one `$transaction` writing `(index + 1) * 10`, return `RulePayload[]`
      in order. `RuleController` `@Put('order')`.
- [x] `api/client.ts` — `reorderRules(ids)`.
- [x] `pnpm --filter @household-budget/web add @dnd-kit/core@^6.3.1 @dnd-kit/sortable@^10.0.0 @dnd-kit/utilities@^3.2.2`.
- [x] `ruleStats.ts` — `ruleWins(rules, transactions)` → `Map<ruleId, number>` over unlocked rows
      via `matchingRule(orderRules(rules), row)` (decision 12).
- [x] `ui/RuleSentence.tsx` — „Wenn _Feld_ _Operator_ ‚Wert‘ → CategoryPill“; IBAN in mono
      without quotes; read and edit variants (edit: selects + input; sends the stored priority).
- [x] `pages/rules/RuleList.tsx` — `DndContext` + `SortableContext`
      (`verticalListSortingStrategy`, `PointerSensor` + `KeyboardSensor`); row: handle,
      position, `RuleSentence`, „gewinnt N“ or „inaktiv“, active `Switch`, ↑/↓ `IconButton`s,
      edit, delete (undo snackbar as today). Every move: optimistic `setRules` → `reorderRules`
      → on failure revert + `describeFailure`. `Alt+↑`/`Alt+↓` on the focused row.
- [x] `pages/rules/RuleComposer.tsx` — new rule as a sentence, no priority input; live
      `previewRule` („trifft n · m ohne Kategorie · k von Hand bleibt · wird Regel N+1“).
- [x] `pages/rules/CategoryPanel.tsx` — dot, name, booked row count; create with a colour radio
      group (8 swatches, `aria-label` „Farbe n“, preselecting the next index); colour change via
      `updateCategory`; delete with the existing in-use refusal and undo.
- [x] `RulesPage.tsx` — composes the three; „Regeln anwenden“ in `usePageChrome` actions (spinner
      inside the button while applying); apply summary as today.
- [x] Locales: `rules.*` (if, then, moveUp, moveDown, dragHandle, wins, inactive, willBeRule,
      color, colorN, colorLabel); `errors.api.RULE_ORDER_STALE`, `RULE_ORDER_INVALID` (and the
      union).
- [x] Tests (api): `rule.service.test.ts` — reorder writes 10/20/…; missing id → 409; extra id
      → 409; duplicate → 400; non-array → 400; `list()` returns the new order.
- [x] Tests (web): `ruleStats.test.ts` (a row matched by rules 1 and 3 counts for 1 only; locked
      rows excluded); `ui/RuleSentence.test.tsx`; `RulesPage.test.tsx` rewritten — ↑ calls
      `reorderRules` with the new order; a refusal reverts the order and shows the sentence;
      `Alt+↓` moves; composer preview; colour change calls `updateCategory`; ports `:137-139`
      (rows by sentence text instead of `role="row"`/`td`) and the delete/undo/refusal cases.
- [x] E2E: `rules.spec.ts:63`, `:127` cell lookups → sentence text; drag test (rule 2 above rule
      1 with `page.mouse`, reload, order kept); keyboard test (`Alt+↑`).
- [x] Docs: dated note in `docs/plans/02-categorization-rules.md` (priority set by position via
      `PUT /api/rules/order`); `README.md` rules paragraph.

**Automated Verification**:

- [x] `pnpm --filter @household-budget/api exec vitest run src/rules` passes
- [x] `pnpm --filter @household-budget/web exec vitest run src/ruleStats.test.ts src/ui/RuleSentence.test.tsx src/pages/RulesPage.test.tsx` passes
- [x] `pnpm check` passes
- [x] `pnpm check:all` passes

**Manual Verification**:

- [ ] Reorder by mouse drag, ↑/↓ and `Alt+↑`; VoiceOver announces drag start and end through
      dnd-kit's live region.

### Phase 5: Umsätze and Importe

Dependencies: Phase 3 (`CategoryMenu`, `useCategorize`, `/inbox`); Phase 4 (rules specs are
touched).

**Tasks**:

- [x] Core `ImportBatchPayload`. API `ImportService.listBatches()` (newest first, all accounts,
      `take: 200`), `ImportController` `@Get()`. Client `listImports(signal)`.
- [x] `filter.ts` — `accountId` joins `TransactionFilterState` (`''` = all); `hasFilters`
      includes it; `?a=` becomes the account filter's initial value.
- [x] `pages/TransactionsPage.tsx` (replaces `AccountPage.tsx`) — all accounts from the provider;
      filters account/category/search; `usePageChrome({ title, months, monthDefault: 'all' })`;
      chip = `uncategorizedRows({ accountId })`, links to `/inbox`.
- [x] `pages/transactions/Ledger.tsx` — groups by `bookingDate` newest first; sticky `h3` day
      header (`Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' })`)
      with the day's money-out total; row: initial avatar, counterparty + vorgemerkt badge + lock
      icon, purpose + account name (caption, ellipsis, full text in `title`), `CategoryPill`
      button opening `CategoryMenu` (read-only with `rules.pendingHint` for pending rows),
      `AmountText`; `role="list"`/`listitem`; < 720 px: pill under the text, amount top-right.
- [x] `pages/ImportDialog.tsx` — MUI `Dialog`; account select (hidden with one); `ImportPanel`
      inside; no account → `NewAccountForm` (from `AccountPage.tsx:284-335`) first;
      `onImported` → `reload()`; can open with a preselected `File`.
- [x] `ImportPanel.tsx` — optional `initialFile`, uploaded on mount.
- [x] `ui/DropOverlay.tsx` — window `dragenter`/`dragover`/`dragleave`/`drop` in `AppShell`,
      only when `dataTransfer.types` includes `Files`; a drop opens `ImportDialog` with the file.
- [x] `TopBar` „Importieren“ opens the dialog; Überblick's and the ledger's empty states open it.
- [x] `pages/ImportsPage.tsx` — `listImports()`; one row per batch: date/time, account, file
      name, encoding chip, „n neu · n übersprungen · n wiederhergestellt · n fehlerhaft“;
      `EmptyState`. Route `/imports`, nav Importe (in „Mehr“ below 720 px).
- [x] Sidebar accounts section: „Konto anlegen“ opens the dialog's account step.
- [x] Delete `AccountPage.tsx`, `AccountSelect.tsx`, `TransactionList.tsx`, `CategoryCell.tsx`,
      `TransactionFilters.tsx` and their tests.
- [x] Locales: `common.nav.imports`, `common.pages.imports`,
      `transactions.{allAccounts,dayTotal}`, `imports.*` (title, empty, row, encoding),
      `common.import.{dialogTitle,account,dropHere}`.
- [x] Tests (api): `import.service.test.ts` — `listBatches` newest first across accounts.
- [x] Tests (web): `pages/TransactionsPage.test.tsx` ports `AccountPage.test.tsx`,
      `TransactionList.test.tsx`, `TransactionFilters.test.tsx` (search `müller` finds
      `MÜLLER GmbH`, reset, chip ignores filters but follows the account, category change
      sequencing) against list items; the account filter narrows rows and chip;
      `transactions/Ledger.test.tsx` (grouping, day totals, pending badge, lock);
      `ImportDialog.test.tsx` (one account → no select; none → account form first; preselected
      file uploads); `ImportsPage.test.tsx`.
- [x] E2E: imports in the `import`, `monthly-*`, `preferences`, `rules`, `inbox`, `overview`
      specs → click „Importieren“, then the same `CSV-Datei auswählen` input; list assertions
      `role="cell"`/`row` → list items by text (`import.spec.ts:38-58`,
      `transactions.spec.ts:38-92`, `preferences.spec.ts:96-98`, `monthly-*`); new
      `imports.spec.ts` (history row after an import; a synthetic `drop` event opens the dialog);
      390×844 ledger check.
- [x] Docs: `CLAUDE.md` status and invariant (account-scope wording from decision 5 now covers
      "all accounts"); `README.md` walkthrough ("drop a Sparkasse CSV export anywhere …");
      `docs/research/06-ui-design.md` status note "built, plan 08"; this plan's status
      `implemented`.

**Automated Verification**:

- [x] `pnpm --filter @household-budget/api exec vitest run src/import` passes
- [x] `pnpm --filter @household-budget/web exec vitest run src/pages src/ui` passes
- [x] `rg -n "AccountPage|BudgetsPage|BudgetTable|SpendingChart|TransactionList|AppHeader|CategoryCell|TransactionFilters" apps/web/src apps/web/e2e` finds nothing
- [x] `pnpm check` passes
- [x] `pnpm check:all` passes (including `imports.spec.ts`)

**Manual Verification**:

- [ ] Drag a CSV from Finder onto any page: overlay, dialog, import, history row; list, badge
      and Überblick update without a reload.
- [ ] Full DESIGN.md §11 checklist in light/dark, DE/EN, 390/1024/1440 px.

## Implementation Notes

During implementation, document user feedback, problems, and decisions here.

- 2026-09-28, plan review: 20 findings applied — shared data layer moved to phase 2; one
  definition of „Ohne Kategorie“ (decision 5); budget semantics pinned to plan 04 (decision 6);
  new rules appended (decision 8); phase 2 links point at `/transactions` until `/inbox` exists;
  `CategoryMenu` moved to phase 3; bottom nav gains „Mehr“; line references corrected.
- Phase 1, category palette: the first palette in DESIGN.md §2.2 failed the `dataviz`
  validator (CVD ΔE 0.9 between violet and blue). Replaced by the skill's reference order
  for slots 0–6 plus a brown slot 7 instead of its red, which would collide with
  `status.over`; both schemes pass. DESIGN.md §2.2 updated.
- Phase 1, `theme.d.ts` is `mui-theme.d.ts`: TypeScript treats `theme.d.ts` beside
  `theme.ts` as that file's own declaration and ignores its module augmentation.
- Phase 1, decision 15 as built: pages render `<TopBar …/>` themselves instead of
  declaring it through a `usePageChrome` context. A context written from a page's render
  re-renders the shell, which re-renders the page with a fresh config object — a loop — and
  rendering the top bar in the page gives the same single component with no state to sync.
- Phase 1, the nav is `shell/navItems.ts` (items) + `shell/NavItemLink.tsx` (link), split
  for React Fast Refresh.
- Phase 2, the list's „Ohne Kategorie“ filter still shows vorgemerkt rows (plan 03's tested
  decision: they are on screen either way, and marked). Only the counts follow decision 5;
  `transactions.spec.ts` compares the chip with the booked rows of the filtered list.
- Phase 2, the trend draws the shown month's limit as its line and fetches no other month's
  limits: fetching six months on every visit would have broken "each month's limits load
  once, when shown", which the page's cache and its tests are built on.
- Phase 2, Überblick puts the side column beside the rows only from 1360 px
  (`TWO_COLUMNS`): at 1280 px with the sidebar, the rows' fixed columns left the bar no
  width at all — Playwright found it hidden.
- Phase 3, `Enter` is not bound to „Nur diesen Umsatz“: a focused button already answers
  Enter, and a window-level binding would act twice. `Esc` dismisses the proposal and the
  button shows it. `R` and `Esc` are bound by the proposal itself while it is on screen.
- Phase 3, `RuleSentence` / `RuleSentenceEditor` were built here (the proposal needs the
  editor) rather than in phase 4, which reuses them.
- Phase 3, the Überblick „Ohne Kategorie“ row and card now lead to `/inbox?m=…`; the
  account hand-off (`?a=`) is no longer needed there, since the inbox spans all accounts.
- Phase 4, the composer is always on screen and „Regel anlegen“ submits it — there is no
  separate "open the form" step any more. Editing a rule turns its own row into the
  sentence editor. The colour of an existing category is changed from its dot; a new one
  preselects the colour the server would assign next.
- Phase 4, `ruleErrorsOf` lives in `pages/rules/ruleErrors.ts` (Fast Refresh).
- Phase 5, the list's chip still narrows the list to „Ohne Kategorie“ rather than linking to
  `/inbox`: narrowing in place is what the chip always did, and Sortieren is one nav click
  (with its badge) away. The Überblick card and row are what lead to the inbox.
- Phase 5, the e2e specs share `e2e/support.ts` (seeding through the import dialog, ledger
  rows by text, the category pill) instead of each carrying its own copy.
- Phase 5, `TopBar` always offers „Importieren“; the dialog and the drop overlay live in
  `AppShell`, reached through `shell/importContext.ts`.
- Phase 2, jsdom has no `ResizeObserver`; `src/test/setup.ts` stubs it so the self-sizing
  trend chart can mount in page tests.
- After review (user feedback, 2026-09-28): with a month chosen, the counts followed every
  month, which read as wrong. The list's chip now counts the chosen accounts _and month_
  (still never the search or category filter), and the Überblick card leads with the month
  („Ohne Kategorie: 7 · im September · 12 insgesamt“); a finished month says so and links to
  the other months. The nav badge stays all months: it has no month of its own.
- After review (user feedback, 2026-09-28): **phase 3's Sortieren inbox is removed.** The
  user did not like it. `InboxPage`, `pages/inbox/`, `inbox.ts` and `e2e/inbox.spec.ts` are
  gone; `previewRule` moved to `rulePreview.ts` (the rule composer still counts a rule's
  reach live); `/inbox` redirects to `/transactions?c=uncategorized`, month kept; the badge
  moved to Umsätze; Überblick's „Ohne Kategorie“ links open that list. Phase 3's tasks below
  stay ticked as a record of what was built.
- After code review (2026-09-28):
  - The „Ohne Kategorie“ filter shows booked rows only, so the chip opens exactly the rows it
    counts (this reverses plan 03's "vorgemerkt shown under Ohne Kategorie").
  - A file dropped on the import dialog's own zone is no longer handed on a second time by
    the window's drop listener (`event.defaultPrevented`).
  - A file dropped on the window with several accounts waits for the account to be picked,
    and goes into one account only — switching accounts afterwards never re-uploads it.
  - Rule reordering answers only the latest move; a refusal rolls back and reloads.
  - One load's failure is no longer cleared by its own accounts request answering later.
  - The ledger's weekday headings follow the language; CLAUDE.md now says numeric dates are
    `de-DE` and spelled-out names are words.

## References

- [DESIGN.md](../../DESIGN.md) — tokens, components, states, review checklist
- [docs/research/06-ui-design.md](../research/06-ui-design.md) — evaluation and proposal
- Mockup canvas: https://claude.ai/artifact/XdDJmDHfwciPa8H2ap22Rm
- [plan 02](02-categorization-rules.md) — priority, first-match semantics
- [plan 03](03-transactions-list.md) — list filtering in the browser, uncategorized count
- [plan 04](04-monthly-budgets.md) — `monthlyReport`, household-wide budgets
- [plan 07](07-language-and-theme-switch.md) — locales, `mui-mode`, `ThemeToggle`
- `@mui/x-charts` 9.13 — `useChartDimensions.types.d.ts:22-25`, `ChartsReferenceLine`
- `@mui/material` 9.4 — `createThemeWithVars.js:126` (selector default), `createPalette.d.ts:81`
- `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0
