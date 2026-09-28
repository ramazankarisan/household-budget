# DESIGN.md

The design rules for `apps/web`. Read before building or changing any UI. The reasoning and the
evaluation of the current UI are in
[docs/research/06-ui-design.md](docs/research/06-ui-design.md); this file is the rulebook.

Rules are written as **MUST** (a reviewer blocks on it), **SHOULD** (deviate only with a reason
in the PR), and **AVOID**.

---

## 1. Principles

1. **Answer first.** Every page opens with the answer to its question — "how is this month
   going", "what still needs sorting" — as a sentence or a large number, then the detail.
2. **Numbers are the interface.** Amounts are the most-read thing in the app. They get the best
   typography, the most consistent alignment, and never wrap.
3. **Calm by default, loud only on purpose.** Colour means something. Red is for _over budget_
   and _errors_ — never for ordinary spending.
4. **Honest about uncertainty.** Vorgemerkt is shown, labelled and never silently summed. Data
   still loading is shown as loading, not as zero or empty.
5. **Fast hands.** The frequent tasks — sorting transactions, stepping months, searching — work
   from the keyboard.
6. **Local and quiet.** No external fonts, CDNs, analytics or remote images. Everything ships in
   the bundle.

---

## 2. Tokens

All colours, sizes and radii come from the theme (`apps/web/src/theme.ts`). Pages MUST NOT
contain hex, `rgb()` or pixel font sizes; they use palette paths (`text.secondary`,
`status.over.main`) and theme spacing.

### 2.1 Colour — semantic roles

| Role             | Light     | Dark      | Use                                             |
| ---------------- | --------- | --------- | ----------------------------------------------- |
| `bg.canvas`      | `#F6F5F1` | `#0F1211` | Page background behind cards                    |
| `bg.surface`     | `#FFFFFF` | `#171B1A` | Cards, tables, sidebar                          |
| `bg.subtle`      | `#EFEDE7` | `#1E2321` | Hover, day headers, input fills                 |
| `border`         | `#E2DFD7` | `#2A302E` | Dividers and card edges (decorative, below 3:1) |
| `border.strong`  | `#878C89` | `#6A716E` | Input outlines, checkbox edges (≥ 3:1)          |
| `text.primary`   | `#1A1C1B` | `#ECEDEA` | Body, amounts                                   |
| `text.secondary` | `#5B605D` | `#A3AAA6` | Purpose line, labels, captions                  |
| `text.disabled`  | `#8E928F` | `#6E7572` | Placeholders only — never meaningful text       |
| `primary`        | `#0E5A4B` | `#62C7AE` | Actions, focus, active nav, selection           |
| `primary.soft`   | `#E1EFEA` | `#15302A` | Active nav background, selected row             |
| `status.income`  | `#1D7442` | `#5FCB8C` | Positive amounts (money in)                     |
| `status.ok`      | `#1D7442` | `#5FCB8C` | Budget bar < 85 %                               |
| `status.near`    | `#A15C00` | `#F0B24A` | Budget bar 85–100 %                             |
| `status.over`    | `#B42318` | `#F4776B` | Over budget, errors, destructive actions        |
| `status.pending` | `#4D5E80` | `#9DB0D6` | Vorgemerkt: hatch pattern, label                |

- Text on `bg.surface` and `bg.canvas` MUST meet WCAG 2.2 AA: 4.5:1 for body, 3:1 for large text
  (≥ 18.66 px bold / 24 px) and for non-text UI (bar fills, focus ring, input borders).
- Each `status.*` colour MUST pass 4.5:1 against `bg.surface` in its scheme, because it is used
  for text (`„1.282,90 € über"`).
- Soft backgrounds (`*.soft`) are for fills only; text on them uses the full-strength colour.

### 2.2 Colour — categories

Every category has one colour from this fixed palette, assigned in creation order and changeable
by the user. Stored as the index (`0`–`7`), never as a hex, so both schemes resolve it.

