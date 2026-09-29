# packages/core

Pure TypeScript, compiled to `dist/` (ESM + `.d.ts`). Both apps import the build, never `src/`.
Each point is deliberate; where there is a link, it is the reason. Do not undo one without reading it.

- Two entry points. The root is browser-safe. `@household-budget/core/csv` holds the parser,
  which pulls in `csv-parse`'s Node build, so only `apps/api` imports it.
- `"types": []`: no `TextDecoder`, no `node:crypto`. The API decodes and hashes; core takes a
  `string`.
- Payload types declared here (`AccountPayload`, `TransactionPayload`, `ImportSummary`,
  `BudgetPayload`) are the contract between API responses and the UI.
- CSV: one descriptor per bank in `src/csv/dialects/`, read by column **name**, the format
  detected from the header, never asked. The authority on each format is its research doc:
  [01](../../docs/research/01-csv-import.md) Sparkasse CSV-CAMT,
  [07](../../docs/research/07-deutsche-bank-csv.md) Deutsche Bank.
- Rules: one condition each; `priority ASC`, then `createdAt`, then `id`; first match wins.
  Matching and search run in JavaScript over loaded rows, never as SQL — SQLite folds case
  for ASCII only, so `LIKE '%müller%'` misses `MÜLLER GmbH`.
  [research 02 §3](../../docs/research/02-categorization-rules.md)
- `monthlyReport` counts money out only, keeps booked and vorgemerkt apart, and gives every
  category a row; the uncategorized bucket is `null` and never has a limit.
  [research 04 §4](../../docs/research/04-monthly-budgets.md)
