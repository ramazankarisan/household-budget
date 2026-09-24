---
date: 2026-09-24T20:07:19Z
git_commit: f5d216831d22ae3ddcf3e367ffa12f7ec5242077
branch: main
topic: 'A German/English language switch and a light/dark switch in the shared header of apps/web'
tags: [plan, apps-web, i18n, i18next, theming, mui, color-scheme, e2e]
status: implemented
---

# PLAN: Language switch (DE/EN) and light/dark switch

Two controls in one shared header: `[DE|EN]` switches every word the UI shows between German and
English, and a 🌙/☀ button switches the colour scheme. Both choices survive a reload. Only
`apps/web` changes — no API, no core, no database.

[docs/research/05-language-and-color-scheme.md](../research/05-language-and-color-scheme.md) is
the authority for the current state (every call site, every inline string, the theme wiring) — do
not re-derive it.

**This reverses decision 11 of
[plan 02](02-categorization-rules.md)** ("No locale switcher, no context, no hook"). The wording
that decision produced is not thrown away: every German and English string in `src/i18n/*.ts`
moves verbatim into the new resource files.

## Acceptance Criteria

- [x] All three pages (`/`, `/rules`, `/budgets`) render the same header: `Household Budget`, the
      three nav links, a `DE|EN` toggle and a light/dark icon button, top right.
- [x] Choosing `EN` switches every visible word immediately, without a reload: headings, labels,
      buttons, placeholders, empty states, validation and import errors, the apply summary, chart
      caption and series, accessible names, and month names (`Dezember 2024` ↔
      `December 2024`).
- [x] Amounts and dates stay `de-DE` in both languages: `-832,90 €`, `22.09.2025`.
- [x] The language survives a reload (`localStorage['hb-locale']`); a first visit is German;
      `<html lang>` is `de` or `en` to match.
- [x] The theme button flips light ↔ dark; the choice survives a reload (MUI's own
      `localStorage['mui-mode']`); a first visit follows the OS.
- [ ] Tables, chips, alerts and the chart are legible in dark mode (palette tokens only).
- [x] An English key missing or misspelled fails `pnpm typecheck`; `t('no.such.key')` fails it too.
- [x] Every existing Playwright spec passes unchanged (German default); a new
      `e2e/preferences.spec.ts` covers both switches and their persistence.
- [x] `pnpm check:all` passes.

## Technical Key Decisions and Tradeoffs

1. **Amounts and dates are `de-DE` in both languages; month names follow the language.**
   - Why: the data is Sparkasse EUR statements — a date should read as the statement prints it.
     `BudgetField` parses `700,50`; switching the number format would mean switching the parser.
     A month name is a word, not a number format.
   - Impact: `formatAmount`, `formatBookingDate` and `BudgetField`'s `EUROS` are untouched.
     `formatMonth(month, locale)` gains a parameter and uses `de-DE` / `en-GB` (`en-GB` gives
     `September 2025`, day-first where it matters).

2. **i18next 26 + react-i18next 17** replace the hand-written `Record<Locale, …>` modules.
   - Why: user choice. Interpolation and a language-change event come built in, and
     `useTranslation()` re-renders every consumer on a switch — which a default parameter cannot.
   - Impact: new dependencies `i18next@^26.4.2`, `react-i18next@^17.0.14` (both peer on TS
     `^5 || ^6 || ^7`, React `>=16.8`). pnpm 12 quarantines very recent releases; if
     `pnpm add` refuses 17.0.15 (published 2026-09-21) take `17.0.14` rather than adding a
     `minimumReleaseAgeExclude` entry. `src/i18n/` is deleted by the end of phase 3.

3. **Resources are typed TypeScript objects, not JSON.**
   - Why: a missing English key is a compile error, not a runtime `"rules.addRule"` on screen;
     no loader, so `init` is synchronous — no flash, no async in tests.
   - Impact: `src/locales/de.ts` is the source shape; `en.ts` is typed `Messages<typeof de>`
     (same keys, `string` leaves). `src/locales/i18next.d.ts` declares `CustomTypeOptions`, so
     `t()` keys are checked. The `leaves()` walker tests are replaced by the type plus one
     runtime parity test.

4. **Keys are grouped the way the old modules were**: `common` (app title, nav, account,
   import panel), `transactions`, `rules`, `budgets`, `errors` (`row`, `file`, `rule`,
   `budget`). One namespace (`translation`), nested keys: `t('rules.addRule')`.
   - Why: the grouping is already the one the tests and plans talk about; one namespace keeps
     `useTranslation()` argument-free.

