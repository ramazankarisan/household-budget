---
date: 2026-09-22T14:02:23Z
git_commit: 3c2b27a97f7c12d586e6ac03c29795a9b7b8360d
branch: docs/csv-import-research
topic: 'CSV import for Sparkasse CSV-CAMT V8 exports'
tags: [plan, csv-import, packages-core, apps-api, apps-web, prisma]
status: draft
---

# PLAN: CSV import for Sparkasse CSV-CAMT V8 exports

Deliver the first real feature: upload a Sparkasse CSV export, parse it, store the
transactions, and show them. This is the "import" third of the app's purpose — import,
categorize, report — and the schema it creates is what the other two build on.

Research: [`docs/research/01-csv-import.md`](../research/01-csv-import.md). That document is the
authority for format details, and its findings were measured against this checkout rather than
taken from documentation. Do not re-derive them.

## Acceptance Criteria

- [x] Both primary fixtures parse to **identical** `Transaction` values, except `bankCategory` is
      absent from the 17-column one.
- [ ] Umlauts survive a Windows-1252 file end to end: `Müller GmbH` reaches the browser intact,
      never `M�ller` (cp1252 bytes read as UTF-8) or `MÃ¼ller` (UTF-8 read as cp1252).
- [x] `832,9` parses to `83290` cents and `-190` to `-19000`. No float touches an amount.
- [x] `"24.03.14";"01.04.2014"` in one row yields `2014-03-24` and `2014-04-01`.
- [x] A quoted field containing `;`, a quoted field containing a newline, and doubled quotes all
      parse correctly. An unterminated quote **fails loudly** rather than swallowing the file.
- [ ] Re-importing the same file imports **0** new rows.
- [ ] Two distinct same-day, same-amount, same-merchant rows both survive import, and survive a
      re-import without duplicating.
- [ ] A pending row is replaced rather than duplicated on re-import; when it books it becomes one
      booked row with no pending twin left behind.
- [ ] Deleting a transaction and re-importing the file brings it back.
- [x] A file with 3 unparseable rows imports the rest and reports the 3 with line numbers and
      machine codes.
- [ ] `pnpm check` is green at the end of every phase; `pnpm check:all` is green at the end.

## Technical Key Decisions and Tradeoffs

1. **Scope: Sparkasse CSV-CAMT V8 only, full vertical slice through to UI.**
   - Why: the first slice a user can actually use, and Playwright already gates the repo.
   - Impact: an `Account` model, a router in `apps/web`, and the hello slice retired in Phase 5.
2. **Columns are matched by header name, never by index.**
   - Why: both a 17-column and an 18-column CSV-CAMT exist; the user's export is the 18-column one.
   - Impact: the two primary fixtures are those two shapes, and one parser must satisfy both.
3. **Bad rows: partial success — import the good, report the bad.**
   - Why: a user cannot hand-edit a bank export, so rejecting the file leaves them stuck.
   - Impact: errors are structured (code + line + field), never sentences. **File-level** failures
     (unparseable CSV, missing required columns) still reject the whole request with a 4xx.
4. **Schema: `Account` + `Transaction` + `ImportBatch`.**
   - Why: provenance belongs on the batch rather than duplicated on every row, and an import that
     produced zero new rows is exactly the one you want a record of.
   - Impact: `ImportBatch.fileHash` powers a "you already uploaded this file" warning — which this
     plan actually builds, in Phase 4 and Phase 5, rather than merely storing.
5. **`packages/core` stays browser-safe: no `node:crypto`, no `TextDecoder`, no `node:fs`.**
   - Why: measured — core's `tsconfig.json:7` sets `"types": []`, and `apps/web` bundles core.
   - Impact: decoding and hashing live in `apps/api`. Core's own tests read a **UTF-8 twin** of the
     fixture; the cp1252 path is asserted in `apps/api`, which has `types: ["node"]`.
6. **Money is integer cents in a branded type, parsed by regex straight from the German string.**
   - Why: `Math.round(1.005 * 100) === 100`. The `parseFloat × 100` idiom is itself the bug.
   - Impact: `Cents` is a branded `number`; `Intl.NumberFormat` formats only at the UI edge.
7. **Dates are plain `'YYYY-MM-DD'` strings, never `Date`.**
   - Why: a booking date has no time and no zone; `Date` introduces a UTC midnight that shifts
     backwards a day west of Greenwich, moving transactions into the wrong month.
   - Impact: `Buchungstag` primary, `Valutadatum` alongside. The two-digit-year pivot takes an
     **injected reference year**, following the `buildHelloPayload({ now })` precedent, so core
     stays free of ambient state.
8. **Pending rows are a replaceable set, not ledger entries.**
   - Why: a pending row reappears booked with a different `Buchungstag` and rewritten
     `Verwendungszweck`, so no fingerprint can match it to its own booked form.
   - Impact: on every import, delete all stored pending rows for the account and re-insert from
     the file. `dedupKey` is `NULL` for them, which SQLite treats as distinct — verified.
