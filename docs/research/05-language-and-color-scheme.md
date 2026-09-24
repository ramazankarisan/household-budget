---
date: 2026-09-24T15:48:33Z
git_commit: f5d216831d22ae3ddcf3e367ffa12f7ec5242077
branch: main
topic: 'How UI text (de/en) and the colour scheme (light/dark) work in apps/web today — the ground a language switch and a dark/light switch would stand on'
tags: [research, apps-web, i18n, locale, theming, mui, color-scheme, e2e]
status: complete
---

# Research: Language (EN/DE) and colour scheme (light/dark) in apps/web

## Research question

New improvement under consideration: a switch between English and German, and a switch between
dark and light mode. What exists today for UI text, number/date formatting and theming, and where
does each of them live?

## Summary

**Language.** All wording that has been moved to `apps/web/src/i18n/` exists in both `de` and
`en`. The mechanism is a `Locale = 'de' | 'en'` type (`i18n/importErrors.ts:14`) and a
`locale: Locale = 'de'` default parameter on every text function — there is **no locale state,
context, hook or storage anywhere**. No page passes a locale; every call site relies on the `'de'`
default. This was a recorded decision ("No locale switcher, no context, no hook",
`docs/plans/02-categorization-rules.md:116-121`). Outside `i18n/`, a set of German literals is
still inline in `ImportPanel`, `AccountPage`, `AccountSelect` and `TransactionList`, and the app
title `Household Budget` is repeated in three pages. Number/date formatting is hard-wired to
`de-DE` in `format.ts` and `BudgetField.tsx`. `index.html` declares `lang="en"`.

**Colour scheme.** The MUI theme already declares both schemes —
`colorSchemes: { light: true, dark: true }` (`theme.ts:4-7`) — and is mounted with
`<ThemeProvider>` + `<CssBaseline>` in `main.tsx:17-18`. Nothing calls `useColorScheme`, reads
`prefers-color-scheme`, or touches `localStorage`. Every colour in the pages is a palette token
(`text.secondary`, `primary.main`, `error.main`, `success.main`, …) — no hex/rgb literals. The one
chart reads colours from `useTheme().palette` (`SpendingChart.tsx:56,79,87,97`).

```
apps/web/
├── index.html                    <html lang="en">, <title>Household Budget
└── src/
    ├── main.tsx                  ThemeProvider(theme) + CssBaseline around <App/>
    ├── theme.ts                  createTheme({ colorSchemes: { light, dark }, … })
    ├── App.tsx                   BrowserRouter: /  /rules  /budgets
    ├── format.ts                 Intl de-DE: currency, date, month name
    ├── i18n/
    │   ├── importErrors.ts       type Locale = 'de'|'en'; row + file error wording
    │   ├── rules.ts              rulesText(), rule/category sentences, nav labels (2 of 3)
    │   ├── transactions.ts       transactionsText(), describeUncategorized()
    │   ├── budgets.ts            budgetsText(), month total / remaining sentences
    │   └── *.test.ts             "every key, both locales, never 'undefined'"
    └── pages/
        ├── Nav.tsx               the 3 nav links (text from rules.ts + budgets.ts)
        ├── AccountPage.tsx       header + inline German (import card, new-account form)
        ├── RulesPage.tsx         header
        ├── BudgetsPage.tsx       header
        ├── ImportPanel.tsx       inline German (drop zone, alerts, import summary)
        ├── AccountSelect.tsx     inline "Konto"
        ├── TransactionList.tsx   inline "vorgemerkt"
        ├── BudgetField.tsx       own Intl de-DE formatter
        └── SpendingChart.tsx     MUI X BarChart, colours from theme palette
```

```
            today: locale is a compile-time default, not state
 ┌──────────────┐   rulesText()            ┌──────────────────────┐
 │ page / comp. │ ───────────────────────▶ │ i18n/*.ts            │
 │ (no locale)  │   describeX(value)       │ Record<Locale, …>    │
 └──────────────┘   (locale omitted → 'de')│ locale = 'de' default│
        │                                  └──────────┬───────────┘
        │ formatAmount / formatMonth                  │ formatAmount
        ▼                                             ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ format.ts — Intl.NumberFormat / DateTimeFormat('de-DE')     │
 │ (module-level constants, no locale parameter)               │
 └─────────────────────────────────────────────────────────────┘
```

