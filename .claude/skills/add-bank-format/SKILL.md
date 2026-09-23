---
name: add-bank-format
description: Add support for a new bank's CSV export to household-budget — synthetic byte-exact fixture, a dialect parser in packages/core, a registry entry, unit tests, and the apps/api + apps/web + Playwright wiring that makes it import end to end. Use this whenever the user wants to import a statement the parser does not recognise, names a bank next to CSV/import/statement/Umsätze (DKB, ING, N26, Comdirect, Volksbank, Postbank, Deutsche Bank, Commerzbank, Revolut, Wise, …), reports HEADER_NOT_FOUND or REQUIRED_COLUMN_MISSING or "is this a Sparkasse CSV-CAMT export?", asks for a second dialect or multi-bank support, or pastes an unfamiliar export header — even if they never say "parser", "dialect" or "skill".
---

# Add a bank CSV format

Adding a bank means five artefacts, in this order: a **research note** (what the format
actually is), a **fixture** (byte-exact synthetic bytes), a **dialect** (the parser's
per-bank facts), **tests**, and the **wiring** through api, web and e2e.

The order is not decorative. The fixture is what every later step is written against, and
writing the parser first means writing it against a guess.

## 0. Check whether the registry seam exists

```bash
rg "dialect" packages/core/src/csv --type ts -l
ls packages/core/src/csv/dialects 2>/dev/null
```

If `packages/core/src/csv/dialects/` exists, a registry is already there — skip to step 1
and add a descriptor to it.

If it does not, the repo is still single-dialect: `header.ts` hard-codes Sparkasse's
`HEADER_MARKERS` and a global `REQUIRED_COLUMNS`, `parse.ts` hard-codes a `COLUMN` map, a
`STATUS_BY_INFO` map and the literal `dialect: 'sparkasse-camt'`, and
`TransactionSource.dialect` is a one-member union. Those are all per-bank facts living in
module scope, which works for one bank and silently mis-parses for two.

**Extract the seam first, as its own commit, with the Sparkasse tests unchanged and still
green.** A seam introduced while a second bank is half-written cannot be reviewed: a
failing test could be the refactor or the new bank. `references/registry-seam.md` has the
target shape and the extraction order. Come back here when `pnpm check` is green on a
commit that adds no new bank.

## 1. Pin the format down before writing code

Never invent column names. A wrong header token is invisible — the file parses, the column
reads empty, and the transaction is silently missing its purpose or its counterparty.

Get the real header from one of these, in order of preference:

1. A header line the user pastes from their own export (ask for the first ~15 lines with
   the amounts redacted — the header and preamble carry no money).
2. A cited public source: the bank's export documentation, or an existing open-source
   importer for that bank.

`references/german-banks.md` collects what previous research already established about
German exports — preamble line counts, decimal and date conventions, which banks carry a
booking-status column at all. Read it before searching the web; it exists so nobody
researches Sparkasse's preamble a third time.

Write the answer to `docs/research/NN-<bank>-csv.md` (next free number), following the
shape of `docs/research/01-csv-import.md`: the question, a summary, findings with sources,
and the decisions taken. The repo rule is that research is committed so it is not repeated
— a note nobody wrote is a search somebody redoes.

Nail down these, because each one is a branch in the parser:

| Question                                                         | Why it decides code                                                                                                                                   |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delimiter, quoting                                               | `csv-parse` options in the dialect descriptor                                                                                                         |
| Preamble lines before the header                                 | Header scan limit — never a skip count                                                                                                                |
| Exact header tokens (with quoting and spacing)                   | `headerMarkers` and `columns` bindings                                                                                                                |
| Which columns are required for a `Transaction`                   | `requiredColumns`; a missing one is a 4xx, not a row error                                                                                            |
| Decimal separator, thousands separator, trailing-zero truncation | Reuse `parseGermanAmount` or add a sibling                                                                                                            |
| Date format and year width                                       | Reuse `parseGermanDate` or add a sibling                                                                                                              |
| Sign convention (signed amount vs separate debit/credit columns) | Row mapping; money out must end up negative                                                                                                           |
| Where the **own** account's IBAN comes from                      | Sparkasse repeats it per row in `Auftragskonto`; ING states it once in the preamble; N26 never names it — see below, this one reshapes the descriptor |
| Booking status column, and its values                            | `statusByValue`, or `'booked'` for every row if the export has no pending concept                                                                     |
| File encoding as downloaded                                      | Fixture encoding, and whether `decode.ts` needs a third candidate                                                                                     |

