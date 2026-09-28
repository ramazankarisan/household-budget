---
date: 2026-09-28T19:50:50Z
git_commit: 8ea89bc157d0accb036d8d50dd9ef02b4b4df4d8
branch: feat/deutsche-bank-csv
topic: 'Deutsche Bank CSV import, and the dialect registry it needed'
tags: [plan, csv-import, packages-core, apps-api, apps-web, deutsche-bank]
status: implemented
---

# PLAN: Deutsche Bank CSV import

Second bank format. Research: [`docs/research/07-deutsche-bank-csv.md`](../research/07-deutsche-bank-csv.md).

## What was built

1. **Registry seam** (its own commit, Sparkasse behaviour unchanged): `packages/core/src/csv/dialects/`
   holds one `BankDialect` descriptor per bank; `parseBankCsv(text, dialect, context)` is the one
   generic parser; `detectDialect(text)` picks a dialect by header (most markers wins, a tie throws).
2. **`deutsche-bank` dialect**, fixtures `fixtures/deutsche-bank*.csv` (UTF-8 + BOM, LF — as shipped).
3. **API** detects the dialect, records it on `ImportBatch.dialect` (nullable; null lists as
   Sparkasse, the only format before this column), and returns it on `ImportSummary` and
   `ImportBatchPayload`. `parseSparkasseCsv` is gone.
4. **Web** shows the dialect as a chip next to the encoding; upload and header-error wording
   names both supported formats.
5. **E2E** `e2e/deutsche-bank.spec.ts`, in its own Playwright project that depends on the
   main one.

## What surprised us

- **`accountIban` really did reshape the descriptor**, as the skill warned: it became
  `{ from: 'column' } | { from: 'preamble' }`. No `from: 'context'` yet — no bank needs it.
- **The footer would have failed the whole file**, not dropped out: `relax_column_count: false`
  makes csv-parse throw on a 6-field line. Hence `footerMarker`.
- **Status had to become optional as a pair** (column + value map), not two independent
  optionals — a column without a map, or the reverse, is meaningless.
- **Nothing new was needed for amounts or dates.** `parseGermanAmount` already handles
  truncation and `parseGermanDate` already accepts one-digit days and months.
- **The e2e database is shared and counted.** A second account makes the import dialog ask
  which account a file belongs to, and rows in another month shift what other specs see — so
  the spec runs in a dependent project, after all of them.
- The fixture tooling gained `quote: "none"`, `lineEnding` and `footer` in
  `make_fixture.py` and `--lf` in `check_fixture_bytes.py`.

## Deploying

A schema change: run `pnpm --filter @household-budget/api db:push` once against the dev database.