## Detailed Findings

### 1. The i18n modules

- `Locale` is declared once, in `i18n/importErrors.ts:14`, and imported by `rules.ts:9`,
  `transactions.ts:1`, `budgets.ts:8` and the tests.
- Each module holds a `const TEXT: Record<Locale, XText>` and exports a getter with a German
  default: `rulesText(locale = 'de')` (`rules.ts:136`), `transactionsText` (`transactions.ts:77`),
  `budgetsText` (`budgets.ts:87`).
- Sentences that combine values are functions, not concatenated labels, each with its own
  `Record<Locale, (…) => string>`: `describeRowError` / `describeFileError` (`importErrors.ts:36,86`),
  `describeRuleError(s)`, `describeCategoryInUse`, `describeCategoryDeleted`, `describeRuleDeleted`,
  `describeApplySummary` (`rules.ts:162-242`), `describeUncategorized` (`transactions.ts:93`),
  `describeOverBy`, `describeLeft`, `describeRemaining`, `describeMonthTotal`,
  `describeBudgetError(s)` (`budgets.ts:92-199`). Doc comments explain why (`rules.ts:233-239`,
  `transactions.ts:86-92`).
- `describeFileError` falls back to `Datei nicht lesbar (CODE)` / `file not readable (CODE)` for
  unknown codes (`importErrors.ts:80-93`).
- Cross-module reuse: `budgets.ts` reuses `transactions.ts` wording for `Monat` / `Ohne Kategorie`
  (`budgets.ts:13-15`); `BudgetTable.tsx:257` and `SpendingChart.tsx:69` call
  `transactionsText().uncategorized`.
- `budgets.ts` imports `formatAmount` (`budgets.ts:7`), so its English sentences still render
  amounts as `175,07 €` — the tests assert exactly that (`budgets.test.ts:65,83`).
- Tests: every module has a `leaves()` walker asserting every key is a non-empty string without
  `undefined` for both locales (`rules.test.ts:17-39`, `transactions.test.ts:8-27`,
  `budgets.test.ts:19-49`), plus a "defaults to German" test (`rules.test.ts:41`,
  `transactions.test.ts:29`, `budgets.test.ts:51`).

### 2. Call sites — none pass a locale

`grep "'en'|locale" src/pages` (non-test) returns nothing. All calls use the default:

| Call site                                | Function                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `Nav.tsx:13,19`                          | `rulesText()`, `budgetsText()`                                                                            |
| `TransactionFilters.tsx:38,127,132,140`  | `transactionsText()`, `describeUncategorized`                                                             |
| `TransactionList.tsx:47`                 | `transactionsText()`                                                                                      |
| `AccountPage.tsx:261`                    | `transactionsText().noMatches`                                                                            |
| `CategoryCell.tsx:33`                    | `rulesText()`                                                                                             |
| `RulesPage.tsx:108,296,433,585`          | `rulesText()` (four components)                                                                           |
| `RulesPage.tsx:327,340,504,593,604,735`  | `describeCategoryDeleted/InUse`, `describeRuleDeleted`, `describeRuleErrors`, `describeApplySummary`      |
| `BudgetsPage.tsx:44,91-92,342`           | `describeBudgetErrors`, `budgetsText()`, `transactionsText()`, `describeMonthTotal(report, undefined, …)` |
| `BudgetTable.tsx:65,111,148,170,246,257` | `budgetsText()`, `describeRemaining`, `transactionsText()`                                                |
| `BudgetField.tsx:61,91`                  | `budgetsText()`, `describeBudgetError`                                                                    |
| `SpendingChart.tsx:57,69`                | `budgetsText()`, `transactionsText()`                                                                     |
| `ImportPanel.tsx:28,157`                 | `describeFileError`, `describeRowError`                                                                   |

