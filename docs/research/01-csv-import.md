---
date: 2026-09-22T13:07:40Z
git_commit: dbb9660abe6805ca6058be85ec415de161cac84e
branch: docs/csv-import-research
topic: 'CSV import for German bank exports (Sparkasse CSV-CAMT, DKB)'
tags: [research, csv-import, packages-core, encoding, deduplication, sparkasse, dkb]
status: complete
---

# Research: CSV import for German bank exports

## Research question

How should CSV import for German bank exports be implemented in this repo? Cover encoding,
the semicolon delimiter, decimal comma, German dates, preamble lines, a normalized
`Transaction` type for `packages/core`, duplicate detection on re-import, and whether to use a
parsing library or hand-roll one.

## Summary

The import splits cleanly along the repo's existing architectural seam, and the seam is not
where you would first guess. **`packages/core` cannot decode bytes and cannot hash** — not
because of a rule, but because its TypeScript environment forbids both, and because
`apps/web` imports core and would break in a browser. So byte handling belongs in `apps/api`,
and `packages/core` gets a pure `string → Transaction[]` pipeline plus a canonical
serialization that somebody else hashes.

The five substantive decisions:

| Decision | Choice                                                      | Confidence                                |
| -------- | ----------------------------------------------------------- | ----------------------------------------- |
| Parser   | `csv-parse` 7.x via `csv-parse/sync`                        | High — only true-ESM, zero-dep option     |
| Encoding | Strict UTF-8 decode, fall back to `windows-1252`            | High — measured, structural not heuristic |
| Money    | Integer cents, branded type, regex straight from the string | High                                      |
| Date     | `Buchungstag` primary, `Valutadatum` stored alongside       | Medium — genuinely a convention           |
| Dedup    | Content fingerprint + occurrence discriminator              | High on shape, medium on field list       |

```
packages/core/src/
  hello.ts              existing; to be deleted when real domain lands
  index.ts              public surface (index.ts:1-2)
  csv/                  NEW — all pure, all string-in
    detect.ts             header scan, dialect identification
    parse.ts              csv-parse wrapper, row → RawRow
    fields.ts             parseGermanAmount, parseGermanDate
    transaction.ts        the normalized Transaction type
    fingerprint.ts        canonical serialization (NOT hashing)
apps/api/src/import/    NEW — everything that touches bytes or node:crypto
  decode.ts               Uint8Array → { text, encoding }
  hash.ts                 node:crypto over core's canonical string
  import.service.ts       orchestration + persistence
apps/api/prisma/schema.prisma   greenfield — no models today (schema.prisma:1-14)
fixtures/                NEW — synthetic CSVs only, never real bank data
```

```
 bytes ──► apps/api/decode.ts ──► string ──► packages/core ──► Transaction[]
           (TextDecoder,                     (csv-parse, pure)      │
            UTF-8 → cp1252)                                         │
                                                      canonicalString(tx)
                                                                    │
           apps/api/hash.ts ◄───────────────────────────────────────┘
           (node:crypto)  ──► dedupKey ──► Prisma upsert
```

## Corrections to the brief

Four premises in the original request did not survive research. They are listed first because
they change what gets built.

1. **The 18th column `Kategorie` is unconfirmed.** Every primary source — Firefly III's real
   user-contributed import configs, actual sample files, a bug report with a pasted header —
   shows **17 columns ending at `Info`**. The only sources claiming `Kategorie` are
   AI-generated SEO content farms. The supplied header is plausibly a newer variant, but it is
   not the documented one. **Consequence: match columns by header name, never by index, and
   treat `Kategorie` as optional.** This also makes the 17/18 question moot.

2. **Sparkasse dates are `DD.MM.YY`, not `DD.MM.YYYY`.** Every real sample uses two-digit
   years (`"05.12.25"`, `"23.09.24"`), and Firefly III's config declares `"date": "d.m.y"`.
   Worse, **mixed widths within a single row are documented**:
   `"00000000";"24.03.14";"01.04.2014";…`. Parse both widths per field, per row, with a sliding
   pivot for two-digit years.

