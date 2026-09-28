---
date: 2026-09-28T19:50:50Z
git_commit: 8ea89bc157d0accb036d8d50dd9ef02b4b4df4d8
branch: feat/deutsche-bank-csv
topic: 'Deutsche Bank Girokonto CSV export (Umsatzanzeige)'
tags: [research, csv-import, deutsche-bank, postbank, encoding]
status: complete
---

# Research: Deutsche Bank CSV export

## Research question

What exactly does a Deutsche Bank Girokonto CSV export look like — preamble, header tokens,
delimiter and quoting, encoding, amount and date formats, booking status, footer — so a second
dialect can be written against facts rather than guesses?

## Summary

There are **two generations**. The current one (2024 onwards, on the platform Deutsche Bank
shares with Postbank) is the one a user downloads today, and the only one implemented. The
older one (Deutsche Bank's own platform, until about early 2024) differs in every way that
matters to a parser and is deliberately rejected with `HEADER_NOT_FOUND`.

No real export was available from the user; everything here comes from cited public sources.
Confidence is high for the current generation (two independent files inspected at byte level)
and medium-high for the older one.

## Findings — current export

Sources: a real, hand-anonymized Deutsche Bank export from 06/2026 attached to
[RechnungsFee#247](https://github.com/nicolettas-muggelbude/RechnungsFee/issues/247); a genuine
Postbank export from 12/2023 in
[cash-cockpit](https://github.com/RtCryo/cash-cockpit/blob/master/handler/src/test/resources/Kontoumsaetze_367_6139117_00_20231218_105036.csv);
the Firefly III [import configuration](https://github.com/firefly-iii/import-configurations/tree/main/de/deutschebank)
(updated for this format 2025-11-15).

```
Umsätze
Konto;Filial-/Kontonummer;IBAN;Währung
AktivKonto;123 1234567 00;DE89370400440532013000;EUR

1.6.2026 - 30.6.2026
Letzter Kontostand;;;;2.500,00;EUR
Vorgemerkte und noch nicht gebuchte Umsätze sind nicht Bestandteil dieser Übersicht.
Buchungstag;Wert;Umsatzart;Begünstigter / Auftraggeber;Verwendungszweck;IBAN / Kontonummer;BIC;Kundenreferenz;Mandatsreferenz;Gläubiger ID;Fremde Gebühren;Betrag;Abweichender Empfänger;Anzahl der Aufträge;Anzahl der Schecks;Soll;Haben;Währung
30.6.2026;30.6.2026;SEPA Lastschrift;Bank AG;…;DE89…;;12345678901234;CMLP12345678901;DE12CML12345678901;;-1.000,00;;;;-1.000,00;;EUR
29.6.2026;29.6.2026;SEPA Überweisung (Dauerauftrag);Max Mustermann;Miete;DE89…;;NOTPROVIDED;;;;750;;;;;750;EUR
Kontostand;30.6.2026;;;1.200,00;EUR
```

| Question           | Answer                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| Encoding           | UTF-8 **with BOM**, LF line endings, final newline                                                        |
| Delimiter, quoting | `;`, **never quoted** — not even around `/` or `,`                                                        |
| Preamble           | 7 lines (line 4 empty); header on line 8                                                                  |
| Own IBAN           | Stated once, in the preamble: a `Konto;Filial-/Kontonummer;IBAN;Währung` line, the values on the next one |
| Header             | 18 columns, umlauts spelled out (`Begünstigter`, `Gläubiger`, `Währung`)                                  |
| Amount             | `Betrag`, always filled and signed. `Soll`/`Haben` repeat it; the other of the two is empty               |
| Decimal format     | `-1.000,00`, **with trailing-zero truncation** (`750`, `-100,8`) — seen in both files                     |
| Dates              | `D.M.YYYY` without leading zeros (`1.6.2026`)                                                             |
| Booking status     | None. Pending rows are never exported; the preamble says so                                               |
| Footer             | One line, `Kontostand;<date>;;;<balance>;EUR` — 6 fields against the header's 18                          |

## Findings — older export (not implemented)

Sources: [BananaAccounting test cases](https://github.com/BananaAccounting/Germany/tree/master/importApps/deutschebank_import_bank_statement_csv/test/testcases),
the Firefly README before commit 3e04d63ad7,
[erwinfrohsinn/bank-account-processing](https://github.com/erwinfrohsinn/bank-account-processing/blob/master/kontoauszug.py),
[Bone008/finance-tracker](https://github.com/Bone008/finance-tracker/blob/master/src/app/money/import/mappings.ts).

- ISO-8859-1/cp1252, 4 preamble lines, `DD.MM.YYYY`, always two decimals.
- 19 columns: `IBAN` rather than `IBAN / Kontonummer`, plus `Abweichender Auftraggeber`, and
  `Mandatsreferenz ` with a trailing space.
- `Betrag` is **empty**; the amount is only in `Soll` (already negative) or `Haben`.
- The preamble names a Kundennummer, **never the IBAN**.
- Earlier still: a 16-column 2014 shape, and a 6-column 2009/2010 one.

## Decisions

1. **Current generation only.** The older one needs an amount spread over two columns and an
   own IBAN taken from the chosen account — two new descriptor concepts for files nobody
   downloads any more. Revisit if a user has an archive of them.
2. **`IBAN / Kontonummer` is a header marker**, so an older file fails as `HEADER_NOT_FOUND`
   rather than importing as one `REQUIRED_FIELD_MISSING: Betrag` per row.
3. **Own IBAN from the preamble, by name.** The mini-table is read like any header: find the
   line carrying `IBAN`, take the same position on the next line. A preamble without one is
   `REQUIRED_COLUMN_MISSING: IBAN` — a file-level 4xx, not a per-row error.
4. **Every row is booked.** The bank says pending rows are not in the file; a status map that
   defaults to booked is not needed because there is nothing to map.
5. **`Betrag` is the amount; `Soll`/`Haben` stay in `raw` only.** Negating `Soll` again would
   turn spending into income.
6. **Footer dropped as the last non-blank line only**, and blanked rather than removed, so
   line numbers still match the file. A ragged line anywhere else still fails the file.
7. **Quoting off** (`quote: false`), because the bank never quotes: every `"` is data.
   `relax_quotes` was the first choice and was wrong — it still reads a field that _opens_
   with `"` as quoted, so a purpose like `"Rechnung` failed the whole file as an unclosed
   quote. A stray delimiter is still caught, as a wrong field count.
8. **Postbank** shares the header byte for byte and would be detected as `deutsche-bank`.
   Not claimed as supported until a Postbank file is checked against the fixture.