9. **Soft-deleted rows are restored on re-import, not re-inserted.**
   - Why: `@@unique([accountId, dedupKey])` covers soft-deleted rows too, so a plain insert hits
     `UNIQUE constraint failed`. Verified against this repo's `better-sqlite3@12.11.1`.
   - Impact: the import does a three-way match per key — live → skip, soft-deleted → clear
     `deletedAt`, absent → insert. This is what delivers "deleted rows come back".
10. **The occurrence index is the row's position among same-fingerprint rows within the file.**
    - Why: deterministic and idempotent without consulting the database. The same file always
      yields the same keys, so a re-import matches; an overlapping export that contains one more
      identical row yields one new index. Identical rows are interchangeable by definition, so
      their relative order cannot matter.
    - Impact: simpler than the research's multiset-difference framing (`research:460-466`) and
      equivalent in effect. The research's warning was against _absolute row position_, which
      renumbers between exports; per-fingerprint position does not. `assignOccurrences` stays pure
      and needs no database counts.

## Current State

Everything this feature needs is greenfield. There is no `Account` concept, no router, no file
upload, and `schema.prisma` declares a generator and datasource with **zero models**.

```
packages/core/src/          apps/api/                      apps/web/src/
  hello.ts     ← only domain  src/app.module.ts              App.tsx → HelloPage
  index.ts     ← 2 exports    src/hello/{controller,service} api/client.ts  (fetch '/api/…')
  hello.test.ts               src/prisma/prisma.service.ts   pages/HelloPage.tsx
                              prisma/schema.prisma           e2e/smoke.spec.ts
                                generator + datasource only  (no router, no upload)
```

**Every current consumer of core depends on `hello.ts`** — this is why nothing is deleted until
Phase 5:

| file                                       | imports                                         |
| ------------------------------------------ | ----------------------------------------------- |
| `apps/api/src/hello/hello.service.ts:1`    | `buildHelloPayload`, `DbStatus`, `HelloPayload` |
| `apps/api/src/hello/hello.controller.ts:1` | `HelloPayload`                                  |
| `apps/web/src/api/client.ts:1`             | `type HelloPayload`                             |
| `apps/web/src/pages/HelloPage.tsx:1`       | `describeHello`, `type HelloPayload`            |
| `apps/web/src/pages/HelloPage.test.tsx:1`  | `type HelloPayload`                             |

Constraints the plan must not trip over:

- `pnpm lint:deps` fails if core imports `@nestjs`/`@prisma`/`react` — type-only included. Its
  `not-to-unresolvable` rule (`.dependency-cruiser.cjs:33-41`) also fails on any import it cannot
  resolve, which includes subpath exports like `csv-parse/sync`.
- `pnpm check` runs `typecheck` across all three packages and all unit tests, so no phase may
  leave a dangling import.
- `pnpm check:all` runs Playwright, whose API readiness probe is `http://localhost:3000/api/hello`
  (`apps/web/playwright.config.ts:4,32`). Playwright accepts `200 ≤ status < 404`, so removing
  that route without repointing the probe makes `check:all` hang for 120 s and fail.
- `.editorconfig` applies `charset = utf-8` and `end_of_line = lf` to `[*]`, which would silently
  re-encode a Windows-1252 fixture on save.

## Desired End State

```
 browser                         apps/api                        packages/core
 ───────                         ────────                        ─────────────
 pick account                                                    (browser-safe, pure)
 drop file  ──POST multipart──►  decode.ts
                                 TextDecoder utf-8 fatal
                                   └► fallback windows-1252
                                        │ string
                                        ▼
                                 import.service.ts ──────────►  parseSparkasseCsv(text, ctx)
                                        │                         header match by NAME
                                        │                         csv-parse/sync
                                        │                         → Transaction[] + RowError[]
                                        │  ◄───────────────────────────────┘
                                        │
                                        ├─ booked  ─► fingerprintInput(t) ─┐   (core, pure)
                                        │             assignOccurrences()  ┘
                                        │                    │ f|n:i
                                        │                    ▼
                                        │             hash.ts (node:crypto) → dedupKey
                                        │                    │
                                        │        ┌───────────┴───────────┐
                                        │        live → skip   deleted → clear deletedAt
                                        │                     absent  → insert
                                        │
                                        └─ pending ─► deleteMany(account, pending), insert fresh
                                        │                    (dedupKey NULL, never fingerprinted)
                                        ▼
 summary + list ◄──JSON──  { batchId, imported, skipped, restored, failed[], encoding,
                             duplicateOfBatchId? }
```

New files:

- `fixtures/` — seven CSVs, all synthetic
- `packages/core/src/csv/` — `transaction.ts`, `errors.ts`, `fields.ts`, `header.ts`, `parse.ts`,
  `fingerprint.ts`
- `apps/api/src/import/` — `decode.ts`, `hash.ts`, `import.{service,controller,module}.ts`
- `apps/api/src/accounts/` — `account.{service,controller,module}.ts`
- `apps/web/src/pages/` — `AccountPage.tsx`, `ImportPanel.tsx`, `TransactionList.tsx`
- `apps/web/e2e/import.spec.ts`
- `.gitattributes`

## Abstractions and Code Reuse

