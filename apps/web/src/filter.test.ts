import { type TransactionPayload } from '@household-budget/core';
import { describe, expect, it } from 'vitest';

import {
  filterTransactions,
  hasFilters,
  monthsOf,
  NO_FILTERS,
  searchableOf,
  type TransactionFilterState,
  UNCATEGORIZED,
  uncategorizedCount,
} from './filter';

function transaction(overrides: Partial<TransactionPayload> = {}): TransactionPayload {
  return {
    id: 'a',
    bookingDate: '2025-09-22',
    valueDate: '2025-09-22',
    amountCents: -83290,
    currency: 'EUR',
    status: 'booked',
    counterpartyName: 'Müller GmbH',
    counterpartyIban: 'DE02120300000000202051',
    purpose: 'Rechnung 4711',
    bookingText: 'FOLGELASTSCHRIFT',
    bankCategory: 'Wohnen',
    categoryId: null,
    categoryLockedAt: null,
    ...overrides,
  };
}

/** The filter's whole input is the pairs, so every case goes through `searchableOf`. */
function visible(
  transactions: readonly TransactionPayload[],
  filters: Partial<TransactionFilterState> = {},
): readonly string[] {
  return filterTransactions(searchableOf(transactions), { ...NO_FILTERS, ...filters }).map(
    (row) => row.id,
  );
}

const SEPTEMBER = transaction({ id: 'sep', bookingDate: '2025-09-22' });
const OCTOBER = transaction({ id: 'oct', bookingDate: '2025-10-01' });
const OLD = transaction({ id: 'old', bookingDate: '2014-03-24' });

describe('monthsOf', () => {
  it('lists only the months the rows actually cover, newest first', () => {
    // Not a continuous range: a bank history has holes, and eleven empty months between
    // two entries are eleven options that can only ever show an empty table.
    expect(monthsOf([SEPTEMBER, OLD, OCTOBER])).toEqual(['2025-10', '2025-09', '2014-03']);
  });

  it('collapses two rows in the same month to one option', () => {
    expect(monthsOf([SEPTEMBER, transaction({ id: 'b', bookingDate: '2025-09-01' })])).toEqual([
      '2025-09',
    ]);
  });

  it('has nothing to offer for no rows', () => {
    expect(monthsOf([])).toEqual([]);
  });
});

describe('filterTransactions, by month', () => {
  it('keeps the chosen month and drops every other', () => {
    expect(visible([SEPTEMBER, OCTOBER, OLD], { month: '2025-09' })).toEqual(['sep']);
  });

  it('keeps every row when no month is chosen', () => {
    expect(visible([SEPTEMBER, OCTOBER, OLD])).toEqual(['sep', 'oct', 'old']);
  });

  it('reads the month off the string, not off a Date', () => {
    // `new Date('2025-09-01')` is UTC midnight, which is August anywhere west of
    // Greenwich — the first of the month would vanish from its own month.
    expect(
      visible([transaction({ id: 'first', bookingDate: '2025-09-01' })], { month: '2025-09' }),
    ).toEqual(['first']);
  });
});

describe('filterTransactions, by category', () => {
  const wohnen = transaction({ id: 'wohnen', categoryId: 'cat-wohnen' });
  const other = transaction({ id: 'other', categoryId: 'cat-essen' });
  const none = transaction({ id: 'none', categoryId: null });
  const pendingNone = transaction({ id: 'pending', status: 'pending', categoryId: null });

  it('keeps only the rows holding the chosen category', () => {
    expect(visible([wohnen, other, none], { categoryId: 'cat-wohnen' })).toEqual(['wohnen']);
  });

  it('shows pending rows under Ohne Kategorie, because they are on screen either way', () => {
    expect(visible([wohnen, none, pendingNone], { categoryId: UNCATEGORIZED })).toEqual([
      'none',
      'pending',
    ]);
  });

  it('never mistakes the uncategorized marker for a category id', () => {
    // Every id here is a 25-character cuid, so the marker cannot collide — asserted
    // rather than assumed, because a collision would silently show an empty table.
    expect(
      visible([transaction({ id: 'x', categoryId: UNCATEGORIZED })], { categoryId: 'cat-a' }),
    ).toEqual([]);
  });
});

describe('filterTransactions, combined', () => {
  it('is month AND category', () => {
    const rows = [
      transaction({ id: 'hit', bookingDate: '2025-09-02', categoryId: 'cat-wohnen' }),
      transaction({ id: 'wrong-month', bookingDate: '2025-08-02', categoryId: 'cat-wohnen' }),
      transaction({ id: 'wrong-category', bookingDate: '2025-09-03', categoryId: null }),
    ];

    expect(visible(rows, { month: '2025-09', categoryId: 'cat-wohnen' })).toEqual(['hit']);
  });

  it('says nothing matched rather than falling back to everything', () => {
    expect(visible([SEPTEMBER], { month: '2020-01' })).toEqual([]);
  });
});

describe('uncategorizedCount', () => {
  it('counts every live row with no category, pending included', () => {
    expect(
      uncategorizedCount([
        transaction({ id: 'a', categoryId: null }),
        transaction({ id: 'b', status: 'pending', categoryId: null }),
        transaction({ id: 'c', categoryId: 'cat-wohnen' }),
      ]),
    ).toBe(2);
  });

  it('is zero once everything is categorized', () => {
    expect(uncategorizedCount([transaction({ categoryId: 'cat-wohnen' })])).toBe(0);
    expect(uncategorizedCount([])).toBe(0);
  });
});

