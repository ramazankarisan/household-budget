import { describe, expect, it } from 'vitest';

// Read through Vite's `?raw`, which decodes as UTF-8. The Windows-1252 fixture is
// asserted in apps/api, which has `types: ["node"]` and a TextDecoder; core does not.
import badRowsCsv from '../../../../fixtures/sparkasse-camt-18-bad-rows.csv?raw';
import malformedCsv from '../../../../fixtures/sparkasse-camt-malformed.csv?raw';
import camt17Csv from '../../../../fixtures/sparkasse-camt-17.csv?raw';
import camt18BomCsv from '../../../../fixtures/sparkasse-camt-18-utf8-bom.csv?raw';
import camt18Csv from '../../../../fixtures/sparkasse-camt-18-utf8.csv?raw';

import { CsvFileError, truncateErrorValue } from './errors.js';
import { parseSparkasseCsv, type ParseSparkasseCsvContext } from './parse.js';
import type { Transaction } from './transaction.js';

const context: ParseSparkasseCsvContext = {
  fileName: 'Umsaetze_DE89.csv',
  encoding: 'utf-8',
  referenceYear: 2026,
};

/** Everything a 17- and an 18-column export must agree on, byte for byte. */
function withoutShapeSpecifics(
  transaction: Transaction,
): Omit<Transaction, 'bankCategory' | 'source'> {
  const { bankCategory: _bankCategory, source: _source, ...shared } = transaction;
  return shared;
}

describe('parseSparkasseCsv', () => {
  const { transactions, errors } = parseSparkasseCsv(camt18Csv, context);

  it('parses the 18-column fixture without row errors', () => {
    expect(errors).toEqual([]);
    expect(transactions).toHaveLength(9);
  });

  it('produces identical transactions from the 17- and 18-column shapes', () => {
    // The central test of the phase: one parser, two real CSV-CAMT shapes, columns
    // matched by name. An index-based parser passes one of these and fails the other.
    const camt17 = parseSparkasseCsv(camt17Csv, context);

    expect(camt17.errors).toEqual([]);
    expect(camt17.transactions.map(withoutShapeSpecifics)).toEqual(
      transactions.map(withoutShapeSpecifics),
    );
  });

  it('carries Kategorie only where the export has one', () => {
    const camt17 = parseSparkasseCsv(camt17Csv, context);

    expect(transactions[0]?.bankCategory).toBe('Wohnen');
    expect(camt17.transactions[0]?.bankCategory).toBeUndefined();
  });

  it('keeps umlauts intact', () => {
    expect(transactions[0]?.counterpartyName).toBe('Müller GmbH');
    expect(transactions[0]?.purpose).toBe('Rechnung 4711 Möbel für die Küche');
    expect(transactions[8]?.counterpartyName).toBe('Beispiel AG');
  });

  it('parses the truncated amounts as integer cents', () => {
    expect(transactions[0]?.amount).toBe(-83290);
    expect(transactions[6]?.amount).toBe(-19000);
    expect(transactions[8]?.amount).toBe(245000);
  });

  it('reads a quoted delimiter as one field', () => {
    expect(transactions[1]?.counterpartyName).toBe('REWE SAGT DANKE; FILIALE 42');
  });

  it('reads a quoted newline as one field', () => {
    expect(transactions[3]?.purpose).toBe('Miete Oktober\r\nHauptstraße 12');
  });

  it('unescapes doubled quotes', () => {
    expect(transactions[4]?.counterpartyName).toBe('Hotel "Nord" GmbH');
  });

  it('parses both date widths within one row', () => {
    expect(transactions[5]?.bookingDate).toBe('2014-03-24');
    expect(transactions[5]?.valueDate).toBe('2014-04-01');
  });

  it('maps Info to a booking status', () => {
    expect(transactions[7]?.status).toBe('pending');
    expect(transactions.filter((t) => t.status === 'pending')).toHaveLength(1);
    expect(transactions.filter((t) => t.status === 'booked')).toHaveLength(8);
  });

  it('skips blank lines without producing transactions or errors', () => {
    // The fixture has one blank line mid-file and one at EOF. Nine data rows in,
    // nine transactions out, nothing reported.
    expect(transactions).toHaveLength(9);
    expect(errors).toEqual([]);
  });

  it('reports the true source line, counting a quoted newline once', () => {
    // csv-parse's own line counter treats an embedded CRLF as two lines, which would
    // push every row after the multi-line one a line too far.
    expect(transactions.map((t) => t.source.lineNumber)).toEqual([2, 3, 4, 6, 8, 9, 10, 11, 12]);
  });

  it('records provenance from the injected context', () => {
    expect(transactions[0]?.source.fileName).toBe('Umsaetze_DE89.csv');
    expect(transactions[0]?.source.encoding).toBe('utf-8');
    expect(transactions[0]?.source.dialect).toBe('sparkasse-camt');
    expect(transactions[0]?.source.raw['Betrag']).toBe('-832,9');
  });

  it('strips a UTF-8 BOM rather than gluing it to the first column name', () => {
    const withBom = parseSparkasseCsv(camt18BomCsv, context);

    expect(withBom.errors).toEqual([]);
    expect(Object.keys(withBom.transactions[0]?.source.raw ?? {})[0]).toBe('Auftragskonto');
    expect(withBom.transactions.map(withoutShapeSpecifics)).toEqual(
      transactions.map(withoutShapeSpecifics),
    );
  });
});