- **`buildHelloPayload`'s injectable clock** (`packages/core/src/hello.ts`) is the precedent for
  keeping core pure. Both `parseSparkasseCsv` (file name + encoding) and `parseGermanDate`
  (reference year) take context arguments rather than reading ambient state, for the same reason.
- **`PrismaService`** is already `@Global()` (`apps/api/src/prisma/prisma.module.ts:5`), so new
  services inject it directly — but their own modules still need registering in `app.module.ts`.
- **`HelloService.probeDatabase`** is the precedent for degrading rather than throwing. Import
  follows it for **row** failures and deliberately does not for **file** failures.
- **`apps/web/src/api/client.ts`** already uses relative `/api` paths through the Vite proxy.

## Logging & Observability

The one thing worth logging is the decoded encoding — it turns "the bank silently changed the
export format" from a mystery into a line in a log.

```
[ImportService] import 7f3a… account=DE89…3000 file="Umsaetze_DE89.csv" encoding=windows-1252
[ImportService] import 7f3a… parsed=241 booked=238 pending=3 errors=3
[ImportService] import 7f3a… imported=197 skipped=41 restored=2 pendingReplaced=3
[ImportService] import 7f3a… WARN row 88 AMOUNT_UNPARSEABLE field=Betrag value="12,3,4"
```

Never log `Verwendungszweck` or counterparty names at info level — that is the user's spending
history. The row warning logs the field and offending value only.

## Implementation

### Phase 1: Fixtures, types and value parsers

Dependencies: None.

Fixtures first, so every later phase is written against them. **Nothing is deleted from core in
this phase** — five files across both apps import `hello.ts`, and removing it would fail
`pnpm typecheck` and the pre-commit hook. The hello slice retires in Phase 5.

**Tasks**:

- [x] Add `.gitattributes` with `fixtures/*.csv -text -diff` so git never normalizes line endings
      in a fixture.
- [x] Add a `[fixtures/**.csv]` section to `.editorconfig` with `charset = unset`,
      `end_of_line = unset`, `trim_trailing_whitespace = false`, `insert_final_newline = false`.
      Without this, `[*] charset = utf-8` silently re-encodes the cp1252 fixtures on save and the
      encoding test passes for the wrong reason.
- [x] Create the fixtures. All synthetic — invented IBANs, invented names, invented amounts.
      **CRLF line endings** throughout, matching a real export.
  - `sparkasse-camt-18.csv` — **Windows-1252**, header line 1, `Auftragskonto` unquoted with the
    rest quoted, 18 columns ending in `Kategorie`. Contains: umlauts (`Müller GmbH`, `Straße`,
    `Gebühr`, `Ärzte GmbH`); `"REWE SAGT DANKE; FILIALE 42"`; a quoted field with an embedded
    newline; `""Nord""`; `"24.03.14";"01.04.2014"` in one row; `832,9` and `-190`; a blank line
    mid-file and a trailing blank line; one `Umsatz vorgemerkt` row; two rows identical in date,
    amount and counterparty.
  - `sparkasse-camt-17.csv` — same content, `Kategorie` column removed.
  - `sparkasse-camt-18-utf8.csv` — UTF-8 twin of the 18-column file, no BOM. **Core's tests read
    this one**, so core never needs a decoder.
  - `sparkasse-camt-18-utf8-bom.csv` — same, with a UTF-8 BOM. Exercises BOM stripping.
  - `sparkasse-camt-18-bad-rows.csv` — exactly three bad rows: amount `12,3,4`, date `32.13.25`,
    `Info` value `Umsatz storniert`. Everything else valid.
  - `sparkasse-camt-18-next.csv` — an overlapping later export: the pending row now **booked with
    a shifted `Buchungstag`**, the same two identical rows, plus one genuinely new row.
  - `sparkasse-camt-malformed.csv` — an unterminated quote.
- [x] Add `packages/core/src/csv/transaction.ts` — `Cents`, `BookingStatus`, `Transaction`,
      `TransactionSource`, per research §7. `accountIban` is required.
- [x] Add `packages/core/src/csv/errors.ts`:

```ts
export type ImportErrorCode =
  | 'AMOUNT_UNPARSEABLE'
  | 'DATE_UNPARSEABLE'
  | 'STATUS_UNKNOWN'
  | 'REQUIRED_FIELD_MISSING'
  | 'FIELD_COUNT_MISMATCH';
export interface RowError {
  readonly code: ImportErrorCode;
  readonly line: number; // 1-based line in the source file
  readonly field?: string; // German column name
  readonly value?: string; // offending raw value
}
```

- [x] Add `packages/core/src/csv/fields.ts`:
  - `parseGermanAmount(raw)` using the research regex; never `parseFloat`.
  - `parseGermanDate(raw, opts: { referenceYear: number })`. Two-digit years resolve to `20YY`
    unless that lands more than one year after `referenceYear`, in which case `19YY`. The
    reference year is injected, not read from a clock.
  - Extend `packages/core/src/index.ts` **additively** — do not touch the hello exports.
- [x] Write `fields.test.ts`.

**Automated Verification**:

- [x] `pnpm --filter @household-budget/core test` passes.
- [x] `parseGermanAmount('832,9') === 83290`, `'-190' === -19000`, `'1.234,56' === 123456`,
      `'-1143,41' === -114341`, `'0,07' === 7`, `'19,99' === 1999`.
- [x] `parseGermanAmount('12,3,4')` returns an error, not a number.
- [x] `parseGermanDate('24.03.14', { referenceYear: 2026 }) === '2014-03-24'` and
      `parseGermanDate('01.04.2014', …) === '2014-04-01'`.
- [x] Pivot boundary, both sides: with `referenceYear: 2026`, `'01.01.27'` → `2027-01-01` and
      `'01.01.28'` → `1928-01-01`.
- [x] `parseGermanDate('32.13.25', …)` returns an error.
- [x] `git check-ignore fixtures/sparkasse-camt-18.csv` exits **1** with no output — i.e. the
      fixture is committable. (`check-ignore` exits 0 when a path _is_ ignored.)
- [x] The cp1252 fixture contains byte `0xFC` and not the pair `0xC3 0xBC`, asserted by a script
      or a Node one-liner, so an accidental re-encode fails.
- [x] `pnpm check` green.

### Phase 2: CSV parsing to `Transaction[]`

Dependencies: Phase 1.

Turn text into transactions. The two primary fixtures must converge on identical output.

**Tasks**:

- [x] **Gate task, do this first.** Add `csv-parse@^7` to `packages/core` dependencies, then
      immediately verify three things before writing any parser code:
  1. `pnpm lint:deps` still passes — the `not-to-unresolvable` rule fails on unresolvable subpath
     imports, and `csv-parse/sync` is one.
  2. `pnpm --filter @household-budget/web build` succeeds.
  3. The emitted web bundle does not reference `Buffer` or `process`.
     If 2 or 3 fails, do **not** proceed by weakening the check: either keep `parse.ts` out of
     `index.ts` and give core a separate `./csv` export consumed only by `apps/api`, or import
     `csv-parse/browser/esm/sync`. csv-parse ships a browser entry for exactly this reason, and
     research §1 is the whole argument for why core must stay browser-safe.
- [x] Add `packages/core/src/csv/header.ts`:
  - `findHeaderLine(text)` — scan the first ~30 lines for the first containing both
    `Auftragskonto` and `Betrag` after quote-stripping. Returns the index or a file-level error.
  - `mapColumns(headerTokens)` — name → index map, quote-stripped and whitespace-normalized.
    Missing required columns are a file-level error; missing `Kategorie` is fine.
- [x] Add `packages/core/src/csv/parse.ts` exporting
      `parseSparkasseCsv(text, ctx): { transactions, errors }`, where `ctx` carries `fileName`,
      `encoding` and `referenceYear`.
  - csv-parse options: `{ delimiter: ';', bom: true, skip_empty_lines: true, trim: false,
relax_column_count: false, from_line }`. `skip_empty_lines` is **required** — it defaults to
    `false`, and a blank line would otherwise produce a one-field record that
    `relax_column_count: false` turns into a thrown `CSV_RECORD_INCONSISTENT_FIELDS_LENGTH`.
    `trim: false` preserves padded purposes and `""Nord""`.
  - build the options object with conditional spread — `exactOptionalPropertyTypes` rejects
    `{ delimiter: maybeUndefined }` against csv-parse's option types.
  - map `Info` → `BookingStatus`; an unrecognised value yields `STATUS_UNKNOWN`, never a silent
    `booked`.
  - a row whose amount or date fails yields a `RowError` and is **skipped**, not defaulted.
  - preserve the verbatim row in `source.raw` and the 1-based file line in `source.lineNumber`.
- [x] Write `parse.test.ts` reading **`sparkasse-camt-18-utf8.csv`** and the 17-column file. Core
      has `"types": []`, so `node:fs` and `TextDecoder` do not typecheck there — import the
      fixture as a string via Vite's `?raw` suffix, or inline the sample text in the test. The
      cp1252 path is asserted in Phase 4, in `apps/api`, which has `types: ["node"]`.

**Automated Verification**:

- [x] Parsing the 18- and 17-column fixtures yields deep-equal `Transaction[]` after removing
      `bankCategory` and `source`. This is the phase's central test.
- [x] `"REWE SAGT DANKE; FILIALE 42"` parses as one field, semicolon intact.
- [x] The embedded-newline field parses as one field containing `\n`.
- [x] `""Nord""` unescapes to `"Nord"`.
- [x] Blank lines produce no transactions and no errors.
- [x] `sparkasse-camt-malformed.csv` **throws**, asserted on the csv-parse error code, not a
      generic catch.
- [x] The `Umsatz vorgemerkt` row yields `status: 'pending'`.
- [x] `sparkasse-camt-18-bad-rows.csv` yields exactly 3 `RowError`s with the expected codes and
      line numbers, and the remaining rows parse.
- [x] `pnpm check` green, `lint:deps` included.

### Phase 3: Fingerprint and occurrence assignment

Dependencies: Phase 2. Both functions pure, both in core, no database.

