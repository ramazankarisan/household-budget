# The registry seam

Read this when `packages/core/src/csv/dialects/` does not exist yet. It describes the
one-time extraction that turns the Sparkasse-only parser into a registry the second bank
plugs into.

Do it as its own commit, before any new bank exists. The Sparkasse test file must be
edited only where a symbol was renamed, and must stay green. If it needs new assertions to
pass, the extraction changed behaviour and that is a bug, not a refactor.

## What is bank-specific today

| Fact                                                      | Where it is now                         |
| --------------------------------------------------------- | --------------------------------------- |
| `HEADER_MARKERS = ['Auftragskonto', 'Betrag']`            | `csv/header.ts` module scope            |
| `REQUIRED_COLUMNS` (5 German names)                       | `csv/header.ts`, exported               |
| `COLUMN` (semantic field → German header name)            | `csv/parse.ts` module scope             |
| `STATUS_BY_INFO` (`Umsatz gebucht` / `Umsatz vorgemerkt`) | `csv/parse.ts` module scope             |
| `delimiter: ';'` and the other `csv-parse` options        | `csv/parse.ts`, inline literals         |
| `dialect: 'sparkasse-camt'`                               | written into every `Transaction.source` |
| German amount and date parsers                            | `csv/fields.ts`, shared already         |

Everything else in `parse.ts` — header scanning, line-number reconstruction, the
required-field checks, the `raw` snapshot, the row-error accumulation — is bank-agnostic
and stays exactly where it is.

## Target shape

```
packages/core/src/csv/
  dialects/
    types.ts          BankDialect, BankDialectId
    sparkasse-camt.ts the descriptor extracted from header.ts + parse.ts
    index.ts          DIALECTS, detectDialect()
  parse.ts            parseBankCsv(text, context) over a descriptor
  header.ts           findHeaderLine(text, markers) — markers now a parameter
```

```ts
// dialects/types.ts
export type BankDialectId = 'sparkasse-camt';

/** Semantic field → the column name this bank uses for it. Optional where the bank has none. */
export interface ColumnBindings {
  readonly accountIban: string;
  readonly bookingDate: string;
  readonly amount: string;
  readonly currency: string;
  readonly valueDate?: string;
  readonly status?: string;
  readonly counterpartyName?: string;
  // … the rest of Transaction's optional fields
}

export interface BankDialect {
  readonly id: BankDialectId;
  /** Tokens that identify this bank's header line. Two is usually enough and cheap to scan for. */
  readonly headerMarkers: readonly string[];
  /** Columns without which a row cannot become a Transaction. Missing one is a file-level 4xx. */
  readonly requiredColumns: readonly string[];
  readonly columns: ColumnBindings;
  /** Raw status value → BookingStatus. Absent means the export has no pending concept: every row is booked. */
  readonly statusByValue?: ReadonlyMap<string, BookingStatus>;
  readonly delimiter: string;
  readonly parseAmount: (raw: string) => Cents | undefined;
  readonly parseDate: (raw: string, options: ParseGermanDateOptions) => string | undefined;
  /**
   * Where the own account's IBAN comes from. Sparkasse repeats it per row, so a column
   * binding covers it; ING states it once in the preamble; N26 never names it and the API
   * falls back to the account the user picked for the upload.
   */
  readonly accountIban?:
    | { readonly from: 'column' }
    | { readonly from: 'preamble'; readonly match: RegExp }
    | { readonly from: 'context' };
}
```

`accountIban` is the one member here that is not visible in the Sparkasse parser: it looks
like a plain column until a second bank arrives, and two independent attempts at a second
dialect both hit it. Model it when that bank lands — the alternative is `accountIban`
quietly going optional on `Transaction` under time pressure, leaving every consumer to
handle an absence only one dialect can produce.

Keep the descriptor declarative. The moment a dialect carries a `mapRow` callback, two
banks can disagree about what a required field is, and the failure shows up as a row error
in production rather than as a type error at build time.

## Detection

```ts
export function detectDialect(
  text: string,
): { readonly dialect: BankDialect; readonly headerLine: number } | undefined;
```

Scan the first 30 lines once, and for each line ask every registered dialect whether all of
its markers are present. Two rules keep it honest:

- **Most markers matched wins**, so a specific dialect beats a generic one on a header both
  recognise. Ties are a registry bug: throw rather than pick by array order, because
  array-order-dependent behaviour is the kind of thing a later alphabetical sort breaks.
- **No match is `HEADER_NOT_FOUND`**, the existing file-level error. The API already turns
  it into a 4xx.

Detection by header beats asking the user which bank a file is from: the header is in the
file, the user's answer can be wrong, and a wrong answer parses a real file into wrong
numbers instead of failing.

## Extraction order

1. Add `dialects/types.ts`. Nothing imports it yet.
2. Add `dialects/sparkasse-camt.ts`, moving the constants verbatim out of `header.ts` and
   `parse.ts`. Do not "clean them up" in the same step.
3. Give `findHeaderLine` a markers parameter; `mapColumns` takes the required-column list.
4. Rename `parseSparkasseCsv` to `parseBankCsv` and thread the descriptor through
   `mapRow`. Export `parseSparkasseCsv` as a thin wrapper that resolves the Sparkasse
   descriptor, so `apps/api` and the existing tests keep compiling in this commit.
5. Add `dialects/index.ts` with `DIALECTS` and `detectDialect`.
6. Export what `apps/api` needs from `csv/index.ts`; keep `csv-parse` behind that subpath.
7. `pnpm check`. The Sparkasse tests must pass untouched apart from renamed imports.

Retire the `parseSparkasseCsv` wrapper in the commit that adds the second bank, once
`apps/api` calls `detectDialect` + `parseBankCsv`. Leaving it behind after that point means
a call site that can never see the new bank.