Some sentences are produced outside render and stored in state: `RulesPage.tsx:121` (`offerUndo`
stores the snackbar message string), `BudgetsPage.tsx:44` (error sentences).

### 3. Inline strings not in `i18n/`

| Location                                                          | Text                                                                                                            |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `AccountPage.tsx:209`, `RulesPage.tsx:193`, `BudgetsPage.tsx:293` | `Household Budget` (h1, three copies)                                                                           |
| `AccountPage.tsx:243`                                             | `CSV importieren`                                                                                               |
| `AccountPage.tsx:307-332`                                         | `Konto anlegen`, explanatory paragraph, `IBAN`, `Bezeichnung`, `Anlegen`                                        |
| `AccountSelect.tsx:22`                                            | `Konto`                                                                                                         |
| `ImportPanel.tsx:87,91,99`                                        | `Import läuft…`, `Sparkasse-Export hierher ziehen oder klicken zum Auswählen`, aria-label `CSV-Datei auswählen` |
| `ImportPanel.tsx:112`                                             | `Import fehlgeschlagen`                                                                                         |
| `ImportPanel.tsx:137-138`                                         | `… importiert · … Duplikate übersprungen · … wiederhergestellt · … fehlerhaft` (JSX-concatenated)               |
| `ImportPanel.tsx:146,153`                                         | `Diese Datei wurde bereits einmal hochgeladen.`, `Nicht importierte Zeilen`                                     |
| `TransactionList.tsx:102`                                         | aria-label/title `vorgemerkt` (same word as `budgetsText().pendingHint`)                                        |
| `index.html:2,6`                                                  | `lang="en"`, `<title>Household Budget`                                                                          |

Error strings from the API that are not coded (`client.ts:64,77-79`) reach the UI as raw
`Error.message` (`AccountPage.tsx:62`, `RulesPage.tsx:127`, `BudgetsPage.tsx:41`).

### 4. Locale-bound formatting

- `format.ts:1` `CURRENCY = Intl.NumberFormat('de-DE', EUR)`; `:4` `DATE` (`dd.mm.yyyy`);
  `:34` `MONTH` (`September 2025` / `Dezember 2024`). All module-level constants; the exported
  `formatAmount`, `formatBookingDate`, `formatMonth` take no locale.
- `BudgetField.tsx:23` has its own `EUROS = Intl.NumberFormat('de-DE', …)`, and the budget input
  error text asks for `700,50` in both locales (`budgets.ts:172,179`).
- Consumers: `TransactionList.tsx:95,128`, `BudgetTable.tsx:119,177,195,261`,
  `SpendingChart.tsx:32,123`, `TransactionFilters.tsx:65`, `BudgetsPage.tsx:337`, `budgets.ts`.
- Domain field names from the bank CSV (`Betrag`, `Buchungstag`) appear inside English error
  sentences on purpose — they are column names of the file (`importErrors.test.ts:21`).

### 5. Theme and colour scheme

- `theme.ts:3-14`: `createTheme({ colorSchemes: { light: true, dark: true }, shape: { borderRadius: 10 }, typography: { fontFamily: system-ui… } })`.
  No `cssVariables` option, no `defaultColorScheme`, no custom palette.
- `main.tsx:15-22`: `StrictMode > ThemeProvider theme={theme} > CssBaseline + App`. MUI 9.4.0,
  `@mui/x-charts` 9.13.0 (installed versions).
- No `useColorScheme`, `useMediaQuery`, `matchMedia`, `prefers-color-scheme` or `localStorage` in
  `src/`.
- Colour usage in pages is token-only: `Nav.tsx:33` (`primary.main` / `text.secondary`),
  `TransactionFilters.tsx:126` (`color="warning"` chip), `BudgetTable.tsx:151,220`
  (`text.secondary`, `error.main` when over), `TransactionList.tsx:125` (`success.main` for
  income), `ImportPanel.tsx:75` (`primary.main` / `divider` border), `CategoryCell.tsx:45,95`
  (`text.disabled`), plus `color="text.secondary"` Typography in several pages.