**Tasks**:

- [ ] Add `packages/core/src/csv/fingerprint.ts` with `fingerprintInput(t): string` per research
      §8 — fixed-order array, `'v1'` schema tag first, NFKC + whitespace collapse + `toLowerCase`,
      amount as integer cents.
- [ ] Add `assignOccurrences` in the same file:

```ts
/** Index of each row among rows sharing its fingerprint, in file order. Pure. */
export function assignOccurrences(fileFingerprints: readonly string[]): readonly number[];
```

      Deterministic and database-free: the same file always yields the same indices, so a
      re-import produces the same keys and matches. See Decision 10 for why this is equivalent to
      the research's multiset-difference framing and simpler.

- [ ] Write `fingerprint.test.ts`.

**Automated Verification**:

- [ ] Two transactions differing only in `source` produce the same `fingerprintInput`.
- [ ] `Müller GmbH` and `müller  gmbh` produce the same fingerprint.
- [ ] Differing amount, date or purpose produce different fingerprints.
- [ ] `fingerprintInput` is stable across object key insertion order.
- [ ] `assignOccurrences(['a','a'])` → `[0, 1]`.
- [ ] `assignOccurrences(['a','b','a'])` → `[0, 0, 1]`.
- [ ] Running `assignOccurrences` twice on the same input returns identical output.
- [ ] `pnpm check` green.

### Phase 4: Persistence and the import endpoint

Dependencies: Phase 3. Where `schema.prisma` stops being empty.

**Tasks**:

- [ ] Write the Prisma schema:
      ```prisma
      model Account {
      id String @id @default(cuid())
      iban String @unique
      name String
      createdAt DateTime @default(now())
      transactions Transaction[]
      imports ImportBatch[]
      }

      model ImportBatch {
        id           String        @id @default(cuid())
        accountId    String
        account      Account       @relation(fields: [accountId], references: [id])
        fileName     String
        fileHash     String        // sha256 of raw bytes
        encoding     String        // 'utf-8' | 'windows-1252'
        importedAt   DateTime      @default(now())
        rowsParsed   Int
        rowsImported Int
        rowsSkipped  Int
        rowsRestored Int
        rowsFailed   Int
        transactions Transaction[]
        @@index([accountId, fileHash])   // powers "you already uploaded this file"
      }

      model Transaction {
        id            String      @id @default(cuid())
        accountId     String
        account       Account     @relation(fields: [accountId], references: [id])
        importBatchId String
        importBatch   ImportBatch @relation(fields: [importBatchId], references: [id])

        dedupKey      String?     // NULL for pending rows — never fingerprinted
        accountIban   String      // Auftragskonto; provenance and cross-check, may differ
        bookingDate   String      // 'YYYY-MM-DD'
        valueDate     String?
        amountCents   Int
        currency      String
        status        String      // 'booked' | 'pending'

        counterpartyName String?
        counterpartyIban String?
        counterpartyBic  String?
        purpose          String?
        bookingText      String?
        endToEndRef      String?
        mandateRef       String?
        creditorId       String?
        bankCategory     String?

        lineNumber    Int
        raw           String      // verbatim row as JSON — enables re-keying
        deletedAt     DateTime?   // soft delete

        @@index([accountId, bookingDate])
        @@index([accountId, status])
        @@unique([accountId, dedupKey])
      }
      ```
      Two things about `@@unique([accountId, dedupKey])`, both verified against this repo's
      `better-sqlite3@12.11.1`: SQLite treats `NULL`s as **distinct**, so any number of pending
      rows coexist; and the index **does** cover soft-deleted rows, which is precisely why
      re-import must restore rather than insert.

- [ ] Apply with `pnpm --filter @household-budget/api db:push` — **not** `prisma migrate`. The
      repo standardizes on `db:push` (`README.md:29`, `package.json:21` `test:e2e`), there is no
      `prisma/migrations/` directory, and introducing migrations would mean `test:e2e` pushes over
      a migrated schema every run. Requires `binaries.prisma.sh` to be reachable.
- [ ] Add `apps/api/src/import/decode.ts` — `decodeBankCsv(bytes)` per research §2.
- [ ] Add `apps/api/src/import/hash.ts` — `sha256Hex(input)` via `crypto.hash('sha256', …, 'hex')`;
      truncated to 32 chars for dedup keys, full length for the file hash.
- [ ] Add `apps/api/src/accounts/` — `POST /api/accounts`, `GET /api/accounts`.
- [ ] Add `apps/api/src/import/import.service.ts`:
  1. hash raw bytes → `fileHash`; look for a prior `ImportBatch` with the same
     `(accountId, fileHash)` and carry its id into the response as `duplicateOfBatchId`
  2. decode → `{ text, encoding }`; `parseSparkasseCsv(text, { fileName, encoding, referenceYear })`
  3. split booked from pending
  4. booked: `fingerprintInput` each, `assignOccurrences`, `dedupKey = sha256Hex(`f|n:i`)`; fetch
     existing rows for those keys **including soft-deleted**; then per row — live → skip,
     soft-deleted → `update { deletedAt: null }`, absent → insert
  5. pending: `deleteMany({ accountId, status: 'pending' })`, then insert fresh with
     `dedupKey: null`
  6. write the `ImportBatch` row with the counts
  7. return `{ batchId, imported, skipped, restored, failed, encoding, duplicateOfBatchId? }`
  - wrap 4–6 in one `$transaction` so a crash cannot leave pending rows deleted but not reinserted