3. **Thousands separators were not observed.** No primary sample shows `1.234,56`. One real
   sample directly refutes it: `-1143,41`, over a thousand, unseparated. Handle them anyway —
   the regex costs nothing — but do not design around them. The _real_ amount trap is the
   opposite: Sparkasse truncates trailing zeros, writing `832,9` and `-190` rather than
   `832,90` / `-190,00`.

4. **Sparkasse has no preamble; DKB does.** The brief assumed preamble handling generally.
   Sparkasse's header is line 1. DKB has 4 lines (current format) or ~6 (legacy), and sources
   disagree on the legacy count — which is precisely why a fixed skip count is the wrong
   mechanism.

**Resolved since writing:** the brief left the bank as `[DKB/Sparkasse — insert yours]`. The
user has since confirmed **Sparkasse CSV-CAMT only**, and that **`Kategorie` is real** — it is
one of the export options Sparkasse offers. Correction 1 above therefore stands as a statement
about the public record, not about this repo's target: both a 17- and an 18-column CSV-CAMT
exist, which is exactly why columns must be matched by name. DKB content is retained below for
the day it is added, and clearly marked out of scope. See "Decisions confirmed".

## Detailed findings

### 1. The repo constraint that drives the architecture

`packages/core/tsconfig.json:7` sets `"types": []` and `lib: ["ES2023"]`. Measured on this
checkout:

```
import { createHash } from 'node:crypto';   → error TS2591: Cannot find name 'node:crypto'
new TextDecoder('windows-1252')             → error TS2304: Cannot find name 'TextDecoder'
```

**Installing `@types/node` into `packages/core` does not fix this.** That was tested directly:
with `@types/node` present and `"types": []` retained, both errors persist unchanged. To use
`node:crypto` in core you must _also_ set `"types": ["node"]`.

That would be the wrong trade. `apps/web` imports `@household-budget/core` — `HelloPage.tsx`
calls `describeHello` — so core is bundled into the browser. A core that imports `node:crypto`
breaks that bundle. The `core-stays-framework-free` rule in `.dependency-cruiser.cjs:14` would
not catch it, since it only forbids `@nestjs`/`@prisma`/`react`; this is a constraint the
rule does not express.

**Therefore:** core takes `string`, not bytes. Core produces a canonical string to hash, and
does not hash it. Both crossings live in `apps/api`.

There is precedent in core already: `buildHelloPayload` takes an injectable clock
(`now?: Date`) rather than reading the ambient time, specifically so it stays pure and
testable. The same pattern applies — inject the hash, or return the input to it.

### 2. Encoding

German bank exports are Windows-1252, except current DKB, which is UTF-8 **with BOM**.

Detection is unnecessary. UTF-8 is structurally self-validating, so _validate_ instead:

```ts
// apps/api/src/import/decode.ts
export function decodeBankCsv(bytes: Uint8Array): {
  text: string;
  encoding: 'utf-8' | 'windows-1252';
} {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}
```

Measured on this machine (Node 24.21.0, full ICU):

```
cp1252 bytes  → utf-8 fatal throws → windows-1252 → "Gebühr"
utf8 bytes    → utf-8 decodes                     → "Gebühr"
utf8 + BOM    → utf-8 decodes, BOM stripped       → "Gebühr"
```

Why this is a proof and not a heuristic: German umlauts are almost always followed by ASCII
letters. `Müller` is `… FC 6C …` — `0xFC` is not a legal UTF-8 lead byte at all. `Straße` is
`… DF 65` — `0xDF` is a legal lead, but `e` is not a continuation byte. The UTF-8
interpretation dies immediately.

Three details that matter:

- **Use `windows-1252`, never `latin1`.** They agree on every umlaut (all ≥ 0xA0) but diverge
  at 0x80–0x9F, where cp1252 has `€`, curly quotes, en-dash and ellipsis — characters that
  really do appear in _Verwendungszweck_. Under `latin1` they become invisible C1 controls.
- **`TextDecoder('windows-1252')` can never throw.** WHATWG maps all 256 bytes. That makes it
  a safe terminal fallback.