describe('searchableOf', () => {
  it('never puts the word null into the haystack', () => {
    // A template literal over two nullable fields would, and then a search for `null`
    // would find every blank row.
    const [only] = searchableOf([transaction({ counterpartyName: null, purpose: null })]);

    expect(only?.text).not.toContain('null');
    expect(only?.text).toBe('');
  });

  it('normalizes payee and purpose together, and the IBAN without its groups', () => {
    const [only] = searchableOf([
      transaction({ counterpartyName: 'MÜLLER GmbH', purpose: 'Miete Oktober' }),
    ]);

    expect(only?.text).toBe('müller gmbh miete oktober');
    expect(only?.iban).toBe('de02120300000000202051');
  });
});

describe('hasFilters', () => {
  it('is false only when nothing is narrowing the list', () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, month: '2025-09' })).toBe(true);
    expect(hasFilters({ ...NO_FILTERS, categoryId: UNCATEGORIZED })).toBe(true);
    expect(hasFilters({ ...NO_FILTERS, search: 'rewe' })).toBe(true);
  });
});

describe('filterTransactions, by text', () => {
  /** The fixture's own strings: this is the search's whole job. */
  const mueller = transaction({
    id: 'mueller',
    counterpartyName: 'MÜLLER GmbH',
    purpose: 'Rechnung 4711',
  });
  const rewe = transaction({
    id: 'rewe',
    counterpartyName: 'REWE SAGT DANKE; FILIALE 42',
    purpose: 'Einkauf',
  });
  const miete = transaction({
    id: 'miete',
    counterpartyName: 'Hausverwaltung',
    // The CRLF the bank writes into a Verwendungszweck, stored as it arrived.
    purpose: 'Miete Oktober\r\nHauptstraße 12',
  });
  const blank = transaction({ id: 'blank', counterpartyName: null, purpose: null });

  const ROWS = [mueller, rewe, miete, blank];

  it('finds MÜLLER GmbH by müller, in any case and either spelling', () => {
    // The case SQLite cannot do: its lower() folds ASCII only, so `LIKE '%müller%'` misses
    // this row on both engines this repo runs. That is why the search is here at all.
    expect(visible(ROWS, { search: 'müller' })).toEqual(['mueller']);
    expect(visible(ROWS, { search: 'MÜLLER' })).toEqual(['mueller']);
    // NFD: `u` + U+0308, which is a different byte sequence and the same name.
    expect(visible(ROWS, { search: 'müller' })).toEqual(['mueller']);
  });

  it('searches the purpose across the CRLF the bank put in it', () => {
    expect(visible(ROWS, { search: 'miete oktober hauptstraße' })).toEqual(['miete']);
  });

  it('matches part of a payee', () => {
    expect(visible(ROWS, { search: 'rewe' })).toEqual(['rewe']);
    expect(visible(ROWS, { search: 'filiale 42' })).toEqual(['rewe']);
  });

  it('finds an IBAN however the user grouped it', () => {
    const rows = [transaction({ id: 'iban', counterpartyIban: 'DE89370400440532013000' }), rewe];

    expect(visible(rows, { search: 'DE89 3704 0044 0532 0130 00' })).toEqual(['iban']);
    expect(visible(rows, { search: 'de89370400440532013000' })).toEqual(['iban']);
  });

  it('does not let a short needle match every IBAN in the account', () => {
    // `de` is the start of every German IBAN and `44` is somewhere in most of them, and
    // the table renders no IBAN column — so a row matched this way appears with nothing
    // on it the user can see matching.
    const rows = [transaction({ id: 'iban', counterpartyIban: 'DE89370400440532013000' })];

    expect(visible(rows, { search: 'de' })).toEqual([]);
    expect(visible(rows, { search: '44' })).toEqual([]);
    // Two letters and a digit is where an IBAN stops being ambiguous.
    expect(visible(rows, { search: 'de89' })).toEqual(['iban']);
  });

  it('keeps matching a purpose that contains a space, alongside the IBAN needle', () => {
    // The proof the two needles coexist: the IBAN needle strips spaces, and using it for
    // the text half would break this.
    expect(visible(ROWS, { search: 'rechnung 4711' })).toEqual(['mueller']);
  });

  it('does not find a blank row by the word null', () => {
    expect(visible(ROWS, { search: 'null' })).toEqual([]);
  });

  it('matches everything on an empty needle, and nothing on a miss', () => {
    expect(visible(ROWS, { search: '' })).toEqual(['mueller', 'rewe', 'miete', 'blank']);
    expect(visible(ROWS, { search: '   ' })).toEqual(['mueller', 'rewe', 'miete', 'blank']);
    expect(visible(ROWS, { search: 'sparkasse' })).toEqual([]);
  });

  it('is combined with the month and the category, not instead of them', () => {
    const rows = [
      transaction({ id: 'sep', counterpartyName: 'REWE', bookingDate: '2025-09-02' }),
      transaction({ id: 'aug', counterpartyName: 'REWE', bookingDate: '2025-08-02' }),
    ];

    expect(visible(rows, { search: 'rewe', month: '2025-09' })).toEqual(['sep']);
    expect(visible(rows, { search: 'rewe', month: '2025-10' })).toEqual([]);
  });
});