5. **Wording moves verbatim — no new plurals, no re-wording.**
   - Why: this is a mechanism change. `2 Regeln, 47 Umsätze` stays exactly as it is; the
     existing sentence tests carry over with their literal expectations, which is how we know
     nothing drifted.
   - Impact: sentences become i18next interpolation (`{{count}} ohne Kategorie`). Amounts are
     formatted by `formatAmount` **before** interpolation, never by i18next.
     `interpolation.escapeValue: false` (React escapes) so `„Wohnen“` and `"müller"` render as
     typed.

6. **Sentence helpers stay functions, and take `t`.** `describeMonthTotal`, `describeRemaining`,
   `describeUncategorized`, `describeApplySummary`, `describeRowError`, `describeFileError`,
   `describeRuleErrors`, `describeBudgetErrors`, … keep their names and shapes, with the trailing
   `locale` parameter replaced by a leading `t: TFunction`. They move to
   `src/locales/sentences.ts`.
   - Why: they encode logic (zero is a different sentence, loading drops the comparison, unknown
     file codes still show) that the old tests pin and that does not belong inside JSX.
   - Impact: tests call them with `i18n.getFixedT('de')` / `getFixedT('en')`.

7. **Language state is i18next's own.** `src/locales/i18n.ts` initialises with
   `lng: storedLocale() ?? 'de'`, `fallbackLng: 'de'`, `supportedLngs: ['de', 'en']`, and on
   `languageChanged` writes `localStorage['hb-locale']` (in `try/catch`) and sets
   `document.documentElement.lang`. `index.html` changes to `lang="de"`.
   - Why: no context of our own to keep in sync with i18next's; the default stays German so
     every existing spec runs as it does today.

8. **Theme: two-state toggle on MUI's `useColorScheme()`.** The button shows the scheme a click
   goes _to_ (🌙 in light, ☀ in dark), calls `setMode('light' | 'dark')`, and renders nothing
   until `mode` is known. The effective scheme is `mode === 'system' ? systemMode : mode`.
   - Why: user choice (no "System" entry). `theme.ts` already declares both schemes, so MUI's
     `CssVarsProvider` is what renders today (`@mui/material/styles/ThemeProvider.js:24-48`),
     with `defaultMode: 'system'` and storage in `mui-mode` — nothing to add but the button.
   - Impact: `theme.ts` and `main.tsx` are unchanged for the theme. `mode` is `undefined` on the
     first client render even inside the provider (`isClient` is set in an effect,
     `@mui/system/cssVars/useCurrentColorScheme.js:83-87,232`), and the first paint uses the light
     scheme — a reload in dark mode can flash light for a frame, which is accepted (no
     `InitColorSchemeScript`; the page has no content before React renders). Outside a `ThemeProvider`
     (the existing page tests) `useColorScheme()` returns a no-op context with `mode: undefined`
     (`@mui/system/cssVars/createCssVarsProvider.js:37-51`), so the button renders nothing there
     and those tests are unaffected.

9. **One shared `AppHeader`**; `AccountSelect` moves out of the header row to its own row on
   `AccountPage`.
   - Why: the three pages each hand-build the header today; a control that appears on one page
     and not another would push the toggles around.

10. **Icons from `@mui/icons-material@^9.4.0`** (`DarkMode`, `LightMode`), imported by path
    (`@mui/icons-material/DarkMode`) so only two icons are bundled. Its peer is
    `@mui/material ^9.4.0`, which is installed.

11. **A message already on screen keeps the language it was made in.** The undo snackbar
    (`RulesPage` `offerUndo`), page error alerts, and the import-failed message are sentences
    stored in state; switching language does not rewrite them. Everything derived from props or
    data at render re-translates.
    - Why: they are transient (six seconds, or until the next action); storing keys + params
      instead is a refactor of three state machines for a moment nobody will notice.

12. **`DE|EN` is an MUI `ToggleButtonGroup`** (`exclusive`, `size="small"`), with an
    accessible group name `Sprache` / `Language`. Deselecting the active button is ignored.

## Current State

```
main.tsx
 └─ ThemeProvider(theme: colorSchemes light+dark)  ← CssVarsProvider, mode 'system', 'mui-mode'
     └─ CssBaseline
     └─ App (BrowserRouter)
         ├─ /         AccountPage  ┐
         ├─ /rules    RulesPage    ├─ each: <h1>Household Budget</h1> + <Nav/> (hand-built)
         └─ /budgets  BudgetsPage  ┘   AccountPage also puts <AccountSelect> on the right

pages ──rulesText() / describeX(v)──▶ src/i18n/{importErrors,rules,transactions,budgets}.ts
                                      Record<'de'|'en', …>, locale = 'de' default, never passed
~15 German literals inline: ImportPanel, AccountPage, AccountSelect, TransactionList
format.ts: de-DE for amount, date, month name     index.html lang="en"
```

