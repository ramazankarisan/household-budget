import { describe, expect, it } from 'vitest';

import { assignOccurrences, dedupKeyInput, fingerprintInput } from './fingerprint.js';
import { toCents, type Transaction } from './transaction.js';

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    accountIban: 'DE89370400440532013000',
    bookingDate: '2025-09-22',
    valueDate: '2025-09-22',
    amount: toCents(-83290),
    currency: 'EUR',
    status: 'booked',
    counterpartyName: 'Müller GmbH',
    counterpartyIban: 'DE02120300000000202051',
    purpose: 'Rechnung 4711',
    bookingText: 'FOLGELASTSCHRIFT',
    source: {
      dialect: 'sparkasse-camt',
      fileName: 'Umsaetze_DE89.csv',
      lineNumber: 2,
      encoding: 'windows-1252',
      raw: {},
    },
    ...overrides,
  };
}

describe('fingerprintInput', () => {
  it('ignores provenance', () => {
    // The same transaction downloaded twice sits on different lines of different files.
    const first = transaction();
    const second = transaction({
      source: {
        dialect: 'sparkasse-camt',
        fileName: 'Umsaetze_DE89_spaeter.csv',
        lineNumber: 41,
        encoding: 'utf-8',
        raw: { Betrag: '-832,9' },
      },
    });

    expect(fingerprintInput(second)).toBe(fingerprintInput(first));
  });

  it('ignores case and whitespace drift in names', () => {
    expect(fingerprintInput(transaction({ counterpartyName: 'müller  gmbh' }))).toBe(
      fingerprintInput(transaction({ counterpartyName: 'Müller GmbH' })),
    );
  });

  it('ignores the spacing a bank prints inside an IBAN', () => {
    expect(fingerprintInput(transaction({ counterpartyIban: 'DE02 1203 0000 0000 2020 51' }))).toBe(
      fingerprintInput(transaction({ counterpartyIban: 'DE02120300000000202051' })),
    );
  });

  it('ignores bankCategory and status', () => {
    // The bank's own category is a hint, never a key, and a pending row is never
    // fingerprinted at all — but neither may change a booked row's key.
    expect(fingerprintInput(transaction({ bankCategory: 'Wohnen' }))).toBe(
      fingerprintInput(transaction()),
    );
  });

  it('separates transactions that differ in any keyed field', () => {
    const base = fingerprintInput(transaction());

    expect(fingerprintInput(transaction({ amount: toCents(-83291) }))).not.toBe(base);
    expect(fingerprintInput(transaction({ bookingDate: '2025-09-23' }))).not.toBe(base);
    expect(fingerprintInput(transaction({ valueDate: '2025-09-23' }))).not.toBe(base);
    expect(fingerprintInput(transaction({ purpose: 'Rechnung 4712' }))).not.toBe(base);
    expect(fingerprintInput(transaction({ counterpartyName: 'Meier GmbH' }))).not.toBe(base);
    expect(fingerprintInput(transaction({ accountIban: 'DE89370400440532013001' }))).not.toBe(base);
    expect(fingerprintInput(transaction({ currency: 'CHF' }))).not.toBe(base);
  });

  it('is stable across object key insertion order', () => {
    // A fixed-order array, not an object — this is what that buys.
    const inOneOrder: Transaction = {
      accountIban: 'DE89370400440532013000',
      bookingDate: '2025-09-22',
      amount: toCents(-4217),
      currency: 'EUR',
      status: 'booked',
      purpose: 'Einkauf',
      source: {
        dialect: 'sparkasse-camt',
        fileName: 'a.csv',
        lineNumber: 2,
        encoding: 'utf-8',
        raw: {},
      },
    };
    const inAnother: Transaction = {
      source: {
        dialect: 'sparkasse-camt',
        fileName: 'a.csv',
        lineNumber: 2,
        encoding: 'utf-8',
        raw: {},
      },
      purpose: 'Einkauf',
      status: 'booked',
      currency: 'EUR',
      amount: toCents(-4217),
      bookingDate: '2025-09-22',
      accountIban: 'DE89370400440532013000',
    };

    expect(fingerprintInput(inAnother)).toBe(fingerprintInput(inOneOrder));
  });

  it('treats an absent optional field the same as an empty one', () => {
    const { purpose: _purpose, ...withoutPurpose } = transaction();

    expect(fingerprintInput(transaction({ purpose: '' }))).toBe(fingerprintInput(withoutPurpose));
  });

  it('cannot be forged by a field containing the separator', () => {
    const forged = fingerprintInput(transaction({ purpose: 'a", "b' }));
    const honest = fingerprintInput(transaction({ purpose: 'a', bookingText: 'b' }));

    expect(forged).not.toBe(honest);
  });
});

describe('assignOccurrences', () => {
  it('numbers rows sharing a fingerprint in file order', () => {
    expect(assignOccurrences(['a', 'a'])).toEqual([0, 1]);
    expect(assignOccurrences(['a', 'b', 'a'])).toEqual([0, 0, 1]);
    expect(assignOccurrences(['a', 'a', 'a'])).toEqual([0, 1, 2]);
  });

  it('gives a single row index 0', () => {
    expect(assignOccurrences(['a'])).toEqual([0]);
    expect(assignOccurrences([])).toEqual([]);
  });

  it('is idempotent', () => {
    // Run twice on the same input, get the same keys — this is what makes a re-import
    // match instead of inserting everything again.
    const input = ['a', 'b', 'a', 'c', 'a', 'b'];

    expect(assignOccurrences(input)).toEqual(assignOccurrences(input));
  });

  it('adds exactly one new index when an overlapping export repeats a row once more', () => {
    const first = assignOccurrences(['a', 'a']);
    const second = assignOccurrences(['a', 'a', 'a']);

    expect(second.slice(0, first.length)).toEqual([...first]);
    expect(second.at(-1)).toBe(2);
  });
});

describe('dedupKeyInput', () => {
  it('joins the fingerprint to its occurrence index', () => {
    expect(dedupKeyInput('["v1","de89"]', 0)).toBe('["v1","de89"]|n:0');
    expect(dedupKeyInput('["v1","de89"]', 1)).not.toBe(dedupKeyInput('["v1","de89"]', 0));
  });
});
