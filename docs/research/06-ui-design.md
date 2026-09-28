---
date: 2026-09-28T00:00:00Z
git_commit: a4e09e91e5e2322eceee3e383b300a3a11522216
branch: main
topic: 'How apps/web looks and flows today, what that costs the user, and what a redesign around import → categorize → report would look like'
tags: [research, apps-web, design, ux, mui, theming, information-architecture]
status: complete
---

# Research: UI design of apps/web — today, and a redesign

> Built by [plan 08](../plans/08-ui-redesign.md) (2026-09-28). The findings below describe the
> UI before it; the proposal is what the plan implemented, with the changes its notes record.
> The Sortieren inbox (`/inbox`) was built and then dropped after review (2026-09-28);
> uncategorized rows are categorized on Umsätze.

## Research question

Evaluate the current design of the web app and describe what a new design would be, thinking
past a reskin: information architecture, the core loop, visual language, and the rules that
keep it consistent. The rules themselves are in [`DESIGN.md`](../../DESIGN.md); this document is
the evidence and the reasoning behind them.

## Summary

The app is **correct and careful, but visually unauthored.** Every page is stock MUI 9 with a
three-line theme (`apps/web/src/theme.ts`: both colour schemes, `borderRadius: 10`, system
font). The engineering underneath is strong — every colour is a palette token, over-budget is a
word as well as a colour, alerts are worded at render so they follow a language switch, race
guards on every write — and a redesign should keep all of that.

What it lacks is a **point of view on the user's month.** The three pages mirror the three
backend features (list, rules, budgets) rather than the three questions a household asks:

1. _How are we doing this month?_ — answered only on `/budgets`, as a five-column table, with
   the chart below the fold and a headline sentence in body text.
2. _What still needs sorting?_ — answered by a warning chip on the list page; the work itself is
   one dropdown per table row.
3. _Where did the money go?_ — answered by a grouped bar chart whose limit bar is grey and
   whose width is fixed at 800 px.

The redesign proposed here keeps the product (import → categorize → report) and changes the
shape around it: an app shell with a persistent month, an **Überblick** that leads with the
answer, a dedicated **Sortieren** inbox that turns categorizing into a keyboard-speed triage and
rule-authoring loop, rules shown as sentences, and import as a global drop target with a
history. The visual language moves from default blue Material to a calm, paper-and-ink
"Kassenbuch" look with a category colour system that ties table, chart and list together.

## Detailed findings

### 1. Shell and navigation

- `AppHeader.tsx` renders an `h4` app title ("Household Budget" — English in the German UI) with
  three text links beside it (`Nav.tsx`). Active state is weight + `primary.main` only.
- Every page is `Container maxWidth="md"` (≈ 900 px) with `py: 6`. On a 1440 px screen, more
  than a third of the width is empty while the transactions table wraps purpose text and the
  chart scrolls horizontally (`SpendingChart.tsx` fixed `width = 800`).
- No icons in navigation, no persistent context. The **month** — the unit every question is
  asked in — is chosen separately on the list (`TransactionFilters`) and on `/budgets`, and does
  not carry across. The account picker is its own row above the list card.

### 2. Umsätze (`/`)

- The page is one outlined card: import drop zone → divider → filters → table
  (`AccountPage.tsx:327-362`). The **occasional** task (import, roughly monthly) permanently sits
  above the **frequent** task (reviewing and categorizing), and pushes the list down by
  ~180 px on every visit.
- The table is well engineered (`tableLayout: fixed`, amount column guaranteed, SEPA references
  wrap with `overflowWrap: anywhere`) but reads as a spreadsheet: no grouping by day, no running
  context, date column repeats the year on every row.
- Categories have no identity: a plain `standard` select per row, names in whatever case the
  user typed (`doctor`, `lebensmittel`, `wohnen` in the dogfood screenshots).
- State markers are emoji: `⏳` vorgemerkt, `🔒` locked, `✕` clear. They render differently per
  OS, ignore the colour scheme and cannot be sized to the type scale. `@mui/icons-material` is
  already a dependency but used only by `ThemeToggle`.
