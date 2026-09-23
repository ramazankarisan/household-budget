# Wiring a new dialect through the stack

The parser is half the job. These are the files a second format touches outside
`packages/core`, and why each one matters.

## apps/api

| File                                | Change                                                                                       | Why                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/import/import.service.ts`      | Call `detectDialect` + `parseBankCsv` instead of `parseSparkasseCsv`.                        | One upload endpoint, any supported bank.                                                           |
| `src/import/import.service.ts`      | Record the detected dialect on the import batch.                                             | Provenance: "which parser produced these rows" is the first question when a number looks wrong.    |
| `src/import/decode.ts`              | Only if the new bank ships something other than UTF-8 or cp1252.                             | The fallback chain is bank-agnostic; widen `BankFileEncoding` in core if you add a candidate.      |
| `src/import/import.controller.ts`   | Usually nothing. Check `ACCEPTED_TYPES` if the bank's download serves a different MIME type. | Sparkasse's dialog serves `.csv` as `application/vnd.ms-excel`; other banks have their own quirks. |
| `prisma/schema.prisma`              | Add `dialect String?` to `ImportBatch` if you record it.                                     | Nullable, so existing rows stay valid.                                                             |
| `src/import/import.service.test.ts` | A case per new fixture, including the real-encoding bytes.                                   | Core cannot decode bytes; this is the only place the cp1252 path is exercised.                     |

After a schema edit: `pnpm --filter @household-budget/api db:push` (and `prisma generate`
runs on install). SQLite plus a nullable column needs no migration ceremony, but the
generated client in `src/generated/prisma` is regenerated output — do not hand-edit it.

File-level failures must keep mapping to a 4xx. `CsvFileError` and `csv-parse`'s own
`CsvError` both already do; a new error code added to core needs the same treatment or it
surfaces as a 500.

## apps/web

| File                        | Change                                                                    | Why                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/i18n/importErrors.ts`  | Wording for any new `ImportErrorCode`, in **both** `de` and `en`.         | The tables are `Record<Locale, Record<ImportErrorCode, string>>`, so typecheck fails until both exist — by design.                                                         |
| `src/i18n/importErrors.ts`  | Generalise `HEADER_NOT_FOUND`.                                            | It currently reads "is this a Sparkasse CSV-CAMT export?", which is wrong advice the moment a second bank is supported. Name the supported formats, or drop the bank name. |
| `src/pages/ImportPanel.tsx` | Show the detected bank in the summary, if the summary shows the encoding. | The user's check that the right parser ran. Keep it to a chip; no bank picker.                                                                                             |
| `packages/core/src/api.ts`  | Add the dialect to `ImportSummary` if the UI shows it.                    | This file is the api↔web contract; declaring it anywhere else means only one side can change it.                                                                           |

No bank picker in the upload flow. The header identifies the file, and a picker adds a way
for the user to be wrong that produces wrong numbers instead of an error.

## e2e

`apps/web/e2e/import.spec.ts` is the pattern: create an account, set the fixture on the file
input, assert the imported count, the encoding chip, and that an umlaut survived bytes →
`TextDecoder` → SQLite → JSON → DOM.

Add a spec (or a `test.describe.serial` block) per new format, pointed at the **primary**
fixture — the one in the encoding the bank really ships. The UTF-8 twin proves nothing here;
the whole point of the e2e is the byte path.

Playwright runs against its own `e2e.db`, reset by `scripts/reset-e2e-db.mjs`, so it never
touches the dev database. Run it with `pnpm check:all` — that is what the pre-push hook
runs, so a format that only passes `pnpm check` is not done.

## Docs

- `docs/research/NN-<bank>-csv.md` — the format, with sources. Written before the code.
- `docs/plans/NN-<bank>-csv.md` — what was built and what surprised you.
- `CLAUDE.md` — update the status paragraph to name the formats that import. Link, do not
  inline.