- **`TextDecoder` strips the UTF-8 BOM; `Buffer.toString('utf8')` does not.** Skipping it
  leaves your first header key as `"﻿Auftragskonto"`, and `row.Auftragskonto` is silently
  `undefined`. This is a documented cause of "0 transactions imported" against DKB.

Mojibake reference for tests and error messages — UTF-8 bytes wrongly read as cp1252:

| `ä`  | `ö`  | `ü`  | `Ä`  | `Ö`  | `Ü`  | `ß`  | `€`   |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- | ----- |
| `Ã¤` | `Ã¶` | `Ã¼` | `Ã„` | `Ã–` | `Ãœ` | `ÃŸ` | `â‚¬` |

The reverse — cp1252 bytes read as UTF-8 — yields U+FFFD: `M�ller`, `Stra�e`.

No `chardet`, `jschardet` or `iconv-lite` needed. `iconv-lite` is only required to _write_
legacy encodings, since `TextEncoder` is UTF-8-only by spec.

### 3. Parser choice: `csv-parse`

|                   | csv-parse 7.0.2          | papaparse 5.7.0    | fast-csv 5.0.7          |
| ----------------- | ------------------------ | ------------------ | ----------------------- |
| ESM               | real dual ESM/CJS        | **CJS only**       | CJS only                |
| Runtime deps      | **0**                    | 0                  | 3 lodash micro-packages |
| Types             | bundled, generic         | `@types/papaparse` | bundled                 |
| Sync string parse | yes                      | yes                | **no, stream-only**     |
| Skip preamble     | `from_line: N`           | `skipFirstNLines`  | `skipLines`             |
| BOM               | **`bom: true` required** | auto               | auto                    |

**Recommendation: `csv-parse` via `csv-parse/sync`.** It is the only true-ESM option, which
matters because core and api are `module: Node16` ESM. Zero dependencies, bundled generic
types, named error codes, and it tests against the csv-spectrum acid suite.

Two traps specific to this repo:

- `import { parse } from 'papaparse'` **typechecks and then throws at runtime**:
  `SyntaxError: Named export 'parse' not found`. tsc exits 0. If papaparse is ever chosen,
  it must be `import Papa from 'papaparse'`.
- `csv-parse`'s `lib/index.d.ts` opens with `/// <reference types="node" />`, so importing it
  re-enables Node globals (`Buffer`, `process`) inside core despite `"types": []`. Not a
  correctness bug, but it silently removes a guardrail. Worth a comment where it is imported.
- Under `exactOptionalPropertyTypes`, csv-parse rejects `{ delimiter: maybeUndefined }`
  (TS2379/TS2769) because its optional props omit `| undefined`. Use conditional spread.

**Why not hand-roll.** A 31-line state machine was tested against csv-spectrum and matched
csv-parse on every valid-input case. The difference is malformed input:

| input                         | hand-rolled                                    | csv-parse                                      |
| ----------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| `a;"b;c` (unterminated quote) | `["a","b;c"]` — **swallows rest of file**      | throws `CSV_QUOTE_NOT_CLOSED`                  |
| `a;"b"x;d` (junk after quote) | `["a","bx","d"]` — **silently eats the quote** | throws `CSV_INVALID_CLOSING_QUOTE`             |
| ragged rows                   | accepted                                       | throws `CSV_RECORD_INCONSISTENT_FIELDS_LENGTH` |

For money, silent corruption is the worst available failure mode. A truncated download should
produce a named, catchable error, not quietly wrong numbers.

**The mixed quoting in the supplied header is a non-issue.** `Auftragskonto;"Buchungstag";…`
is explicitly legal: RFC 4180 §2 rule 5 says each field _may or may not_ be quoted — per
field, not per row. Any RFC4180 parser handles it. Do strip surrounding quotes from header
tokens before matching, since quoting varies between institutions.

### 4. Finding the header

**Never hard-code a skip count.** Sparkasse's header is line 1; DKB's is line 5 (current) or
~7 (legacy), and sources disagree on legacy. Scan instead — this is what `dkb2homebank` does,
and one function covers both DKB generations with no branching:

```
scan the first ~30 lines; the header is the first line containing the expected
column tokens for a known dialect (e.g. "Buchungstag" + "Betrag", or
"Buchungsdatum" + "Wertstellung"), split on ';' after quote-stripping
```

Also validate each data row's field count against the header, so trailing footer lines —
Volksbank exports have three — get dropped naturally rather than parsed into garbage.

Preamble counts found across German banks, for the dialect table: Sparkasse 0, DKB 4 (current)
/ ~6 (legacy), comdirect 3 (inconsistent), ING 12–13, Postbank 7, Deutsche Bank 5, Volksbank
0–12 plus 3 footer lines, Commerzbank 0. Fintechs (N26, Revolut, Wise) export clean single
headers. The pattern: legacy retail banks ship preambles, Sparkasse being the exception.

### 5. Amounts

Parse the German string **directly into integer cents**. Never `parseFloat(x) * 100` — that
pattern is itself the bug. Measured on Node 24.21.0:

```
19.99 * 100               → 1998.9999999999998
Math.round(1.005 * 100)   → 100        ← not 101
0.1 + 0.2                 → 0.30000000000000004
```

```ts
const AMOUNT = /^(-?)(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/;
// "-1.250,00" → -125000   "-42,17" → -4217   "12,3" → 1230   "-190" → -19000
```

Note the last two cases — they are the Sparkasse trailing-zero truncation, and a parser that
assumes exactly two decimals gets them wrong by a factor of ten.

`Number.MAX_SAFE_INTEGER` is €90 trillion in cents, so plain `number` is sufficient. Brand it
so cents and euros cannot be confused:

```ts
export type Cents = number & { readonly __brand: 'Cents' };
```

No money library needed for a budgeting app that only adds and subtracts. Reach for
dinero.js 2.0.2 the day proportional splits appear — its `allocate()` is the thing that is
otherwise subtly wrong. Format at the edge with
`Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })`.

DKB embeds the € symbol in the amount field; strip it before parsing.

### 6. Dates: `Buchungstag` vs `Valutadatum`

- **Buchungstag** (booking date) — when the bank recorded it. Administrative.
- **Valutadatum / Wertstellung** (value date) — when the money actually becomes
  available or unavailable. Interest accrues on this one; it is governed by § 675t BGB.

**The tools genuinely disagree.** Firefly III defers to the user and imports both. GnuCash's
German community recommends Wertstellung, because it drives interest and the truly available
balance. Portfolio Performance's community thread is unresolved. hledger and beancount have no
preference.

**Recommendation: `Buchungstag` as the primary grouping date, `Valutadatum` stored alongside.**
Reasoning — this is a design judgment, not something the sources state:

1. Users reconcile against what they see on the statement, and both banks sort and display by
   booking date.
2. Value date can land in a different month than booking date for card payments and
   weekend/holiday transactions, silently shifting spend across a month boundary in a way the
   user cannot explain.
3. GnuCash's argument is about interest accuracy and available balance — real for a ledger,
   not transferable to "which month did I spend this in".
4. Storing both costs one column and leaves the choice reversible.

**Timezone: store dates as plain `YYYY-MM-DD` strings, not `Date`.** A bank booking date is a
calendar date with no time and no zone. Converting to `Date` introduces a UTC midnight that
shifts backwards a day for anyone west of Greenwich, which is exactly how transactions end up
in the wrong month.

### 7. The normalized `Transaction` type

Framework-free, browser-safe, no Node types. Optional fields are genuinely optional —
`exactOptionalPropertyTypes` is on, so `?:` and `| undefined` are not interchangeable.