- [ ] Add `import.controller.ts` with `POST /api/imports` (multipart, `accountId` field). Type the
      uploaded file with a **local interface** — `@types/multer` is not installed and
      `apps/api/tsconfig.json:7` pins `types: ["node"]`, so the global `Express.Multer.File` does
      not exist:

```ts
interface UploadedCsv {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
```

      Reject files over 10 MB, and accept `text/csv` plus `application/vnd.ms-excel` — Sparkasse
      sends the latter.

- [ ] Map csv-parse's file-level errors (`CSV_QUOTE_NOT_CLOSED`,
      `CSV_RECORD_INCONSISTENT_FIELDS_LENGTH`) and missing-required-column errors to
      `BadRequestException`, so they surface as 4xx rather than an unhandled 500.
- [ ] Add `GET /api/accounts/:id/transactions` — `bookingDate` desc, excluding soft-deleted,
      including `status`.
- [ ] Add `DELETE /api/transactions/:id` — sets `deletedAt`, never hard-deletes.
- [ ] Register `AccountsModule` and `ImportModule` in `apps/api/src/app.module.ts`. `PrismaModule`
      being `@Global()` covers the _provider_, not module registration.
- [ ] Add a Vitest `globalSetup` for `apps/api` that points `DATABASE_URL` at a temp file and runs
      `prisma db push` before the suite. `resolveDatabaseUrl()` is read at `PrismaService`
      construction (`apps/api/src/config/database.ts:16-19`), so the env var must be set before the
      testing module is created. Mocking Prisma would test nothing here — the dedup behaviour
      lives in the query.
- [ ] Write `import.service.test.ts` against that real SQLite file.

**Automated Verification**:

- [ ] Importing `sparkasse-camt-18.csv` twice: the second reports `imported: 0`, and its response
      carries `duplicateOfBatchId` set to the first batch.
- [ ] The two identical-looking rows both exist after the first import, and still exactly two
      after the second.
- [ ] Pending row count stays 1 after importing the same file three times.
- [ ] Importing `sparkasse-camt-18.csv` then `sparkasse-camt-18-next.csv` leaves the formerly
      pending transaction as exactly one **booked** row and zero pending rows, and adds the one
      genuinely new row.
- [ ] Soft-deleting a transaction then re-importing restores it: row count returns to its
      pre-delete value, `restored: 1` is reported, and **no `P2002` unique-constraint error is
      raised**.
- [ ] Soft-delete the `n:0` of a duplicate pair, re-import, and assert both rows are live with
      distinct ids — the key-collision case Decision 9 exists to prevent.
- [ ] Importing the **Windows-1252** fixture stores `Müller GmbH`, asserted by exact string
      equality. This is the cp1252 assertion that core's tests cannot make.
- [ ] `decodeBankCsv` returns `windows-1252` for the cp1252 fixture, and `utf-8` for
      `sparkasse-camt-18-utf8-bom.csv` with the BOM stripped — assert the first header key is
      `Auftragskonto`, not `﻿Auftragskonto`.
- [ ] `sparkasse-camt-18-bad-rows.csv` returns `failed.length === 3` with correct line numbers and
      codes, and the good rows are stored.
- [ ] `sparkasse-camt-malformed.csv` returns **4xx**, not 500, and imports nothing.
- [ ] An import whose `Auftragskonto` differs from the selected `Account.iban` still succeeds and
      stores the file's value in `Transaction.accountIban`.
- [ ] `pnpm check` green.

### Phase 5: Web UI and end-to-end coverage

Dependencies: Phase 4. The slice becomes usable, and the hello slice retires.

```
Household Budget                    [DE89…3000 ▾]
─────────────────────────────────────────────────
  Import CSV        ┌─────────────────────────┐
                    │  Drop Sparkasse export  │
                    │   or click to choose    │
                    └─────────────────────────┘

  ✓ 197 imported · 41 duplicates skipped · 3 failed   [windows-1252]
    ▸ line 88: amount "12,3,4" not parseable
    ▸ line 91: date "32.13.25" not parseable
─────────────────────────────────────────────────
  Datum       Empfänger        Zweck        Betrag
  22.09.2025  Müller GmbH      Rechnung   -832,90 €
  21.09.2025  REWE SAGT…       Karte       -42,17 €
  21.09.2025  REWE SAGT…       Karte       -42,17 €
  20.09.2025  Ärzte GmbH  ⏳    Gebühr      -19,00 €
                              ⏳ = vorgemerkt
```

**Tasks**:

- [ ] Install `react-router` in `apps/web` with an explicit version pin, so it lands in the
      lockfile deliberately.
