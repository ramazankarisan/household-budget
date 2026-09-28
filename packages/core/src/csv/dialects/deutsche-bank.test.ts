import { describe, expect, it } from 'vitest';

// Read through Vite's `?raw`, which decodes as UTF-8 — which is what Deutsche Bank ships.
import badRowsCsv from '../../../../../fixtures/deutsche-bank-bad-rows.csv?raw';
import malformedCsv from '../../../../../fixtures/deutsche-bank-malformed.csv?raw';
import noBomCsv from '../../../../../fixtures/deutsche-bank-no-bom.csv?raw';
import noIbanCsv from '../../../../../fixtures/deutsche-bank-no-iban.csv?raw';
import primaryCsv from '../../../../../fixtures/deutsche-bank.csv?raw';

import { CsvFileError } from '../errors.js';
import { parseBankCsv, type ParseBankCsvContext } from '../parse.js';
import { deutscheBank } from './deutsche-bank.js';

const context: ParseBankCsvContext = {
  fileName: 'Kontoumsaetze_100_1234567_00.csv',
  encoding: 'utf-8',
  referenceYear: 2026,
};

const parse = (text: string) => parseBankCsv(text, deutscheBank, context);

describe('Deutsche Bank', () => {
  const { transactions, errors } = parse(primaryCsv);

  it('parses every data row, and neither the preamble nor the footer', () => {
    expect(errors).toEqual([]);
    expect(transactions).toHaveLength(8);
  });

  it('parses identically with and without the BOM', () => {
    expect(parse(noBomCsv)).toEqual({ transactions, errors });
  });

  it('takes the own IBAN from the preamble, for every row', () => {
    expect(new Set(transactions.map((t) => t.accountIban))).toEqual(
      new Set(['DE91100000000123456789']),
    );
  });

  it('keeps umlauts intact, in values and in the column names they are read by', () => {
    expect(transactions[0]?.counterpartyName).toBe('Müller GmbH');
    expect(transactions[0]?.purpose).toBe('Rechnung 4711 Möbel für die Küche');
    expect(transactions[0]?.creditorId).toBe('DE98ZZZ09999999999');
    expect(transactions[3]?.bookingText).toBe('SEPA Überweisung (Dauerauftrag)');
    expect(transactions[6]?.purpose).toBe('Zuzahlung Praxisbesuch 10 €');
  });

  it('reads a bare quote character as data, since the bank never quotes', () => {
    expect(transactions[4]?.counterpartyName).toBe('Hotel "Nord" GmbH');
  });

  it('reads the signed Betrag, truncated decimals included, as integer cents', () => {
    expect(transactions.map((t) => t.amount)).toEqual([
      -83290, -4217, -4217, -115000, -12850, 245000, -1900, -19000,
    ]);
    expect(transactions.every((t) => t.currency === 'EUR')).toBe(true);
  });

  it('parses dates without leading zeros, binding Wert as the value date', () => {
    expect(transactions[6]?.bookingDate).toBe('2026-09-01');
    expect(transactions[6]?.valueDate).toBe('2026-08-31');
    expect(transactions[1]?.bookingDate).toBe('2026-09-28');
    expect(transactions[1]?.valueDate).toBe('2026-09-26');
  });

  it('books every row, because pending rows are never exported', () => {
    expect(transactions.every((t) => t.status === 'booked')).toBe(true);
  });

  it('maps the SEPA columns and leaves empty ones absent', () => {
    expect(transactions[0]).toMatchObject({
      counterpartyIban: 'DE02120300000000202051',
      counterpartyBic: 'BYLADEM1001',
      endToEndRef: 'E2E-4711',
      mandateRef: 'M-0815',
    });
    expect(transactions[7]?.counterpartyName).toBeUndefined();
    expect(transactions[7]?.counterpartyIban).toBeUndefined();
    expect(transactions[7]?.bankCategory).toBeUndefined();
  });

  it('keeps the two identical card payments as two transactions', () => {
    expect(transactions[1]).toEqual({
      ...transactions[2],
      source: { ...transactions[2]?.source, lineNumber: 10 },
    });
  });

  it('reports the true source line, counting the preamble', () => {
    expect(transactions.map((t) => t.source.lineNumber)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it('records the dialect and the raw row, Soll and Haben included', () => {
    expect(transactions[0]?.source.dialect).toBe('deutsche-bank');
    expect(transactions[0]?.source.raw['Soll']).toBe('-832,9');
    expect(transactions[5]?.source.raw['Haben']).toBe('2.450,00');
  });
});

describe('Deutsche Bank, bad rows', () => {
  it('imports the good rows and reports the bad ones with line numbers', () => {
    const { transactions, errors } = parse(badRowsCsv);

    expect(errors).toEqual([
      { code: 'AMOUNT_UNPARSEABLE', line: 10, field: 'Betrag', value: '12,3,4' },
      { code: 'DATE_UNPARSEABLE', line: 11, field: 'Buchungstag', value: '31.9.2026' },
      { code: 'REQUIRED_FIELD_MISSING', line: 13, field: 'Währung' },
    ]);
    expect(transactions.map((t) => t.source.lineNumber)).toEqual([9, 12]);
  });
});

describe('Deutsche Bank, file-level failures', () => {
  it('throws on an unterminated quote instead of swallowing the rest of the file', () => {
    expect(() => parse(malformedCsv)).toThrowError(
      expect.objectContaining({ code: 'CSV_QUOTE_NOT_CLOSED' }),
    );
  });

  it('refuses a preamble that does not name the own IBAN', () => {
    expect(() => parse(noIbanCsv)).toThrowError(
      new CsvFileError('REQUIRED_COLUMN_MISSING', ['IBAN']),
    );
  });

  it('drops only a footer that closes the file, not a row that happens to match', () => {
    // A ragged line anywhere but the end is a broken file, and must still fail loudly.
    const midFile = primaryCsv.replace(
      '1.9.2026;1.9.2026;Entgelt',
      'Kontostand;30.9.2026;;;2.545,26;EUR\n1.9.2026;1.9.2026;Entgelt',
    );
    expect(() => parse(midFile)).toThrowError(
      expect.objectContaining({ code: 'CSV_RECORD_INCONSISTENT_FIELDS_LENGTH' }),
    );
  });

  it('does not recognise the older export, which names the IBAN column differently', () => {
    const older = primaryCsv.replace(';IBAN / Kontonummer;', ';IBAN;');
    expect(() => parse(older)).toThrowError(new CsvFileError('HEADER_NOT_FOUND'));
  });
});