## 2. Build the fixture

**Synthetic only.** Invented IBANs, invented names, invented amounts. Real bank data must
never reach the repo, and `scripts/check-staged-data.mjs` blocks it at commit time anyway.
When a bug needs a real statement to reproduce, hand-write a synthetic row that reproduces
it instead.

Fixtures are byte-exact artefacts: the line endings and the encoding the bank actually
ships. German retail exports are CRLF and Windows-1252; a fintech's may be LF and UTF-8.
Copy what the bank does rather than what Sparkasse does, and keep it uniform — a file
mixing CRLF and LF is nobody's export. `.gitattributes` (`fixtures/*.csv -text -diff`) and `.editorconfig`
(`[fixtures/**.csv] charset = unset`) already keep git and editors from normalising them —
verify a new file name matches those globs rather than assuming.

Use the bundled generator rather than hand-editing bytes; every variant must come from one
row set, or the variants drift and the "both shapes parse identically" test starts passing
for the wrong reason:

```bash
python3 .claude/skills/add-bank-format/scripts/make_fixture.py spec.json
python3 .claude/skills/add-bank-format/scripts/check_fixture_bytes.py fixtures/<bank>.csv --encoding cp1252
```

`scripts/fixture-spec.example.json` is a filled-in spec with comments in its `_notes` key.
Write the spec to the scratchpad, not the repo — the fixtures are the artefact, the
generator input is not.

The variant set that earned its place on the first two shapes:

- **primary** — the encoding the bank really ships (cp1252 for German retail banks). Only
  `apps/api` tests read this one.
- **utf-8 twin** — identical content. **Core's tests read this one**, because core reads
  fixtures through Vite's `?raw`, which decodes as UTF-8; cp1252 bytes read that way become
  mojibake and the umlaut assertions fail for the wrong reason.
- **utf-8 + BOM** — proves the BOM is stripped rather than glued to the first column name.
- **narrow shape** — if the bank ships more than one column count, one file per shape, same
  rows. The test that they produce identical transactions is what stops an index-based
  parser being written later.
- **bad rows** — exactly one defect per row, one row per failure mode
  (`AMOUNT_UNPARSEABLE`, `DATE_UNPARSEABLE`, `STATUS_UNKNOWN`, `REQUIRED_FIELD_MISSING`),
  the rest valid. A row reports its _first_ failure only.
- **next / overlapping export** — a later download of the same account: the pending row now
  booked with a shifted booking date, the same two identical rows, plus one genuinely new
  row. This is what proves dedup.
- **malformed** — an unterminated quote. Pure ASCII, so its encoding is moot.

Content the row set needs, because each one is a parser bug someone has shipped before:

umlauts in a name and in a purpose · a quoted field containing the delimiter · a quoted
field containing a newline · a doubled quote (`""Nord""`) · a truncated decimal (`832,9`
and `-190`, which a two-decimal assumption gets wrong by a factor of ten) · two date widths
in one row, if the bank mixes them · one pending row · two rows identical in date, amount
and counterparty · a blank line mid-file and a trailing blank line.

## 3. Write the dialect

The parser is one generic function over a descriptor; a new bank is data, not control flow.
If you find yourself writing `if (dialect === 'dkb')` inside `parse.ts`, the fact belongs in
the descriptor instead — that is the whole point of the seam.

Where things go:

- `packages/core/src/csv/dialects/<bank>.ts` — the descriptor: header markers, required
  columns, column bindings, status map, delimiter, value parsers.
- `packages/core/src/csv/dialects/index.ts` — register it. A dialect the registry does not
  list cannot be detected.
- `packages/core/src/csv/transaction.ts` — widen the `TransactionSource.dialect` union.
- `packages/core/src/csv/fields.ts` — only if the bank's number or date format genuinely
  differs. Reuse first: most German banks share `1.234,56` and `dd.mm.yyyy`.

**The own-account IBAN is the field most likely to break the descriptor's shape.**
`Transaction.accountIban` is required today because Sparkasse repeats it on every row. A
bank that states it once in a preamble needs the dialect to say where to read it from; a
bank that never names it needs the API to fall back to the IBAN of the account the user
already chose. Either way that value is provenance and a cross-check, never what decides
which account the rows land in — that is the user's choice before the upload, and inferring
it from a file is how rows end up in the wrong account.

Rules that are not style preferences — each is a defect class this repo already paid for:

- **Match columns by name, never by index.** Two shapes of the same export exist in the
  wild; an index-based parser passes one and corrupts the other.
