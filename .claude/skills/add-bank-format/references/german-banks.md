# What is already known about German bank exports

Sourced from `docs/research/01-csv-import.md`, which was researched for the Sparkasse
import. Read this before searching the web — but treat everything marked **unverified** as a
lead, not a fact. The only thing that settles a column name is a real header, and the
research note for the new bank is where the confirmed version gets written down.

## Verified against a real export

Only **Sparkasse CSV-CAMT** has been verified in this repo.

- Header on line 1, no preamble. Delimiter `;`. `Auftragskonto` unquoted, the rest quoted.
- Two column counts in the wild: 17 (ending at `Info`) and 18 (ending at `Kategorie`).
- Encoding Windows-1252.
- Amounts: `1.234,56`, and **truncated trailing zeros** — `832,9` means €832.90, `-190`
  means −€190.00. A two-decimal assumption is wrong by a factor of ten here.
- Dates: `dd.mm.yy` and `dd.mm.yyyy` both occur, and mix within a single row.
- Status column `Info`, values `Umsatz gebucht` and `Umsatz vorgemerkt`. No third value has
  been attested; anything else fails the row on purpose.

## Encoding, across banks

German bank exports are Windows-1252, **except current DKB, which is UTF-8 with a BOM**.

No detection library is needed and none should be added. `apps/api/src/import/decode.ts`
tries UTF-8 with `fatal: true` and falls back to `windows-1252`, which is a proof rather
than a heuristic: `Müller` in cp1252 is `… FC 6C …`, and `0xFC` is not a legal UTF-8 lead
byte, so the UTF-8 interpretation dies immediately.

Two traps worth knowing when a new fixture looks wrong:

- **`windows-1252`, never `latin1`.** They agree on every umlaut but diverge at 0x80–0x9F,
  where cp1252 has `€`, curly quotes, en-dash and ellipsis — all of which appear in real
  purposes. Under `latin1` they become invisible C1 controls.
- **A UTF-8 BOM that is not stripped** glues `U+FEFF` to the first column name, every row
  then reads as missing its own account number, and the import reports zero transactions.
  This is a documented cause of "0 transactions imported" against DKB.

Mojibake cheat sheet — UTF-8 bytes wrongly read as cp1252: `ä`→`Ã¤`, `ö`→`Ã¶`, `ü`→`Ã¼`,
`ß`→`ÃŸ`, `€`→`â‚¬`. The reverse yields U+FFFD: `M�ller`. Seeing either in a test failure
means the fixture's encoding and the reader disagree, not that the parser is wrong.

## Preamble line counts (unverified, for the header scan)

Sparkasse 0 · DKB 4 (current) / ~6 (legacy, sources disagree) · comdirect 3 (inconsistent) ·
ING 12–13 · Postbank 7 · Deutsche Bank 5 · Volksbank 0–12 **plus 3 footer lines** ·
Commerzbank 0. Fintechs (N26, Revolut, Wise) export a clean single header.

The pattern: legacy retail banks ship preambles, Sparkasse is the exception. This is exactly
why the header is scanned for rather than skipped by count — and why the scan limit is 30
lines, comfortably past ING's 13.

Volksbank's three footer lines are the reason each data row's field count is validated
against the header: a footer then drops out naturally instead of parsing into garbage.

## Per-bank leads (unverified — confirm against a real header)

- **DKB**: UTF-8 with BOM; date columns named `Buchungsdatum` and `Wertstellung` rather than
  `Buchungstag`/`Valutadatum`; **the € symbol is embedded in the amount field** and must be
  stripped before parsing. Current and legacy export generations differ in preamble length.
- **Volksbank / GLS and other genossenschaftliche banks**: preamble and footer both present;
  some exports split debit and credit into two columns instead of one signed amount. If so,
  the row mapping must produce a negative amount for money out — that convention is load
  bearing for every budget number downstream.
- **N26 / Revolut / Wise**: English column names, `.`/`,` the other way round
  (`1,234.56`), ISO dates, and often a currency column plus an exchange-rate column. A
  multi-currency export raises a product question — this app stores one currency per
  transaction and does no conversion — so ask before parsing one.

## Dates, when the new bank offers a choice

`Buchungstag` (booking) is the primary grouping date; `Valutadatum` / `Wertstellung` (value)
is stored alongside but not grouped on. The reasoning is in research §6: users reconcile
against what the statement shows, and value date can land in a different month for card
payments and weekend transactions, silently shifting spend across a month boundary.

Whatever the new bank calls them, bind them to those two roles rather than adding a third
date field.