```ts
// packages/core/src/csv/transaction.ts
export type Cents = number & { readonly __brand: 'Cents' };

/** Booking status. Pending rows are excluded from dedup — see §8. */
export type BookingStatus = 'booked' | 'pending';

export interface Transaction {
  /**
   * Own account, IBAN, spaces stripped. Provenance and cross-checking only — the account an
   * import belongs to is chosen by the user before upload, never inferred from this.
   */
  readonly accountIban: string;
  /** Booking date, 'YYYY-MM-DD'. Primary date for budgeting. */
  readonly bookingDate: string;
  /** Value date, 'YYYY-MM-DD'. Stored, not used for grouping. */
  readonly valueDate?: string;
  /** Signed minor units. Negative is money out. */
  readonly amount: Cents;
  /** ISO 4217, normally 'EUR'. */
  readonly currency: string;
  readonly status: BookingStatus;

  /** Counterparty — Beguenstigter/Zahlungspflichtiger, or DKB's payer/payee pair. */
  readonly counterpartyName?: string;
  readonly counterpartyIban?: string;
  readonly counterpartyBic?: string;

  /** Verwendungszweck. */
  readonly purpose?: string;
  /** Buchungstext / Umsatztyp — the bank's own transaction-type label. */
  readonly bookingText?: string;

  /** SEPA references. Present on direct debits, often empty. */
  readonly endToEndRef?: string;
  readonly mandateRef?: string;
  readonly creditorId?: string;

  /** Bank-assigned category, when the export carries one. Never trusted as a key. */
  readonly bankCategory?: string;

  /** Provenance — which file and line this came from. */
  readonly source: TransactionSource;
}

export interface TransactionSource {
  /** Only Sparkasse CSV-CAMT is in scope today; the union exists so adding one is additive. */
  readonly dialect: 'sparkasse-camt';
  readonly fileName: string;
  readonly lineNumber: number;
  /** Encoding actually used to decode the file. Log it. */
  readonly encoding: 'utf-8' | 'windows-1252';
  /** The row verbatim, so a normalization change can re-key without a re-download. */
  readonly raw: Readonly<Record<string, string>>;
}
```

Column mapping:

| `Transaction`      | Sparkasse CSV-CAMT                  | DKB current                                     | DKB legacy                    |
| ------------------ | ----------------------------------- | ----------------------------------------------- | ----------------------------- |
| `accountIban`      | `Auftragskonto`                     | from preamble                                   | from preamble                 |
| `bookingDate`      | `Buchungstag`                       | `Buchungsdatum`                                 | `Buchungstag`                 |
| `valueDate`        | `Valutadatum`                       | `Wertstellung`                                  | `Wertstellung`                |
| `amount`           | `Betrag`                            | `Betrag (€)`                                    | `Betrag (EUR)`                |
| `currency`         | `Waehrung`                          | implied EUR                                     | implied EUR                   |
| `status`           | `Info`                              | `Status`                                        | always booked                 |
| `counterpartyName` | `Beguenstigter/Zahlungspflichtiger` | `Zahlungsempfänger*in` / `Zahlungspflichtige*r` | `Auftraggeber / Begünstigter` |
| `counterpartyIban` | `Kontonummer/IBAN`                  | `IBAN`                                          | `Kontonummer`                 |
| `purpose`          | `Verwendungszweck`                  | `Verwendungszweck`                              | `Verwendungszweck`            |
| `bookingText`      | `Buchungstext`                      | `Umsatztyp`                                     | `Buchungstext`                |
| `endToEndRef`      | `Kundenreferenz (End-to-End)`       | `Kundenreferenz`                                | `Kundenreferenz`              |
| `mandateRef`       | `Mandatsreferenz`                   | `Mandatsreferenz`                               | `Mandatsreferenz`             |
| `creditorId`       | `Glaeubiger ID`                     | `Gläubiger-ID`                                  | `Gläubiger-ID`                |
| `bankCategory`     | `Kategorie` (if present)            | —                                               | —                             |

DKB header-matching gotchas: business accounts use non-gendered `Zahlungspflichtiger` /
`Zahlungsempfängerin`, so match on the `Zahlungspflichtige` **prefix**; and `"Betrag (€)"`
versus `"Betrag(€)"` has been reported, so normalize whitespace before matching.

Sparkasse's `Info` column carries `Umsatz gebucht` / `Umsatz vorgemerkt` → `booked` /
`pending`. DKB's `Status` shows `Gebucht`; no official value list exists for the rest.

Deliberately **not** modelled: `Sammlerreferenz`, `Lastschrift Ursprungsbetrag`,
`Auslagenersatz Ruecklastschrift`. They only matter for returned direct debits, and they are
preserved in `source.raw` if they are ever needed.