| #   | Name    | Light     | Dark      |
| --- | ------- | --------- | --------- |
| 0   | Blue    | `#2A78D6` | `#3987E5` |
| 1   | Orange  | `#EB6834` | `#D95926` |
| 2   | Aqua    | `#1BAF7A` | `#199E70` |
| 3   | Yellow  | `#EDA100` | `#C98500` |
| 4   | Magenta | `#E87BA4` | `#D55181` |
| 5   | Green   | `#008300` | `#008300` |
| 6   | Violet  | `#4A3AA7` | `#9085E9` |
| 7   | Brown   | `#A8641C` | `#C07A30` |

Validated with the `dataviz` skill's `validate_palette.js` against `bg.surface` in both schemes
(adjacent pairs): CVD ΔE ≥ 8.4, normal-vision ΔE ≥ 19.3. Slots 0–6 are that skill's reference
order; slot 7 replaces its red, which here would collide with `status.over`. In light mode Aqua,
Yellow and Magenta sit below 3:1 against the surface, which the next rule already covers: a
category colour never appears without its name.

- A category colour MUST always appear **with the category name** (pill, legend, row label). It is
  an index for the eye, not information on its own.
- Category colours MUST NOT be used for status. An orange or magenta category bar is still a category,
  and over-budget is signalled by `status.over` + the word „über".
- „Ohne Kategorie" has no palette colour: it is `text.disabled` with a dashed outline.
- Run the palette through the `dataviz` skill's validator before changing any value.

### 2.3 Typography

Two families, both bundled via `@fontsource` (local means local: no font CDN at runtime):

- **IBM Plex Sans** — the UI face. Sober, made for data, full German coverage, true tabular
  figures. `IBM Plex Mono` for IBANs and references.
- **Newsreader** — a text serif used **only** for page titles and the hero amount. It is what makes
  the app read as a _Kassenbuch_ rather than a dashboard. Never for body, tables or controls.

Fallback: `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` / `Georgia, serif`.

| Token        | Family     | Size / line | Weight | Use                               |
| ------------ | ---------- | ----------- | ------ | --------------------------------- |
| `display`    | Newsreader | 48 / 52     | 500    | The one hero amount on Überblick  |
| `h1`         | Newsreader | 28 / 34     | 500    | Page title                        |
| `h2`         | Plex Sans  | 16 / 24     | 600    | Card and section titles           |
| `h3`         | Plex Sans  | 14 / 20     | 600    | Sub-sections, day headers         |
| `body`       | Plex Sans  | 14 / 20     | 400    | Default                           |
| `bodyStrong` | Plex Sans  | 14 / 20     | 500    | Counterparty name, category name  |
| `caption`    | Plex Sans  | 12 / 16     | 400    | Purpose line, meta, table headers |
| `mono`       | Plex Mono  | 13 / 20     | 400    | IBAN, references, file hash       |

- Every element that shows an amount, a count, a date or a percentage MUST set
  `font-variant-numeric: tabular-nums` (the theme sets it on `body`; do not override it off).
- Amounts MUST NOT wrap (`white-space: nowrap`) and MUST be right-aligned in columns.
- Text is **sentence case** everywhere, including buttons and table headers. `textTransform:
uppercase` is off globally. German compounds in capitals are unreadable.
- Line length for prose (hints, empty states) SHOULD stay under 70 characters.

### 2.4 Space, radius, elevation

- Spacing is a 4 px grid: `0.5 1 1.5 2 3 4 6 8` in theme units (`theme.spacing(1) = 8px`).
- Radius: `6` for inputs, chips and buttons; `10` for cards and menus; `999` for pills and bars.
- Elevation: **borders, not shadows.** Cards are `1px solid border` on `bg.surface`. Only
  overlays (menus, dialogs, the drop overlay, snackbars) get a shadow.
- Row height: 44 px for list rows (two lines), 40 px for compact tables. Touch targets ≥ 40 px.

### 2.5 Motion

- 120–180 ms, `cubic-bezier(0.2, 0, 0, 1)`. Only opacity, transform and bar width animate.
- `prefers-reduced-motion: reduce` MUST turn all of it off. Charts keep `skipAnimation`.
- Nothing animates on first page load except skeleton shimmer.

---

## 3. Layout

- **App shell.** ≥ 1024 px: fixed left sidebar (232 px) with nav, the Sortieren badge and
  preferences at the bottom; a top bar with the month stepper, account scope and Import button.
  < 1024 px: sidebar collapses to icons. < 720 px: bottom navigation, top bar keeps the month.
