# Wiring a new dialect through the stack

The parser is half the job. These are the files a new format touches outside
`packages/core`, and why each one matters. The generic path — detect, parse, record the
dialect, show it — was built for Deutsche Bank (plan 10), so a third bank mostly adds data
and tests; the rows below say where.

## apps/api

| File                                | Change                                                                                       | Why                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/import/import.service.ts`      | Nothing. It calls `detectDialect` + `parseBankCsv` and stores the dialect on the batch.      | One upload endpoint, any registered bank. If a new bank needs a branch here, it belongs in core.   |
| `src/import/decode.ts`              | Only if the new bank ships something other than UTF-8 or cp1252.                             | The fallback chain is bank-agnostic; widen `BankFileEncoding` in core if you add a candidate.      |
| `src/import/import.controller.ts`   | Usually nothing. Check `ACCEPTED_TYPES` if the bank's download serves a different MIME type. | Sparkasse's dialog serves `.csv` as `application/vnd.ms-excel`; other banks have their own quirks. |
| `src/import/decode.test.ts`         | A case for the new fixture's real bytes (BOM, encoding).                                     | Core cannot decode bytes; this is where the byte path is exercised.                                |
| `src/import/import.service.test.ts` | An import of the primary fixture, as the Deutsche Bank case does.                            | Proves the dialect is detected, recorded on the batch, and the rows land.                          |

`ImportBatch.dialect` already exists (`prisma/schema.prisma`) — no schema change for a new
bank. If you do change the schema: `pnpm --filter @household-budget/api db:push`; the
generated client in `src/generated/prisma` is regenerated output — do not hand-edit it.

File-level failures must keep mapping to a 4xx. `CsvFileError` and `csv-parse`'s own
`CsvError` both already do; a new error code added to core needs the same treatment or it
surfaces as a 500.

## apps/web

| File                                     | Change                                                    | Why                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/locales/de.ts`, `src/locales/en.ts` | The bank's name under `common.import.dialect`.            | `satisfies Record<BankDialectId, string>` — typecheck fails until both languages name it, by design. |
| `src/locales/de.ts`, `src/locales/en.ts` | Add the bank to the `HEADER_NOT_FOUND` wording.           | It lists the supported formats; a missing one is wrong advice to the user.                           |
| `src/locales/de.ts`, `src/locales/en.ts` | Wording for any new `ImportErrorCode`, in both languages. | Same `satisfies Record<…>` guard.                                                                    |

The import summary (`pages/ImportPanel.tsx`) and the history (`pages/ImportsPage.tsx`)
already show the detected bank as a chip from `ImportSummary.dialect`
(`packages/core/src/api.ts`); nothing to change there.

No bank picker in the upload flow. The header identifies the file, and a picker adds a way
for the user to be wrong that produces wrong numbers instead of an error.

## e2e

`apps/web/e2e/deutsche-bank.spec.ts` is the pattern for a second bank: create an account,
set the fixture on the file input, assert the imported count, the bank chip, and that an
umlaut survived bytes → `TextDecoder` → SQLite → JSON → DOM.

Add a spec per new format, pointed at the **primary** fixture — the one in the encoding the
bank really ships. A UTF-8 twin proves nothing here; the whole point of the e2e is the byte
path.

Playwright runs against its own `e2e.db`, reset by `scripts/reset-e2e-db.mjs`, so it never
touches the dev database. Run it with `pnpm check:all` — that is what CI runs, so a format
that only passes `pnpm check` is not done.

## Docs

- `docs/research/NN-<bank>-csv.md` — the format, with sources. Written before the code.
- `docs/plans/NN-<bank>-csv.md` — what was built and what surprised you.
- `apps/api/CLAUDE.md` (the `POST /api/imports` paragraph) and `README.md` (introduction, fixtures
  line) — name the formats that import. Link, do not inline.