- **Scan for the header, never skip a fixed count.** Preambles differ between generations
  of the same bank's export.
- **Amounts are integer cents.** `parseFloat(x) * 100` is itself the bug —
  `Math.round(1.005 * 100)` is 100.
- **Dates are `'YYYY-MM-DD'` strings.** No `Date` is constructed, even internally: UTC
  midnight shifts a day backwards west of Greenwich, which is how a transaction lands in the
  wrong month.
- **An unknown status value fails the row loudly.** Defaulting to `booked` turns a pending
  row into a permanent duplicate and a cancellation into money the user never spent.
- **`packages/core` imports no NestJS, React or Prisma** — including type-only. Enforced by
  `pnpm lint:deps`.
- **Anything reaching `csv-parse` stays behind the `@household-budget/core/csv` subpath.**
  Its Node build uses `Buffer`; exporting it from the root entry ships a broken `apps/web`
  bundle. Export the descriptor's _types_ from the root only if the UI needs them.
- **Do not add the dialect to `fingerprintInput`** without bumping its `'v1'` schema tag.
  The fingerprint is the dedup key; changing what goes into it re-keys every stored row.

## 4. Tests

Mirror `packages/core/src/csv/parse.test.ts` — it is the reference for what a dialect owes:

- all variants parse with zero row errors, and the expected transaction count
- the shapes produce identical transactions (compare with shape-specific fields omitted)
- umlauts intact; quoted delimiter, quoted newline and doubled quote read as one field
- truncated amounts land as the right integer cents
- status mapping, including that exactly the expected rows are pending
- reported line numbers, counting an embedded newline once — `csv-parse`'s own `info.lines`
  counts a CRLF inside a quoted field as two, so line numbers are computed by walking the
  source text; a new dialect inherits that and must assert it
- bad rows: the exact `RowError[]`, line numbers included, with the good rows still imported
- file-level failures throw: `HEADER_NOT_FOUND`, `REQUIRED_COLUMN_MISSING` naming the
  columns, and a malformed file surfacing `csv-parse`'s own code

Plus one registry test: the new fixture detects as the new dialect, and the Sparkasse
fixtures still detect as `sparkasse-camt`. Detection ambiguity is the failure mode a
registry introduces, so it gets a test the moment there are two entries.

The cp1252 assertion lives in `apps/api` (`decode.test.ts`), not core — core has no
`TextDecoder`.

## 5. Wire it through the stack

Full checklist in `references/wiring.md`. In short: `apps/api` picks the dialect (detected
from the header, not asked of the user), records it on the import batch, and maps file-level
failures to a 4xx; `apps/web` needs its German and English wording updated where it
currently names Sparkasse; a Playwright spec covers the new format end to end.

Typecheck is the guide here — `ImportErrorCode` and the dialect union are `Record` keys in
the web i18n tables, so a new member fails the build until it is worded in both languages.

## 6. Verify

```bash
pnpm check      # format, lint, deps, typecheck, unit tests
pnpm check:all  # the above plus Playwright — this touches HTTP and UI, so it is required
```

If the apps report "has no exported member" for something you just added to core, the
`dist/` is stale: `pnpm core:build` (or `pnpm dev`, which watches). The apps consume core's
built output, never its source.

Also confirm the fixture is committable and still byte-exact, because a helpful editor is
the usual culprit:

```bash
git check-ignore fixtures/<bank>.csv   # must exit 1 (not ignored)
python3 .claude/skills/add-bank-format/scripts/check_fixture_bytes.py fixtures/<bank>.csv --encoding cp1252 --twin fixtures/<bank>-utf8.csv
```

## 7. Record what was learned

Add the implementation notes to `docs/plans/NN-<bank>-csv.md` — specifically the things that
surprised you, since that is what the next bank's author reads. Update the status paragraph
in `CLAUDE.md` so it names the formats that actually import. Keep `CLAUDE.md` short: link to
the docs rather than inlining them.

## Reference files

- `references/registry-seam.md` — the one-time extraction from single-dialect to registry:
  target shape, extraction order, and what must stay unchanged.
- `references/german-banks.md` — per-bank format facts already researched: preambles,
  separators, status columns, encodings.
- `references/wiring.md` — the api / web / e2e checklist, with the files each step touches.
- `scripts/make_fixture.py` — generates every fixture variant from one row set.
- `scripts/check_fixture_bytes.py` — asserts CRLF, encoding and twin equality.