Header today (`AccountPage.tsx:202-224`):

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Household Budget   Umsätze  Regeln  Budgets        [Konto ▾ Giro · DE89…] │
└──────────────────────────────────────────────────────────────────────────┘
/rules and /budgets: the same without the account select.
```

## Desired End State

```
main.tsx
 ├─ import './locales/i18n'        ← synchronous init; lng from 'hb-locale' ?? 'de'
 └─ ThemeProvider(theme)           ← unchanged
     └─ App
         ├─ AccountPage ┐
         ├─ RulesPage   ├─ <AppHeader/>  = title + <Nav/> + <LanguageToggle/> + <ThemeToggle/>
         └─ BudgetsPage ┘

components ──useTranslation() → t──▶ t('rules.addRule')
           ──describeX(t, v)────────▶ src/locales/sentences.ts ──t()──▶ src/locales/{de,en}.ts
i18next 'languageChanged' ─▶ localStorage['hb-locale'], <html lang>
ThemeToggle ─▶ useColorScheme().setMode('light'|'dark') ─▶ MUI stores 'mui-mode'
```

Header, every page, German:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Household Budget   Umsätze  Regeln  Budgets                [DE|EN]  [🌙] │
└──────────────────────────────────────────────────────────────────────────┘
AccountPage only, next row:
  [Konto ▾ Giro · DE89…]
```

English, dark:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Household Budget   Transactions  Rules  Budgets            [DE|EN]  [☀]  │
└──────────────────────────────────────────────────────────────────────────┘
  [Account ▾ Giro · DE89…]
  ┌ Import CSV ───────────────────────────────────────────────────────────┐
  │  Drag a Sparkasse export here or click to choose                      │
  │  Date        Payee          Purpose         Category        Amount   │
  │  22.09.2025  Müller GmbH    Miete 09/2025   Housing ▾      -832,90 € │
  └──────────────────────────────────────────────────────────────────────┘