- The uncategorized chip (`TransactionFilters.tsx`) is the only call to action for the
  categorize step, and it only filters the list.

### 3. Regeln (`/rules`)

- Two stacked cards: categories as deletable chips + a name field, then a seven-column rules
  table (Priorität · Feld · Operator · Suchbegriff · Kategorie · aktiv · actions). A rule is
  _one sentence_ — "Empfänger enthält ‚rewe' → Lebensmittel" — but is shown as five cells.
- `REGEL BEARBEITEN` / `KATEGORIE ANLEGEN` / `REGELN ANWENDEN`: MUI's default
  `textTransform: uppercase`. German compounds in capitals are long and shouty.
- No feedback on what a rule _would_ do before it is saved or applied. "Regeln anwenden"
  reports counts after the fact (`applySummary`).
- Priority is a raw number (50, 100) the user types, not an order they see.

### 4. Budgets (`/budgets`)

- Month select + a one-line total (`describeMonthTotal`: "2.413,64 € von 1.000,00 € ·
  1.413,64 € über") in `body1` — the most important number in the app is set at body size.
- Table: Kategorie · Gebucht · Vorgemerkt · Budget (inline field + ✕) · Rest. Editing and reading
  share one surface, so every row always shows an input box.
- Chart: MUI X `BarChart`, booked + pending stacked, budget as a separate grey bar
  (`text.disabled`). Comparing two adjacent bars of different colours is harder than reading one
  bar against a mark; the grey reads as "disabled", not "limit".
- No trend. Nothing says whether this month is better or worse than the last three, or how far
  through the month we are (pace).

### 5. What is already right (keep)

| Practice                                                         | Where                          |
| ---------------------------------------------------------------- | ------------------------------ |
| Only palette tokens in pages, no hex                             | all of `pages/`                |
| Over budget = colour **and** the word „über" **and** aria-label  | `BudgetTable.tsx` CategoryRow  |
| Booked and vorgemerkt never summed silently                      | `core/budget/report.ts`, table |
| Loading limits shows `…`, not an empty field that invites typing | `BudgetTable.tsx` LoadingCell  |
| Errors stored as cause, worded at render                         | every page's `error` state     |
| Undo snackbar for destructive deletes                            | `RulesPage.tsx`                |
| Tabular figures and `nowrap` on amounts                          | `AMOUNT` in `BudgetTable.tsx`  |
| All text in `locales/{de,en}.ts`, `en` typed against `de`        | `locales/`                     |
| Theme follows stored scheme on first render (`noSsr`)            | `main.tsx`                     |

## Proposed redesign

### A. Information architecture

```
 today                          proposed
 ─────                          ────────
 /         Umsätze + Import     /              Überblick   (the month, answered)
 /rules    Kategorien + Regeln  /transactions  Umsätze     (read, search, fix)
 /budgets  Budgets + Chart      /inbox         Sortieren   (uncategorized triage)
                                /rules         Regeln      (sentences, live preview)
                                /imports       Importe     (history, drop target)
                                ⚙ Kategorien live in Regeln; limits are edited in Überblick
```

The shell holds three things every page shares:

- **Month stepper** (`‹ September 2025 ›`) — one selected month for the whole app, kept in the
  URL (`?m=2025-09`) so a link is a view. The list's "Alle Monate" stays as a list-only option.
- **Import button** + a window-wide drop target: dragging a CSV anywhere shows an overlay; the
  account is asked in the overlay if there is more than one.
- **Sortieren badge** — the uncategorized count, always visible, because it is the one number
  that says "there is work to do".

### B. Überblick — lead with the answer

- **Hero**: spent this month as a large figure, against the total limit, with a pace line —
  "Tag 18 von 30 · 60 % der Zeit, 72 % des Budgets". Vorgemerkt shown next to it, never added.
- **Category rows as bullet bars**: one bar per category, filled to spent (booked solid,
  vorgemerkt hatched), a tick at the limit, colour turning amber at ≥ 85 % and red with the
  word „über" past 100 %. Replaces both the table and the grouped chart for reading.
- **Edit limits** is a mode (`Budgets bearbeiten`), not a permanent input in every row.
- **Uncategorized callout**: "12 Umsätze · 318,50 € ohne Kategorie → Sortieren".
- **Trend**: last 6 months of spending as a small area/column chart, with the budget line.

### C. Sortieren — make categorizing the fast part

Categorize is a third of the product and today it is a dropdown per row. The inbox shows one
uncategorized transaction at a time, large, with:

- category buttons with number keys (`1`–`9`), `J/K` to move, `S` to skip;
- **"Regel daraus machen"**: after assigning, offer the rule that would have caught it
  (`Empfänger enthält „REWE"` → Lebensmittel) with a live count — "trifft 23 weitere
  Umsätze" — computed with the existing `packages/core` matcher over loaded rows (no new
  endpoint; same invariant as the list filter);