- `SpendingChart.tsx:46-48` documents that colours come from the palette "so the chart follows the
  colour scheme the rest of the page is in"; series colours are `primary.main`, `primary.light`,
  `text.disabled` (`:79,87,97`).

### 6. Layout where header controls sit today

Each page renders its own header — there is no shared layout component:

- `AccountPage.tsx:202-224`: row with `h1 + <Nav/>` on the left, `<AccountSelect>` on the right
  (`justifyContent: 'space-between'`).
- `RulesPage.tsx:191-196`, `BudgetsPage.tsx:291-296`: `h1 + <Nav/>` only.
- `Nav.tsx:12-22`: three `NavLink`s in a `Stack`.

### 7. Tests that depend on the language or theme

- Unit tests render pages without a `ThemeProvider` (`AccountPage.test.tsx:83`,
  `BudgetsPage.test.tsx:133`); `test/setup.ts` only loads jest-dom.
- Playwright specs locate elements by German text: occurrences per spec —
  `monthly-budgets` 24, `rules` 18, `transactions` 14, `monthly-totals` 5, `import` 4
  (`smoke`, `security` 0).
- `transactions.test.ts:34-38` guards that the category filter's name differs from the per-row
  `Kategorie` combobox, because the e2e locators would otherwise collide.

## Code References

- `apps/web/src/i18n/importErrors.ts:14` — `export type Locale = 'de' | 'en'`
- `apps/web/src/i18n/rules.ts:11-18` — doc comment: no locale state, "a switcher is a feature this app has not asked for"
- `apps/web/src/i18n/rules.ts:136`, `transactions.ts:77`, `budgets.ts:87` — text getters, `'de'` default
- `apps/web/src/format.ts:1-60` — `de-DE` Intl formatters
- `apps/web/src/pages/BudgetField.tsx:23` — second `de-DE` number formatter
- `apps/web/src/theme.ts:3-14` — theme with both colour schemes declared
- `apps/web/src/main.tsx:15-22` — provider tree
- `apps/web/src/pages/SpendingChart.tsx:56-97` — chart colours from `useTheme()`
- `apps/web/src/pages/ImportPanel.tsx:87-153` — largest block of inline German
- `apps/web/src/pages/AccountPage.tsx:202-224,300-335` — header layout; new-account form text
- `apps/web/index.html:2` — `lang="en"`
- `docs/plans/02-categorization-rules.md:116-121` — decision 11: no switcher / context / hook

## Architecture Documentation

- **Wording is data, keyed by locale, and tested for completeness.** Core returns codes; the web
  app owns sentences (`importErrors.ts:7-13`). Every new text module followed the same
  `Record<Locale, …>` + default-parameter shape, reusing the one `Locale` type.
- **Sentences over fragments.** Anything combining numbers and words is a function per locale, so
  zero/empty/loading variants are separate sentences (`describeUncategorized(0)`,
  `describeMonthTotal(…, { limitsLoading })`).
- **Formatting is German regardless of wording.** Amounts and dates go through `de-DE` in both
  locales; tests pin `€` after the number and comma decimals in English sentences too.
- **Theme is static.** One `createTheme` object with both schemes enabled; which one renders is
  left to MUI's default. Components use palette tokens only, so nothing in `pages/` names a
  concrete colour.
- **No shared app shell.** Header (title + nav) is duplicated per page; `Nav` is the only shared
  header piece.

## Open Questions

- Which scheme MUI 9 renders with `colorSchemes: { light, dark }` and no `cssVariables` /
  `defaultColorScheme` — light only, or following the OS — was not verified in a running browser.
- Whether dates/amounts should follow the chosen language (`en-GB`/`en-US`) or stay `de-DE` is not
  addressed anywhere in `docs/`; current tests assert `de-DE` output in English sentences.
- `lang="en"` in `index.html` while all default text is German — no doc explains it.
- The Playwright specs' dependence on German text implies they assume the German default; no
  spec sets a locale.
