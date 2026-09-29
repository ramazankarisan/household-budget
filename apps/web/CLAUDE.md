# apps/web

React 19, Vite, MUI, react-router. The UI rulebook, DESIGN.md, is imported at the end of this
file, so it is in context for every change here.
Each point is deliberate; where there is a link, it is the reason. Do not undo one without reading it.

- UI text lives in `src/locales/{de,en}.ts` and nowhere else; `en` is typed against `de`, so a
  missing translation fails typecheck. Amounts and numeric dates (`22.09.2025`) are `de-DE` in
  both languages; spelled-out month and weekday names follow the language (`formatMonth`, the
  ledger's day headings). [plan 07](../../docs/plans/07-language-and-theme-switch.md)
- One household copy of the data (`src/household/`): pages read it, and every write replaces the
  row the server answered with or reloads.
- The transactions list filters in the browser (`src/filter.ts`) — no server query, no
  endpoint. Search runs in JavaScript for the same case-folding reason as rule matching. URL
  search params (`?m`, `?c`, `?a`) hold view state only.
  [research 03 §6, §9](../../docs/research/03-transactions-list.md)
- „Ohne Kategorie“ is counted by one function, `uncategorizedRows`: booked rows, in or out,
  with no category, over the chosen accounts (all unless one is picked) and the chosen month,
  never the search or category filter. The nav badge counts every month. Vorgemerkt rows are
  not counted and the filter does not show them — they cannot be categorized until they book,
  so the chip opens exactly the rows it counts.
- Überblick has no account picker: budgets are household-wide. `/budgets` redirects to it.
- Never import Node built-ins, NestJS, Prisma or `@household-budget/core/csv` at runtime;
  type-only imports are fine. `pnpm lint:deps` enforces it.

@../../DESIGN.md