- progress ("7 von 12") and a finish state that sends the user to Überblick.

### D. Regeln — sentences, not cells

Each rule renders as a sentence card: **Wenn** `Empfänger` **enthält** `rewe` **→**
`● Lebensmittel` · _trifft 41_. Order is drag-to-reorder (priority stays a number in the API);
the editor shows matching transactions live as you type. Categories are managed in a side panel
on the same page, each with its colour.

### E. Umsätze — a ledger, not a grid

Grouped by day with a sticky day header and day total; counterparty in medium weight, purpose as
a muted second line; category as a coloured pill that opens a searchable menu; amount right,
tabular, income in the positive colour with a leading `+`. Filters as a sticky toolbar with
removable filter chips. Below 720 px the row becomes a two-line card.

### F. Visual language — "Kassenbuch"

Calm, paper-and-ink, numbers first. Warm neutral background, one deep ink-green primary, red
kept for _over budget_ and errors only (spending is normal and is not red). IBM Plex Sans for
the UI, a Newsreader serif for page titles and the hero amount, both bundled (local means local:
no font CDN), tabular figures everywhere a number is. Borders over
shadows. Sentence-case buttons. Material Symbols Rounded (already shipped via
`@mui/icons-material`) instead of emoji. Every category gets a colour from a fixed 8-hue
palette, used as a dot or bar — never as the only carrier of meaning. Full tokens in
[`DESIGN.md`](../../DESIGN.md).

## What the redesign needs from outside `apps/web`

| Need               | Where              | Note                                                                 |
| ------------------ | ------------------ | -------------------------------------------------------------------- |
| Category colour    | `Category.color`   | Optional column; until then, derive from creation order.             |
| Import history     | `GET /api/imports` | `ImportBatch` already stores file name, encoding, counts, timestamp. |
| Multi-month report | `packages/core`    | `monthlyReport` per month is enough; trend = map over months.        |
| Rule preview count | `packages/core`    | Existing matcher over loaded rows. No endpoint.                      |

Nothing here touches the invariants in `CLAUDE.md`: filtering and matching stay in the browser,
budgets stay household-wide, booked and vorgemerkt stay apart.

## Suggested phasing

1. **Foundation** — theme tokens, fonts, icons for emoji, sentence-case buttons, `AmountText`,
   `CategoryPill`, full-width shell with sidebar. Pure visual; no route changes.
2. **Überblick** — hero, bullet bars, edit mode, trend. `/budgets` redirects to `/`.
3. **Sortieren** — inbox route, keyboard triage, "Regel daraus machen".
4. **Regeln** — sentence cards, live preview, drag order, category colours.
5. **Umsätze + Importe** — day-grouped ledger, global drop target, import history.

Each phase is shippable on its own and keeps `pnpm check:all` green; e2e selectors that rely on
table roles (`monthly-budgets.spec.ts`, `transactions.spec.ts`) will need updating in phases 2
and 5.

## Open questions

- Should Überblick span all accounts (like budgets today) with an account filter only on the
  list? Recommended: yes, it matches the household-wide budget invariant.
- Category colour: user-chosen, or assigned and changeable? Recommended: assigned, changeable.
- Is a command palette (`⌘K`: jump to month, category, rule; "Import…") worth a phase of its
  own? Useful once there are > 20 categories; defer.