- [ ] Add the router; `/` renders the account page.
- [ ] **Repoint Playwright's readiness probe first.** Change `API_READY_URL` in
      `apps/web/playwright.config.ts:5` from `/api/hello` to `/api/accounts`, which returns `200`
      with `[]`. Doing this before removing the hello route keeps `check:all` green throughout.
- [ ] Retire the hello slice in one step: delete `packages/core/src/hello.ts` and `hello.test.ts`
      and their exports from `index.ts`; delete `apps/api/src/hello/` and its import in
      `app.module.ts:4,12`; delete `apps/web/src/pages/HelloPage.tsx` and `HelloPage.test.tsx`;
      remove `fetchHello` and the `HelloPayload` import from `apps/web/src/api/client.ts:1,8`;
      update `App.tsx`.
- [ ] Extend `apps/web/src/api/client.ts` with `listAccounts`, `createAccount`, `uploadImport`
      (multipart `FormData`) and `listTransactions`. Keep relative `/api` paths.
- [ ] Add an account selector; if no account exists, show a create form first.
- [ ] Add `ImportPanel.tsx` — file input plus drag-and-drop, disabled while uploading, then the
      summary. Render the detected encoding as a chip, and render `duplicateOfBatchId` as a "you
      already uploaded this file" notice. Failures render as a list with line numbers, not behind
      a toggle.
- [ ] Add `TransactionList.tsx`. Format amounts with
      `Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })` and dates with
      `Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })` — the
      default `de-DE` date format is `22.9.2025`, unpadded. Badge pending rows with
      `aria-label="vorgemerkt"` so the e2e test has a stable handle.
- [ ] Localize `ImportErrorCode` to German and English strings in the web app. Core returns codes;
      the UI owns the wording.
- [ ] Give the e2e run its own database: set `DATABASE_URL=file:./data/e2e.db` in the
      `webServer.env` of the API entry in `playwright.config.ts`, and delete that file before
      `db:push` in the `test:e2e` script. Without this the suite passes once and then fails —
      `Account.iban` is `@unique`, so the second run's account creation 500s, and "0 imported on
      the second upload" becomes true on the _first_ upload of run two.
- [ ] Rewrite `apps/web/e2e/smoke.spec.ts` for the new root page, and add
      `apps/web/e2e/import.spec.ts` that creates an account, uploads `fixtures/sparkasse-camt-18.csv`
      via `setInputFiles`, and asserts the result.
- [ ] Update `CLAUDE.md` — replace "Status: skeleton" and the `GET /api/hello` description with
      the import feature, and add `fixtures/` to the repo map. Update `README.md`'s layout and
      "How the pieces connect" sections for the same reason, and add `binaries.prisma.sh` to
      Prerequisites.

**Automated Verification**:

- [ ] The e2e test uploads the cp1252 fixture and asserts `Müller GmbH` is visible — the full
      Windows-1252 → browser path, which no unit test covers.
- [ ] The e2e test asserts an amount renders as `-832,90 €` — **U+002D hyphen-minus and U+00A0
      no-break space**, verified on this machine. Assert with a normalizing comparison
      (`text.replace(/ /g, ' ')`) or a regex on `832,90` rather than pasting the literal.
- [ ] The e2e test asserts the pending row via `getByLabel('vorgemerkt')`.
- [ ] Uploading the same fixture twice shows `0 imported` and the duplicate-file notice.
- [ ] `pnpm check:all` green, Playwright included.

**Manual Verification**:

- [ ] Export a real CSV from Sparkasse online banking, import it, and confirm the transaction
      count and a handful of amounts match what the bank's own UI shows. This is the only check
      that can catch a V8 column present in reality but absent from the synthetic fixtures. Do
      **not** commit that file — `.gitignore` and the pre-commit data guard both block it.
- [ ] Confirm the encoding chip shows `windows-1252` for that real export. A surprise `utf-8`
      means the bank changed its export format.

## Implementation Notes

### Phase 1

- **`sparkasse-camt-17.csv` is UTF-8, not Windows-1252.** The fixture list implies it inherits
  the 18-column file's encoding, but Phase 2 has core's `parse.test.ts` read it through Vite's
  `?raw`, which decodes as UTF-8. cp1252 bytes read that way become mojibake, and the
  "both fixtures parse identically" test would fail on the umlauts for the wrong reason. Same
  reasoning applies to `sparkasse-camt-18-bad-rows.csv`, also read by core.
  `sparkasse-camt-malformed.csv` is pure ASCII, so its encoding is moot. The two fixtures only
  `apps/api` reads — `sparkasse-camt-18.csv` and `sparkasse-camt-18-next.csv` — are
  Windows-1252, which is what a real export is, and which is what the encoding assertions need.
- **`parseGermanAmount` and `parseGermanDate` return `undefined` on failure, not a result
  object.** Each has exactly one failure mode, so the caller already knows which
  `ImportErrorCode` and which German field name to put in the `RowError`; a union would carry
  no information the call site does not have. This also keeps the plan's verification criteria
  literally true (`parseGermanAmount('832,9') === 83290`).