- **Content width.** Max 1200 px, 32 px gutters (16 px < 720 px). Pages MUST NOT use
  `Container maxWidth="md"` for data views; tables and charts use the full content width.
- **Charts are responsive.** They fill their container; a fixed width is allowed only in tests.
  Horizontal scrolling of a chart is a bug.
- **One month for the app.** The selected month lives in the URL (`?m=YYYY-MM`) and every page
  reads it. A page MUST NOT keep its own month state that disagrees with the shell.

---

## 4. Money, dates and data

- Amounts go through `formatAmount` and dates through `formatBookingDate` — never a raw
  `toFixed` or `toLocaleString`. Both stay `de-DE` in both languages (plan 07).
- **Money out is `text.primary`.** Money in is `status.income` with a leading `+`. Red is never
  used for an ordinary negative amount.
- In a report (Überblick, bars), spending is shown as a positive magnitude — the report already
  does this; the UI MUST NOT re-negate it.
- **Vorgemerkt** MUST be visible, labelled with the word „vorgemerkt" (icon + word, or
  word alone), and MUST NOT be summed into a booked total. In bars it is a hatched segment
  after the solid booked segment.
- **Over budget** is colour **and** word **and** accessible name: `status.over`, „über", and the
  row's `aria-label`. Near budget (≥ 85 %) is colour and a percentage.
- Loading numbers show a skeleton or `…` with an accessible label — never `0,00 €` and never
  an empty input that invites typing over a stored value.

---

## 5. Components

Build these once in `apps/web/src/ui/` and use them everywhere. A page SHOULD NOT restyle an MUI
primitive inline when one of these exists.

| Component      | Contract                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| `AppShell`     | Sidebar + top bar + content slot. Owns the month stepper and global drop target.                          |
| `MonthStepper` | `‹ September 2025 ›` with a menu on the label. `[` and `]` step months. Reads/writes `?m=`.               |
| `AmountText`   | Formats cents, tabular, nowrap; `tone="auto"` colours income; `size` from the type scale.                 |
| `CategoryPill` | Colour dot + name. Clickable variant opens `CategoryMenu`. Uncategorized = dashed outline.                |
| `CategoryMenu` | Searchable list, number-key shortcuts, "Neue Kategorie…" at the end.                                      |
| `BudgetBar`    | Solid booked, hatched vorgemerkt, tick at the limit, `ok/near/over` tone, label with „übrig"/„über".      |
| `StatTile`     | Label, big value, one-line context. At most four in a row.                                                |
| `RuleSentence` | „Wenn _Feld_ _Operator_ ‚Wert' → Kategorie" with match count. Editable in place.                          |
| `StatusIcon`   | `pending` (schedule), `locked` (lock), `over` (warning), `income` (south-west arrow). Replaces all emoji. |
| `EmptyState`   | One sentence, one primary action. No illustrations.                                                       |
| `InlineAlert`  | MUI `Alert`, placed next to the thing that failed, worded by `describeFailure`.                           |
| `UndoSnackbar` | Every destructive action: act immediately, offer „Rückgängig" for 6 s.                                    |
| `DropOverlay`  | Full-window overlay while a file is dragged over the app; asks for the account if more than one.          |
| `KeyHint`      | Small `kbd` showing a shortcut next to its action.                                                        |

- **No emoji as UI.** `⏳ 🔒 ⚠ ✕` are replaced by `@mui/icons-material` Rounded icons at
  `1.125em`, `aria-hidden` when a word next to them already says it, labelled otherwise.
- **Buttons.** One `contained` primary per view. Secondary actions are `text` or `outlined`.
  Destructive actions are `text` in `status.over` and always undoable. Labels are verbs:
  „Importieren", „Regel anlegen", not „OK".
- **Inputs.** `outlined`, `size="small"` in toolbars, labels above on forms. Validation messages
  under the field, worded from `locales/`.
- **Tables** are for comparing across rows (rules list, budget edit mode). A list of things to
  read — transactions — is a ledger: day groups, two-line rows, pill, amount.

---

## 6. Charts

- Choose the form by the question: _spent vs limit per category_ → `BudgetBar` rows; _change over
  months_ → columns or area with the budget as a line; _share of the month_ → one stacked bar,
  never a pie or donut.