### 8. Duplicate detection

**No German bank CSV gives you a stable ID.** Sparkasse's `Kundenreferenz (End-to-End)` is
frequently empty or non-unique — a real bug report shows a camt52v8 import with cell-based
detection on that column _still_ importing duplicates. DKB has no ID column at all. Treat any
bank-supplied identifier as a hint, never a key.

**Why a naive hash is wrong in both directions.** Hash too little and two genuinely distinct
same-day, same-amount purchases at the same merchant collapse into one. hledger explicitly
refuses to dedupe identical records "since these can happen legitimately in financial data";
Actual Budget shipped regressions doing exactly this. Hash too much — including volatile
fields — and the same transaction fails to match itself on the next export.

**Three German-specific traps that break naive hashing:**

1. **Pending rows.** `Umsatz vorgemerkt` rows reappear later as `Umsatz gebucht`, often with a
   **different `Buchungstag`** and changed `Verwendungszweck`. Exclude pending rows from dedup
   entirely — the same guard Actual Budget uses.
2. **Amount truncation.** `832,9` in one export and `832,90` in the next hash differently
   unless normalized to integer cents first.
3. **Encoding.** A mis-decoded `M�ller GmbH` breaks every hash for that payee. §2 is a
   prerequisite for this section, not an independent concern.

**Recommended shape — two parts.** Core builds the canonical string; `apps/api` hashes it.

```ts
// packages/core/src/csv/fingerprint.ts — pure, no node:crypto
const norm = (s: string | undefined): string =>
  (s ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();

/** Canonical serialization. Identical same-day transactions collide here BY DESIGN. */
export function fingerprintInput(t: Transaction): string {
  return JSON.stringify([
    'v1', // key-schema version — lets you re-key without wiping the database
    norm(t.accountIban).replace(/ /gu, ''),
    t.bookingDate,
    t.valueDate ?? '',
    String(t.amount), // integer cents — fixes "832,9" vs "832,90"
    norm(t.currency),
    norm(t.counterpartyName),
    norm(t.counterpartyIban).replace(/ /gu, ''),
    norm(t.purpose),
    norm(t.bookingText),
    norm(t.endToEndRef),
    norm(t.mandateRef),
    norm(t.creditorId),
  ]);
}
```

A **fixed-order array**, not an object — key order and optional-key presence cannot then change
the hash, and no field's content can forge a separator. `toLowerCase()` is not optional; case
drift between exports is Firefly III's own documented failure mode.

Then in `apps/api`, `crypto.hash('sha256', fingerprintInput(t), 'hex').slice(0, 32)` — 128
bits, collision probability ~10⁻²⁹ at 10⁵ rows. `crypto.hash` (Node ≥ 21.7 / 20.12) is ~2×
faster than `createHash` for small inputs.

**The discriminator.** Append a running balance if the export provides one (unique per
booking), otherwise an occurrence index. Critically, **assign the occurrence index by multiset
difference against what is already stored**, not by position within the file:
`newRows = max(0, countInFile − countInDb)` per fingerprint. Overlapping exports are the normal
case — you download "last 30 days" every month — and within-file indexing re-numbers
everything, so all rows look new. This is hledger's "skip the first N records on that date",
which is the one mechanism in this space that demonstrably survives same-day repeats.

**Persist alongside the key:** provenance (file name, line number, whole-file hash) and the raw
row verbatim — so a later change to normalization can re-key from stored data instead of asking
the user to re-download. That is Firefly III's single largest support burden.

**Soft-delete policy — decided.** The dedup lookup **excludes** soft-deleted rows, so deleting
a transaction and re-importing the same file brings it back. Deletion is local; the file is the
source of truth. This is deliberately the opposite of Firefly III, which looks up hashes
`withTrashed()` and therefore blocks re-import forever — a documented, perennial source of
confusion. The cost of this choice is the mirror image: a user who deletes a row to "get rid of
it" will see it return after the next overlapping import. If that becomes a complaint, the fix
is Actual Budget's: make it configurable rather than flipping the default.

### 9. Bilingual (German / English)