- `parseGermanDate` validates the calendar with plain arithmetic and a leap-year test rather
  than constructing a `Date`. Decision 7 is about the stored value, but avoiding `Date`
  entirely means no timezone can enter even by accident.
- The cp1252 byte check ran as a one-liner (`0xFC` present, `0xC3 0xBC` absent, and the
  decoded cp1252 file equals the UTF-8 twin byte for byte). Phase 4's `decodeBankCsv` test is
  the durable version of that guard.
- Fixtures were generated from one shared row set by a throwaway script, so the 17- and
  18-column files cannot drift apart. The fixtures are the artefact; the script is not
  committed.
- Prettier is not idempotent on a fenced code block indented inside a `- [ ]` list item: it
  rewrote three of this plan's `ts` fences into inline code, and `format:check` then failed on
  its own output. Those three blocks were moved to the left margin. Worth knowing before
  adding a nested code block to a plan.

### Phase 2

The gate task caught two of the three things it was written to catch.

- **Gate 1 failed, and the fix was the resolver, not the rule.** `pnpm lint:deps` reported
  `not-to-unresolvable: packages/core/src/csv/parse.ts → csv-parse/sync`. The bare specifier
  `csv-parse` resolved; only the subpath did — dependency-cruiser was not reading the package's
  `exports` map. `.dependency-cruiser.cjs` now sets `enhancedResolveOptions.exportsFields` and
  `conditionNames`. This is not the check being weakened: a genuinely missing package and a
  type-only `@nestjs/common` import were both re-confirmed to still fail after the change.
- **Gate 3 failed: the Node build of csv-parse puts `Buffer` in the web bundle.** Forcing
  `apps/web` to reference the parser produced a bundle with four `Buffer` references from
  csv-parse's own code — `Buffer.allocUnsafe`, `Buffer.isBuffer` — which is an undefined global
  in a browser. `csv-parse/browser/esm/sync` removes the crash but bundles a `buffer` polyfill
  instead, still leaving `Buffer` in the output and costing ~22 kB.
  **Took the plan's first remedy: `parse.ts` is not exported from the package root.** It lives
  behind a new `@household-budget/core/csv` subpath (`packages/core/src/csv/index.ts`) that only
  `apps/api` imports. Re-verified: forcing `apps/web` to reference the root entry emits a bundle
  with **zero** `Buffer` references and no csv-parse bytes, at the baseline 362 kB. The root
  entry stays browser-safe and keeps the types the UI needs; the API gets csv-parse's proper
  Node build. Tree-shaking would probably have hidden this, which is exactly why relying on it
  would have been the wrong answer.
- **csv-parse's `info.lines` is wrong for this repo's fixtures.** It counts a CRLF inside a
  quoted field as two lines, so every row after a multi-line `Verwendungszweck` is reported one
  line too high — and a real export is CRLF with multi-line purposes. Measured: with a CRLF
  file, an embedded LF reports correctly and an embedded CRLF does not. `parse.ts` computes
  line numbers itself by walking the source text with each record's verbatim `raw` slice.
  A second quirk showed up there: a record that follows a skipped empty line arrives with the
  blank line's leftover `\r` glued to the front of its `raw`, which then matches nothing in the
  source. The leading newline characters are stripped before the search.
- No conditional spread was needed for the csv-parse options after all — every value is a
  literal, so `exactOptionalPropertyTypes` has nothing to reject. The plan's warning applies
  the moment one of them becomes `string | undefined`.
- File-level failures are thrown, not returned: `CsvFileError` for `HEADER_NOT_FOUND` and
  `REQUIRED_COLUMN_MISSING`, alongside csv-parse's own `CsvError`. One error channel for the
  two file-level cases is what lets Phase 4 map both to a single 4xx.
- `FIELD_COUNT_MISMATCH` is unreachable while `relax_column_count` is false — csv-parse throws
  `CSV_RECORD_INCONSISTENT_FIELDS_LENGTH` first. The check is kept as a guard: if that option
  ever relaxes, a ragged row degrades to a reported row rather than to silently shifted columns.
- A row reports its **first** failure and is skipped. The bad-rows fixture has one defect per
  row, so this is invisible there, but a row with two defects reports one.
- Core needed a hand-written `declare module '*?raw'`: `vite/client` is not in scope under
  `"types": []`, and pulling it in would put DOM and Node globals back within core's reach.

## References

- [`docs/research/01-csv-import.md`](../research/01-csv-import.md) — format research and every
  measured finding this plan depends on
- `packages/core/tsconfig.json:7` — `"types": []`, the constraint behind the core/api split
- `packages/core/src/hello.ts` — injectable-clock precedent
- `apps/api/src/prisma/prisma.service.ts`, `prisma.module.ts:5` — `@Global()` PrismaService
- `apps/api/src/config/database.ts:16-19` — `DATABASE_URL` read at construction; matters for tests
- `apps/web/playwright.config.ts:4,32` — the API readiness probe that Phase 5 repoints
- `.dependency-cruiser.cjs:14,33-41` — `core-stays-framework-free` and `not-to-unresolvable`
- `CLAUDE.md` — RULES: core framework-free, never commit real bank data, `pnpm check` before done