- Series colours: categories use §2.2; booked/vorgemerkt use the category colour solid/hatched;
  the limit is a line or tick in `text.primary`, never a grey bar.
- Every chart has a text title, a `figure` + `figcaption`, and its numbers available as text
  (the table or the rows next to it). Tooltips format with `formatAmount`.
- A chart with no data renders nothing and lets the page's empty state speak.
- Load the `dataviz` skill before writing chart code.

---

## 7. States

| State               | Rule                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Loading             | < 300 ms: nothing. Then a skeleton in the shape of the content. Spinners only inside buttons.      |
| Empty               | Say what is missing and the one action that fixes it: „Noch keine Umsätze." + „CSV importieren".   |
| Filtered to nothing | Different sentence from empty, plus „Filter zurücksetzen".                                         |
| Error               | Inline, next to its source, worded at render by `describeFailure`. Page-level only for page loads. |
| Success             | Quiet: a snackbar or the changed row. Import results stay visible until dismissed.                 |
| Saving              | Disable only the control being saved, never the page.                                              |

---

## 8. Accessibility

- WCAG 2.2 AA is the floor. Contrast as in §2.1.
- Visible focus on every interactive element: 2 px `primary` outline, 2 px offset. Never
  `outline: none` without a replacement.
- Everything reachable by keyboard in DOM order. Shortcuts are additive, shown with `KeyHint`,
  and never the only way to do something. Single-key shortcuts are off while a text field has
  focus.
- Colour is never the only carrier: over = word, category = name, income = `+`, vorgemerkt =
  word or labelled icon.
- Icon-only buttons MUST have an `aria-label` from `locales/`.
- Landmarks: `nav` for the sidebar, `main` for content, one `h1` per page.

---

## 9. Words

- All UI text lives in `apps/web/src/locales/{de,en}.ts` (invariant in `CLAUDE.md`).
- German uses **Sie**, sentence case, and the bank's own terms: Umsätze, vorgemerkt, Empfänger,
  Verwendungszweck. English mirrors meaning, not word order.
- The app name is localized: „Haushaltsbuch" / "Household budget".
- Numbers in sentences use the formatter: „318,50 € ohne Kategorie", not „318.5".
- Error text says what happened and what to do, never a status code or `Failed to fetch`.

---

## 10. Implementation notes

- Fonts: `@fontsource/ibm-plex-sans` (400/500/600), `@fontsource/ibm-plex-mono` (400),
  `@fontsource/newsreader` (500), imported once in `main.tsx`.
- `theme.ts` uses `createTheme({ colorSchemes: { light: { palette }, dark: { palette } } })` with
  the §2 palette — **not** `cssVariables: true`, which with both schemes defaults the selector to
  `'media'` and ignores the user's stored choice (`mui-mode`). It also sets `typography` from §2.3, `shape.borderRadius: 6`, and component overrides:
  `MuiButton` (`textTransform: 'none'`, `disableElevation`), `MuiCard` (outlined, radius 10),
  `MuiTableCell` (caption-sized headers, `tabular-nums`), `MuiChip` (radius 999).
- Custom palette keys (`status`, `category`, `bg`) are declared by module augmentation in
  `theme.d.ts` so `sx={{ color: 'status.over.main' }}` typechecks.
- Shared components go in `apps/web/src/ui/`, the app shell (nav, top bar, month stepper,
  shortcuts) in `apps/web/src/shell/`, page-specific pieces in `pages/`.
- A UI change is verified in **both schemes and both languages** and at 390 px, 1024 px and
  1440 px before it is called done.

## 11. Review checklist

- [ ] No hex, rgb or px font sizes in `pages/` or `ui/`
- [ ] Amounts: `AmountText` / `formatAmount`, tabular, right-aligned, no wrap
- [ ] Red only for over budget, errors, destructive
- [ ] Vorgemerkt labelled and not summed
- [ ] No emoji; icons labelled or hidden correctly
- [ ] Sentence case; text from `locales/`, both languages present
- [ ] Loading, empty, filtered-empty and error states designed
- [ ] Keyboard path works; focus visible
- [ ] Checked light + dark, DE + EN, 390 / 1024 / 1440 px