```

Narrow window: the header row already wraps (`flexWrap: 'wrap'`); the toggles wrap to the next
line as a group, right-aligned.

## Abstractions and Code Reuse

- `apps/web/src/locales/` (new)
  - `de.ts` — `export const de = { common, transactions, rules, budgets, errors }`; every
    string from `src/i18n/*.ts` verbatim, plus the inline literals from research §3
  - `en.ts` — `export const en: Messages<typeof de>`; every English string verbatim
  - `messages.ts` — `type Messages<T>` (same keys, `string` leaves); `type Locale = 'de' | 'en'`
    (moved from `i18n/importErrors.ts:14`); `LOCALES`
  - `i18n.ts` — `i18next.use(initReactI18next).init(…)`, `LOCALE_STORAGE_KEY = 'hb-locale'`,
    `storedLocale()`, the `languageChanged` listener; default export the instance
  - `i18next.d.ts` — `CustomTypeOptions { defaultNS: 'translation'; resources: { translation: typeof de } }`
  - `sentences.ts` — the `describe*` helpers from `src/i18n/*.ts`, `(t, …)` first
  - `locales.test.ts` — de/en key parity, no empty leaf
  - `sentences.test.ts` — the four old `src/i18n/*.test.ts` files, ported
- `apps/web/src/pages/`
  - `AppHeader.tsx` (new) — title + `Nav` + `LanguageToggle` + `ThemeToggle`
  - `LanguageToggle.tsx` (new) — `ToggleButtonGroup`, `i18n.changeLanguage`
  - `ThemeToggle.tsx` (new) — `IconButton` + `useColorScheme`
  - `Nav.tsx` — `t('common.nav.*')`
  - every page/component listed in research §2 and §3 — `useTranslation()` instead of
    `xText()`, `describeX(t, …)` instead of `describeX(…)`
- `apps/web/src/format.ts` — `formatMonth(month, locale)`
- `apps/web/src/test/setup.ts` — import `../locales/i18n`; `afterEach` resets to `de` and clears
  `localStorage`
- Deleted by the end: `apps/web/src/i18n/` (all eight files)

Reused as they are: `theme.ts`, `main.tsx`'s provider tree, `formatAmount`,
`formatBookingDate`, `BudgetField`'s parser, every palette token.

## Logging & Observability

None. i18next's `debug` stays off; a missing key cannot reach runtime (decision 3).

## Implementation

### Phase 1: Shared header and the light/dark switch

Dependencies: None.

The header becomes one component, and it gets the theme button. No wording changes yet — the
title and nav read their text exactly as today.

**Tasks**:

- [x] `pnpm --filter @household-budget/web add @mui/icons-material@^9.4.0`
- [x] Add `apps/web/src/pages/ThemeToggle.tsx`:
  ```tsx
  export function ThemeToggle({ label }: { readonly label: { toDark: string; toLight: string } }) {
    const { mode, systemMode, setMode } = useColorScheme();
    if (mode === undefined) return null; // before MUI's mount effect, or no provider
    const dark = (mode === 'system' ? systemMode : mode) === 'dark';
    return (
      <IconButton
        aria-label={dark ? label.toLight : label.toDark}
        onClick={() => {
          setMode(dark ? 'light' : 'dark');
        }}
      >
        {dark ? <LightModeIcon /> : <DarkModeIcon />}
      </IconButton>
    );
  }
  ```
  The label is a prop in this phase (German literals `Helles Design` / `Dunkles Design` passed
  from `AppHeader`); phase 2 replaces the prop with `t()`.
- [x] Add `apps/web/src/pages/AppHeader.tsx` — the title + nav row from `AccountPage.tsx:202-213`:
      `h1 Household Budget` + `<Nav/>` on the left, `<ThemeToggle/>` right
      (`justifyContent: 'space-between'`, `flexWrap: 'wrap'`).
- [x] `AccountPage.tsx` — replace the header block (`:202-230`) with `<AppHeader/>`; render `AccountSelect`
      in its own row directly under it (same condition as today:
      `accounts !== undefined && accounts.length > 0`).
- [x] `RulesPage.tsx:191-196`, `BudgetsPage.tsx:291-296` — replace with `<AppHeader/>`.
- [x] Add `apps/web/src/pages/ThemeToggle.test.tsx`, rendered inside
      `<ThemeProvider theme={theme}>` with a `window.matchMedia` stub returning light, and
      `localStorage.clear()` in `beforeEach` (the cases write `mui-mode`):
      shows the dark-mode button first; a click switches the accessible name to the light-mode one
      and writes `localStorage['mui-mode'] === 'dark'`; a second click writes `light`; renders
      nothing outside a `ThemeProvider`.
- [x] Add `apps/web/src/pages/AppHeader.test.tsx`, rendered inside `<ThemeProvider theme={theme}>`
      (else `ThemeToggle` renders nothing) and a `MemoryRouter` (`Nav` uses `NavLink`) — title,
      three nav links, the theme button.
- [x] Add `apps/web/e2e/preferences.spec.ts` with a `theme` test: page loads light
      (`colorScheme: 'light'` in `test.use`); `body` background is `rgb(255, 255, 255)`; click
      `Dunkles Design`; background is `rgb(18, 18, 18)`; reload; still dark; the button is now
      `Helles Design`. Assertions use auto-retrying `expect(page.locator('body')).toHaveCSS(…)`
      (first paint after reload is light for a frame, decision 8). Run it on `/rules` too, to prove
      the header is shared.
- [x] Same spec, `theme follows the OS on a first visit`: `test.use({ colorScheme: 'dark' })`,
      empty storage, `body` background is `rgb(18, 18, 18)` (`#121212`, MUI's dark
      `background.default`) and the button reads `Helles Design`.

**Automated Verification**:

- [x] `pnpm --filter @household-budget/web exec vitest run src/pages/ThemeToggle.test.tsx src/pages/AppHeader.test.tsx` passes
- [x] Existing `AccountPage.test.tsx`, `RulesPage.test.tsx`, `BudgetsPage.test.tsx` pass unchanged
- [x] `pnpm check` passes
- [x] `pnpm check:all` passes (every existing spec plus `preferences.spec.ts` › theme)

**Manual Verification**:

- [ ] In dark mode, `/`, `/rules` and `/budgets` are legible: table text, the warning chip, the
      over-budget red, the income green, the import drop-zone border, the chart bars and axes.

### Phase 2: i18next, the language switch, and the transactions page

Dependencies: Phase 1.

The mechanism lands, the `DE|EN` toggle lands, and everything reachable from `/` speaks both
languages. `/rules` and `/budgets` still render German through the old modules until phase 3 —
their text is not wired to the switch yet.

**Tasks**:

- [x] `pnpm --filter @household-budget/web add i18next@^26.4.2 react-i18next@^17.0.14`
      (see decision 2 on quarantine).
- [x] Add `src/locales/messages.ts` — `Locale`, `LOCALES`, `Messages<T>`, and
      `toLocale(lng: string | undefined): Locale` (`'en'` → `'en'`, anything else → `'de'`).
      i18next types `language` / `resolvedLanguage` as `string | undefined`, so every place that
      hands one to a `Locale` parameter goes through it (`storedLocale()`, `LanguageToggle`,
      `formatMonth` callers):
  ```ts
  export type Messages<T> = {
    readonly [K in keyof T]: T[K] extends string ? string : Messages<T[K]>;
  };
  ```
- [x] Add `src/locales/de.ts` and `src/locales/en.ts` with, for this phase:
  - `common`: `appTitle`, `nav.{transactions,rules,budgets}`, `theme.{toDark,toLight}`,
    `language.{label,de,en}`, `account.{select,create,createHint,iban,name,submit}`,
    `import.{title,uploading,dropHint,chooseFile,failed,alreadyUploaded,notImported,summary}`
    — `summary` is `{{imported}} importiert · {{skipped}} Duplikate übersprungen · {{restored}} wiederhergestellt · {{failed}} fehlerhaft`
    and its English counterpart, written now (the inline one has none).
  - `transactions`: every key of `i18n/transactions.ts`, verbatim; `uncategorizedCount` and
    `allCategorized` for `describeUncategorized`.
  - `errors.row`, `errors.file`, `errors.lineLabel`, `errors.unknownFile` from
    `i18n/importErrors.ts`, verbatim.
  - `transactions.pendingHint` — new key, `vorgemerkt` / `pending` (the inline aria-label in
    `TransactionList.tsx:102` had no English).
  - `rules.category`, `rules.uncategorized`, `rules.clearCategory`, `rules.lockedHint`,
    `rules.pendingHint` — what `CategoryCell` reads (`:33`, `:71` for the combobox name); the
    rest of `rules` comes in phase 3.
  - English for everything above, including the literals that had none:
    `Konto`→`Account`, `Konto anlegen`→`Create account`, `Bezeichnung`→`Name`,
    `Anlegen`→`Create`, `CSV importieren`→`Import CSV`, `Import läuft…`→`Importing…`,
    `Sparkasse-Export hierher ziehen oder klicken zum Auswählen`→
    `Drag a Sparkasse export here or click to choose`, `CSV-Datei auswählen`→`Choose CSV file`,
    `Import fehlgeschlagen`→`Import failed`,
    `Diese Datei wurde bereits einmal hochgeladen.`→`This file has already been uploaded.`,
    `Nicht importierte Zeilen`→`Rows not imported`, the account-form paragraph →
    `An import always belongs to an account you choose first — never to one guessed from the file.`,
    `vorgemerkt`→`pending`, `Sprache`→`Language`, `Dunkles Design`→`Dark theme`,
    `Helles Design`→`Light theme`.
- [x] Add `src/locales/i18next.d.ts` (`CustomTypeOptions`, decision 3).
- [x] Add `src/locales/i18n.ts` (decision 7):
  ```ts
  export const LOCALE_STORAGE_KEY = 'hb-locale';
  export function storedLocale(): Locale | undefined {
    /* try/catch localStorage, validate */
  }
  void i18next.use(initReactI18next).init({
    resources: { de: { translation: de }, en: { translation: en } },
    lng: storedLocale() ?? 'de',
    fallbackLng: 'de',
    supportedLngs: LOCALES,
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  i18next.on('languageChanged', (lng) => {
    /* persist; document.documentElement.lang = lng */
  });
  document.documentElement.lang = i18next.language;
  ```
- [x] `src/main.tsx` — `import './locales/i18n';` before `App`.
- [x] `index.html` — `lang="de"`.
- [x] `src/test/setup.ts` — `import '../locales/i18n';` and
      `afterEach(async () => { await i18n.changeLanguage('de'); localStorage.clear(); })`.
- [x] Add `src/locales/sentences.ts` with `describeUncategorized(t, count)`,
      `describeRowError(t, error)`, `describeFileError(t, code, columns)` — logic copied from
      `i18n/transactions.ts:81-95` and `i18n/importErrors.ts:33-94`, text via `t()`.
- [x] Add `src/pages/LanguageToggle.tsx` (decision 12): value `i18n.resolvedLanguage`,
      `onChange` ignores `null`, calls `i18n.changeLanguage`.
- [x] `AppHeader.tsx` — `t('common.appTitle')`; add `<LanguageToggle/>` before `<ThemeToggle/>`;
      `ThemeToggle` reads its labels with `t('common.theme.*')` and drops the prop.
- [x] `Nav.tsx` — `t('common.nav.*')`.
- [x] `AccountPage.tsx`, `AccountSelect.tsx`, `ImportPanel.tsx`, `TransactionList.tsx`,
      `TransactionFilters.tsx`, `CategoryCell.tsx` — `useTranslation()`; every literal from
      research §3 and every `transactionsText()` / `describeUncategorized` / `describeRowError` /
      `describeFileError` / `rulesText()` call in these files goes through `t` or `sentences.ts`.
      `ImportPanel.tsx:26` `describeFailure` is module-level and gains a `t` parameter.
      `TransactionList`'s `vorgemerkt` uses `t('transactions.pendingHint')` (same word as
      `budgets.pendingHint` in phase 3).
- [x] `format.ts` — `formatMonth(month: string, locale: Locale = 'de')` with one cached
      `Intl.DateTimeFormat` per locale (`de-DE`, `en-GB`). Callers pass
      `toLocale(i18n.resolvedLanguage)`:
      `TransactionFilters.tsx:65` now, `BudgetsPage.tsx:337` in phase 3.
- [x] Delete `src/i18n/importErrors.ts` and `importErrors.test.ts`. Repoint
      `import { type Locale } from './importErrors'` to `'../locales/messages'` in the five files
      that still have it: `i18n/rules.ts:9`, `i18n/budgets.ts:8`, `i18n/rules.test.ts:4`,
      `i18n/budgets.test.ts:12`, and `i18n/transactions.ts:1`.
- [x] **Keep** `src/i18n/transactions.ts` and its test until phase 3: the not-yet-migrated
      `BudgetsPage.tsx:32` (`listText.noTransactions`, `.month`), `BudgetTable.tsx:18` and
      `SpendingChart.tsx:9` (`.uncategorized`) still import it. Its wording is duplicated in
      `de.ts`/`en.ts` for one phase.
- [x] Add `src/locales/locales.test.ts` — every leaf path of `de` exists in `en` and vice versa;
      no leaf is `''`. Plus two compile-time cases that `pnpm typecheck` enforces:
  ```ts
  // @ts-expect-error — a translation missing a key is not a Messages<typeof de>
  const partial: Messages<typeof de> = { ...en, common: { appTitle: 'x' } };
  // @ts-expect-error — keys are checked
  i18n.t('no.such.key');
  ```
- [x] Add `src/locales/sentences.test.ts` — the `describeUncategorized`, `describeRowError`,
      `describeFileError` cases from the deleted tests, same literals, via `getFixedT('de'|'en')`.
- [x] `format.test.ts` — `formatMonth('2024-12', 'en')` is `December 2024`; the German cases
      unchanged.
- [x] Add `src/pages/LanguageToggle.test.tsx` — defaults to `DE` pressed; clicking `EN` sets
      `i18n.language` to `en`, `localStorage['hb-locale']` to `en` and `<html lang>` to `en`;
      clicking the pressed button again keeps `en`.
- [x] `AccountPage.test.tsx` — one new case: after `i18n.changeLanguage('en')`, the filter
      combobox is `Month`, the column header is `Amount`, the import heading is `Import CSV`.
- [x] `e2e/preferences.spec.ts` — `language` test: `/` shows `Umsätze` and `CSV importieren`;
      click `EN`; `Transactions` and `Import CSV` show without navigation; `<html lang="en">`;
      a booking date still reads `22.09.2025`-style and an amount `…,.. €`; reload; still English;
      click `DE`; German again.

**Automated Verification**:

- [x] `pnpm --filter @household-budget/web exec vitest run src/locales src/pages/LanguageToggle.test.tsx src/format.test.ts` passes
- [x] `pnpm typecheck` passes, which proves both `@ts-expect-error` lines in `locales.test.ts`
      still raise errors (an unused `@ts-expect-error` is itself an error)
- [x] Existing page tests pass with German expectations unchanged
- [x] `pnpm check` passes
- [x] `pnpm check:all` passes (existing specs in German, `preferences.spec.ts` › language)

**Manual Verification**:

- [ ] On `/` in English: create an account, import `fixtures/sparkasse-camt-18-bad-rows.csv`,
      and read the result — summary line, `Rows not imported` list and row errors are English;
      the file-level error for `fixtures/sparkasse-camt-malformed.csv` is English.

### Phase 3: Rules and budgets in both languages

Dependencies: Phase 2.

The remaining two pages switch; `src/i18n/` goes away; the docs catch up.

**Tasks**:

- [x] `de.ts` / `en.ts` — add the rest of `rules` (every key of `i18n/rules.ts`: labels,
      `fields.*`, `operators.*`, `categoryInUse`, `categoryDeleted`, `ruleDeleted`,
      `applySummary`), all of `budgets` (every key of `i18n/budgets.ts`, `columns.*`,
      `monthTotal.{of,pending,spent}`), `errors.rule.*`, `errors.budget.*` — verbatim.
- [x] `sentences.ts` — add `describeRuleError(s)`, `describeCategoryInUse`,
      `describeCategoryDeleted`, `describeRuleDeleted`, `describeApplySummary`,
      `describeOverBy`, `describeLeft`, `describeRemaining`, `describeMonthTotal`,
      `describeBudgetError(s)`, each `(t, …)`; logic copied from `i18n/rules.ts:140-242` and
      `i18n/budgets.ts:91-199`. `describeMonthTotal` keeps `{ limitsLoading }`.
- [x] `RulesPage.tsx` (four components at `:108`, `:296`, `:433`, `:585`), `BudgetsPage.tsx`
      (`messageOf` takes `t`), `BudgetTable.tsx`, `BudgetField.tsx`, `SpendingChart.tsx` —
      `useTranslation()` / `sentences.ts`. `BudgetsPage.tsx:337` passes the language to
      `formatMonth`. `SpendingChart` series labels and `aria-label` come from `t` so the chart
      legend switches too.
- [x] `BudgetsPage.tsx:92,308,328`, `BudgetTable.tsx:257`, `SpendingChart.tsx:69` —
      `transactionsText()` → `t('transactions.*')`.
- [x] Delete `src/i18n/` entirely (`rules.ts`, `rules.test.ts`, `budgets.ts`,
      `budgets.test.ts`, `transactions.ts`, `transactions.test.ts`).
- [x] Update the comments that still name `src/i18n`: `api/client.ts:31`, `ImportPanel.tsx:25`
      → `src/locales`.
- [x] `sentences.test.ts` — port every case from the deleted `rules.test.ts` and
      `budgets.test.ts`, literals unchanged (`'412 geprüft · 318 zugeordnet · 4 gelöscht · 11 manuell'`,
      `'2.385,74 € von 700,00 € · 1.685,74 € über'`, `'175,07 € over'`, …).
- [x] `RulesPage.test.tsx`, `BudgetsPage.test.tsx` — one English case each: after
      `changeLanguage('en')` the rules page shows `Apply rules` and the budgets table header
      `Remaining`.
- [x] `e2e/preferences.spec.ts` — extend `language`: in English, `/rules` shows `Add rule` and
      operator `contains`; `/budgets` shows `Spending by category` and a month total with `of`.
      (Month names are covered by `format.test.ts` — every e2e fixture month is `September 2025`,
      identical in both languages.)
- [x] Write the plan's "Implementation Notes" with anything that departed from this plan.
- [x] `docs/plans/02-categorization-rules.md` decision 11 — append one line:
      `Superseded by [plan 07](07-language-and-theme-switch.md): UI text now lives in src/locales via i18next, with a switch.`
- [x] `CLAUDE.md` — under **Invariants**, add:
      `- UI text lives in apps/web/src/locales/{de,en}.ts and nowhere else; en is typed against de, so a missing translation fails typecheck. Amounts and dates are de-DE in both languages. [plan 07](docs/plans/07-language-and-theme-switch.md)`
- [x] Set this plan's `status: implemented`.

**Automated Verification**:

- [x] `test ! -d apps/web/src/i18n`
- [x] `grep -rnE "[äöüÄÖÜß]" apps/web/src --include=*.tsx | grep -v "\.test\."` prints only
      comments
- [x] `grep -rnE '(label|aria-label|title|placeholder)="[A-Za-z]' apps/web/src --include=*.tsx | grep -v "\.test\."`
      prints nothing (catches `Konto`, `Bezeichnung`, `vorgemerkt`, which have no umlaut)
- [x] `grep -rn "Household Budget\|Anlegen\|vorgemerkt" apps/web/src/pages --include=*.tsx | grep -v "\.test\."`
      prints nothing
- [x] `pnpm --filter @household-budget/web exec vitest run src/locales` passes
- [x] `pnpm check` passes
- [x] `pnpm check:all` passes

**Manual Verification**:

- [ ] In English and dark mode, walk the product end to end: create a category and a rule, apply
      rules (summary line English), delete the category that is in use (refusal English), undo a
      delete, set and clear a budget, enter `-5` (validation English), read the chart legend.
- [ ] Switch language while the undo snackbar, a refused-delete warning or an error alert is
      open: each switches with the rest of the page (decision 11 reversed in review, see
      Implementation Notes).

## Implementation Notes

- **`react-i18next` resolved to 17.0.15.** `pnpm add` did not quarantine it, so the range
  `^17.0.14` took the newest patch; no `minimumReleaseAgeExclude` entry was needed.
- **All of `de.ts` / `en.ts` and `sentences.ts` were written in phase 2**, rules and budgets
  included, rather than split across phases 2 and 3. Phase 3 only wired the components and
  ported the tests. `src/i18n/transactions.ts` therefore did not need its one-phase overlap
  for long, and all of `src/i18n/` went in phase 3 as planned.
- **Interpolation names are not `count`.** `{{uncategorized}} ohne Kategorie`,
  `… und {{notListed}} weitere`: i18next treats a `count` option as a plural lookup
  (`key_one` / `key_other`), and decision 5 rules out new plurals. A named variable keeps
  the sentence exactly as it was.
- **One inline string the research missed:** `ImportPanel`'s `… und {n} weitere` (failed rows
  beyond the API's cap). It is `common.import.notListed` / `… and {{notListed}} more`.
- **`nav` labels moved to `common.nav`**; `rulesText().navTransactions` / `navRules` and
  `budgetsText().navBudgets` have no counterpart under `rules` / `budgets`.
- **`BudgetsPage`'s `fail` words its error with `i18n.getFixedT(i18n.language)`, not `t`.**
  `fail` is a `useCallback` the loading effects depend on; `t` changes identity on a language
  switch, which would have re-run every load. The i18next instance is stable. The sentence is
  still in whatever language is current when the failure happens (decision 11).
- **`describeFileError` checks a code with `Object.hasOwn`**, so `toString` is an unknown code
  rather than a prototype function; a test pins it.
- **`AccountSelect` sits in a `Box`** under the header, so the column `Stack` does not stretch
  it across the page.
- **The e2e language test creates its own account and import when none exists**, the pattern
  `transactions.spec.ts` uses, so `preferences.spec.ts` runs on its own. Its `DE` / `EN`
  locators are `exact`: the uncategorized chip's name, `… zeigen`, contains `en`.
- **The two `grep` checks in phase 3 print comments only** — doc comments that quote German
  wording (`über`, `vorgemerkt`, `Empfänger and Zweck`). No rendered literal remains.

### After review (PR #17, `/code-review high`)

- **Decision 11 reversed: nothing stores a finished sentence.** Pages keep the cause
  (`{ cause }`), core's errors, or the counts in state, and word them at render. The snackbar
  keeps a `(t) => string`. An alert whose title switched while its body stayed German was a
  real defect, not a moment nobody would notice. This also makes the `i18n.getFixedT` note
  above moot: `BudgetsPage`'s `fail` is back to `setError({ cause })` with no dependencies.
- **`describeFailure(t, cause)` in `sentences.ts` is the one place a caught error becomes
  words.** Coded refusals the API sends (`TRANSACTION_PENDING`, `RULE_EXISTS`,
  `RULE_RESTORE_INVALID`, `FORBIDDEN_ORIGIN`) have wording under `errors.api`;
  `CATEGORY_IN_USE`, `RULE_INVALID` and `BUDGET_INVALID` are unpacked; an unknown code is
  quoted (`Anfrage abgelehnt (CODE)`); an uncoded failure is framed
  (`Anfrage fehlgeschlagen: …`). Before, `RULE_EXISTS` reached the alert as the bare code.
  `describeImportFailure` keeps the import's "file not readable (CODE)" fallback.
- **Decision 8's flash is gone:** `ThemeProvider noSsr` reads the stored scheme on the first
  render, so no light frame on a dark reload and no toggle popping in.
- **`errors.{row,file,rule,budget}` are `satisfies Record<Code, string>`**, so a code core
  adds without wording fails typecheck (the old `Record<…>` modules did this; the
  `Object.hasOwn` lookup alone had lost it for file codes).
- **Duplicate words merged** into `common.pending` (was `transactions.pendingHint`,
  `budgets.pendingHint`, `budgets.monthTotal.pending`) and `common.uncategorized` (was
  `transactions.uncategorized`, `rules.uncategorized`); the test that kept the copies equal is
  gone. `describeRuleErrors` / `describeBudgetErrors` share one `markFields`.
- **Not taken:** i18next plurals for `1 Regeln` / `1 duplicates` — decision 5 rules out new
  plurals, and those sentences carry several counts each, which one `count` cannot serve; a
  change of its own. Lifting `useTranslation()` out of per-row cells — its cost is one
  listener per row on a rare event, against threading `t` through every row's props.

## References

- [docs/research/05-language-and-color-scheme.md](../research/05-language-and-color-scheme.md) —
  current state, every call site and inline string
- [docs/plans/02-categorization-rules.md](02-categorization-rules.md) decision 11 — the decision
  this reverses
- `apps/web/src/i18n/*.ts` — the wording that moves verbatim
- `@mui/material/styles/ThemeProvider.d.ts:40-70` — `defaultMode: 'system'`, `modeStorageKey: 'mui-mode'`
- `@mui/system/cssVars/createCssVarsProvider.js:37-51` — `useColorScheme()` outside a provider
- i18next 26.4.2 / react-i18next 17.0.x — peer ranges verified with `npm view`