Secondary, but it touches three things in import specifically:

- **`bankCategory` is German, bank-assigned, and free-text.** Do not use it as the app's own
  category. Keep it as an import hint that seeds categorization rules; the app's categories
  need stable IDs with localized display names.
- **Error messages surfaced during import are user-facing** — "row 47: unparseable amount
  '12,3,4'" needs a German and an English form. Errors should therefore carry a machine
  code plus structured data, not a pre-formatted sentence. Core returns codes; the UI
  localizes.
- **`Buchungstext` values** (`FOLGELASTSCHRIFT`, `KARTENZAHLUNG`, `SEPA-UEBERWEISUNG`) are
  German bank terminology. Map them to a small internal enum rather than displaying them raw,
  so the English UI has something to show.

## Code references

- `packages/core/tsconfig.json:7` — `"types": []`; the constraint behind the whole architecture
- `packages/core/src/index.ts:1-2` — the public surface the CSV modules must be added to
- `packages/core/src/hello.ts` — `buildHelloPayload`'s injectable clock; the purity precedent
- `apps/api/prisma/schema.prisma:1-14` — generator and datasource only, no models; greenfield
- `.dependency-cruiser.cjs:14` — `core-stays-framework-free`; forbids nest/prisma/react but
  would **not** catch `node:crypto`
- `apps/web/src/pages/HelloPage.tsx` — proves core is browser-bundled
- `CLAUDE.md` RULES — core stays framework-free; never commit real bank data; fixtures synthetic

## Decisions confirmed (2026-09-22)

Four of the six open questions were answered directly by the user.

1. **Scope is Sparkasse CSV-CAMT only.** DKB is out of scope. The multi-dialect machinery in
   this report is therefore **not** needed on day one — but the header-scan approach and
   name-based column matching stay, because they cost nothing now and are what make a second
   dialect additive later rather than a rewrite.
2. **`Kategorie` is real.** The user confirms it is one of the CSV export options Sparkasse
   offers. So **both an 17-column and an 18-column CSV-CAMT shape exist in the wild** — the
   documented one ending at `Info`, and the one with `Kategorie`. This makes name-based column
   matching mandatory rather than merely advisable, and it is why the two required fixtures are
   these two shapes (see below).
3. **The account is chosen by the user before upload.** Imports are scoped to a pre-selected
   account; `Auftragskonto` is stored for provenance and cross-checking, but is never used to
   create or pick an account. This removes a whole class of silent "landed in the wrong
   account" failures.
4. **Deleted transactions come back on re-import.** Deletion is local; the bank file is the
   source of truth. Concretely: the dedup lookup must **exclude** soft-deleted rows — the
   opposite of Firefly III's `withTrashed()`, whose behaviour of blocking re-import forever is
   a documented and perennial source of user confusion.

5. **The export is CSV-CAMT V8**, the ISO 20022 `camt.053.001.08` generation. This is the
   forward-looking one — the Deutsche Kreditwirtschaft required migration off V2 by November
   2025 — and it is the likeliest explanation for the `Kategorie` column that no V2-era sample
   shows. No column-level V2/V8 difference could be confirmed from public sources, so treat the
   user's own 18-column header as the authority and V8 as the only target.
6. **Pending rows are present**, and **no running balance is confirmed**. Together these are
   the hardest combination for deduplication, and they decide §8 — see "Pending rows" below.

### Pending rows — the decided approach

`Umsatz vorgemerkt` rows are a **snapshot, not a ledger entry**. When the transaction books it
reappears with `Umsatz gebucht`, usually a **different `Buchungstag`**, and often a rewritten
`Verwendungszweck`. Any fingerprint over those fields therefore fails to match the pending row
against its own booked form. Trying to reconcile the two is the wrong problem to take on.

**Treat pending rows as a replaceable set, scoped to the account:**

1. Booked rows go through the fingerprint and occurrence logic in §8, unchanged.
2. Pending rows are **never fingerprinted and never deduped**.
3. On every import, **delete all stored pending rows for that account, then insert the pending
   rows from the file.** Pending is transient state; the newest export is always right.