describe('parseSparkasseCsv, bad rows', () => {
  it('imports the good rows and reports the bad ones with line numbers', () => {
    const { transactions, errors } = parseSparkasseCsv(badRowsCsv, context);

    expect(errors).toEqual([
      { code: 'AMOUNT_UNPARSEABLE', line: 3, field: 'Betrag', value: '12,3,4' },
      { code: 'DATE_UNPARSEABLE', line: 5, field: 'Buchungstag', value: '32.13.25' },
      { code: 'STATUS_UNKNOWN', line: 6, field: 'Info', value: 'Umsatz storniert' },
    ]);
    expect(transactions).toHaveLength(3);
    expect(transactions.map((t) => t.source.lineNumber)).toEqual([2, 4, 7]);
  });

  it('cuts a long offending value to 100 characters plus an ellipsis', () => {
    // One bad cell must not cost a 5 KB string in the log, the response and the DOM.
    const long = `12,3,4${'x'.repeat(4_994)}`;
    const { errors } = parseSparkasseCsv(badRowsCsv.replace('12,3,4', long), context);

    const amount = errors.find((error) => error.code === 'AMOUNT_UNPARSEABLE');
    expect(amount?.value).toHaveLength(101);
    expect(amount?.value).toBe(`${long.slice(0, 100)}…`);
  });

  it('never splits a surrogate pair when it cuts a value', () => {
    const value = `${'a'.repeat(99)}😀tail`;

    expect(truncateErrorValue(value)).toBe(`${'a'.repeat(99)}…`);
    expect(truncateErrorValue('short')).toBe('short');
  });

  it('never silently treats an unknown Info value as booked', () => {
    const { transactions } = parseSparkasseCsv(badRowsCsv, context);

    expect(transactions.some((t) => t.counterpartyName === 'Bäckerei Schmidt')).toBe(false);
  });
});

describe('parseSparkasseCsv, file-level failures', () => {
  it('throws on an unterminated quote instead of swallowing the rest of the file', () => {
    // The whole reason for not hand-rolling the parser: a hand-rolled state machine
    // returns ["a","b;c"] here and corrupts money silently.
    expect(() => parseSparkasseCsv(malformedCsv, context)).toThrowError(
      expect.objectContaining({ code: 'CSV_QUOTE_NOT_CLOSED' }),
    );
  });

  it('throws HEADER_NOT_FOUND when no line looks like a header', () => {
    expect(() => parseSparkasseCsv('eins;zwei\r\ndrei;vier\r\n', context)).toThrowError(
      new CsvFileError('HEADER_NOT_FOUND'),
    );
  });

  it('throws REQUIRED_COLUMN_MISSING and names the columns', () => {
    const header = 'Auftragskonto;"Buchungstag";"Betrag"\r\n';

    try {
      parseSparkasseCsv(header, context);
      expect.unreachable('expected a CsvFileError');
    } catch (error) {
      expect(error).toBeInstanceOf(CsvFileError);
      expect((error as CsvFileError).code).toBe('REQUIRED_COLUMN_MISSING');
      expect((error as CsvFileError).columns).toEqual(['Waehrung', 'Info']);
    }
  });
});