4. When a pending row books, it simply arrives as a booked row on a later import and goes down
   the normal path. The stale pending copy is already gone, deleted by step 3.

This costs one delete-by-account-and-status per import and removes the entire class of
"pending row and its booked twin both present" bugs. It is the same guard Actual Budget uses
(`if (trans.cleared && !trans.transactionId)`), reached from the other direction.

Pending rows must also be **excluded from budget totals by default**, or a month's spend
changes as rows book. Showing them separately — "pending: −42,17 €" — is a UI decision, not an
import one.

**Because no running balance is confirmed**, the §8 discriminator falls back to the occurrence
index, computed by multiset difference against the database. Keep the balance branch in the
design: if a V8 export does turn out to carry one, it is strictly better and the switch is
local to `dedupKey`.

## Open questions

1. **Does the V8 export carry a running balance after all?** Not confirmed either way. Worth
   one look at a real file — it would replace occurrence counting with something exact.
2. **What is the full `Info` value set in V8?** Only `Umsatz gebucht` and `Umsatz vorgemerkt`
   are attested. Any third value should fail loudly on import rather than being silently
   treated as booked.

## Next step: the implementation plan

The plan that follows this research **must** include synthetic fixture CSVs, and they are the
first deliverable, not the last — the parser should be written against them.

**Required fixtures — two formats.** Since scope is now Sparkasse-only, the two formats are
the two CSV-CAMT shapes that genuinely exist, not two banks. This is the better test anyway:
it exercises name-based column matching, which is the mechanism everything else depends on.

- `fixtures/sparkasse-camt-18.csv` — **18 columns, ending with `Kategorie`.** The user's own
  export option. Header on line 1, `Auftragskonto` unquoted with the rest quoted,
  Windows-1252, `DD.MM.YY` dates.
- `fixtures/sparkasse-camt-17.csv` — **17 columns, ending at `Info`.** The shape every public
  sample shows. Same content otherwise, so a single parser must produce identical
  `Transaction` values from both, with `bankCategory` simply absent from the 17-column one.

If DKB is ever added, `fixtures/dkb-current.csv` (4 preamble lines, UTF-8 **with BOM**,
`Betrag (€)` with embedded € symbol) is the fixture to write — but it is out of scope today.

**Required edge cases**, spread across those files or as focused extra fixtures:

- **Empty lines** — blank lines between preamble and header, and trailing blank lines at EOF
- **Negative amounts** — and the truncated forms `832,9` and `-190` that the real exports emit
- **Umlauts** — `Müller`, `Straße`, `Gebühr`, `Ärzte GmbH` in counterparty and purpose, so an
  encoding regression fails a test instead of silently corrupting data
- A quoted field containing the delimiter — `"REWE SAGT DANKE; FILIALE 42"`
- A quoted field containing an embedded newline
- Doubled quotes — `""Nord""`
- Mixed date widths in one row — `"24.03.14";"01.04.2014"`
- A pending row (`Umsatz vorgemerkt`) that reappears booked with a different `Buchungstag`, to
  test dedup directly
- Two genuinely distinct same-day, same-amount, same-merchant rows, which must **not** collapse

Per `CLAUDE.md`, fixtures are **synthetic only** — invented IBANs, invented names, invented
amounts. Never a real statement, even redacted. `.gitignore` ignores `*.csv` with
`!**/fixtures/**/*.csv` as the sole exception, and `scripts/check-staged-data.mjs` blocks the
rest at commit time.

**Suggested plan sequencing:**

1. Fixtures + the `Transaction` type. No parsing yet.
2. `parseGermanAmount` / `parseGermanDate` in core, unit-tested against the edge cases above.
3. Header scan and dialect detection — the piece that handles both banks.
4. `csv-parse` wiring and row → `Transaction` mapping.
5. `decodeBankCsv` in `apps/api`, tested against byte fixtures for all three encodings.
6. `fingerprintInput` in core, hashing in `apps/api`, plus the occurrence-index logic.
7. Prisma model and the import endpoint. This is where the schema stops being empty.

Steps 1–4 and 6 are pure `packages/core` work, testable with Vitest and no database.
