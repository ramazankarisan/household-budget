import { type RulePayload, type TransactionPayload } from '@household-budget/core';
import { describe, expect, it } from 'vitest';

import { categoryHint, inboxRows, previewRule, proposeRule } from './inbox';

function transaction(overrides: Partial<TransactionPayload>): TransactionPayload {
  return {
    id: `t-${String(Math.random())}`,
    bookingDate: '2025-09-22',
    valueDate: null,
    amountCents: -1000,
    currency: 'EUR',
    status: 'booked',
    counterpartyName: 'Müller GmbH',
    counterpartyIban: null,
    purpose: null,
    bookingText: null,
    bankCategory: null,
    categoryId: null,
    categoryLockedAt: null,
    ...overrides,
  };
}

function rule(overrides: Partial<RulePayload>): RulePayload {
  return {
    id: `r-${String(Math.random())}`,
    field: 'counterpartyName',
    operator: 'contains',
    value: 'x',
    priority: 10,
    categoryId: 'cat-a',
    active: true,
    ...overrides,
  };
}

describe('inboxRows', () => {
  it('lists booked rows without a category, newest first, and leaves vorgemerkt out', () => {
    const rows = [
      transaction({ id: 'old', bookingDate: '2025-09-01' }),
      transaction({ id: 'new', bookingDate: '2025-09-20' }),
      transaction({ id: 'pending', status: 'pending' }),
      transaction({ id: 'done', categoryId: 'cat-a' }),
    ];

    expect(inboxRows(rows, 'all').map((row) => row.id)).toEqual(['new', 'old']);
  });

  it('narrows to a month', () => {
    const rows = [
      transaction({ id: 'sep', bookingDate: '2025-09-01' }),
      transaction({ id: 'aug', bookingDate: '2025-08-31' }),
    ];

    expect(inboxRows(rows, '2025-08').map((row) => row.id)).toEqual(['aug']);
  });
});

describe('categoryHint', () => {
  it('suggests what the same counterparty was given most often, whatever its case', () => {
    const row = transaction({ id: 'me', counterpartyName: 'MÜLLER GmbH' });
    const rows = [
      row,
      transaction({ categoryId: 'cat-wohnen' }),
      transaction({ categoryId: 'cat-wohnen' }),
      transaction({ categoryId: 'cat-essen' }),
    ];

    expect(categoryHint(row, rows)).toBe('cat-wohnen');
  });

  it('suggests nothing on a tie, or with nothing to go on', () => {
    const row = transaction({ id: 'me' });

    expect(
      categoryHint(row, [
        row,
        transaction({ categoryId: 'cat-wohnen' }),
        transaction({ categoryId: 'cat-essen' }),
      ]),
    ).toBeUndefined();
    expect(categoryHint(row, [row])).toBeUndefined();
    expect(categoryHint(transaction({ counterpartyName: null }), [])).toBeUndefined();
  });
});

describe('proposeRule', () => {
  it('matches the first real word of the counterparty, in the way the rules compare', () => {
    expect(proposeRule(transaction({ counterpartyName: 'MÜLLER GmbH' }), 'cat-a')).toEqual({
      field: 'counterpartyName',
      operator: 'contains',
      value: 'müller',
      categoryId: 'cat-a',
      active: true,
    });
  });

  it('skips what is not a word', () => {
    expect(
      proposeRule(transaction({ counterpartyName: 'PayPal Europe S.à r.l. et Cie' }), 'cat-a')
        .value,
    ).toBe('paypal');
    expect(proposeRule(transaction({ counterpartyName: '42 REWE' }), 'cat-a').value).toBe('rewe');
  });
});

describe('previewRule', () => {
  const condition = { field: 'counterpartyName', operator: 'contains', value: 'müller' } as const;

  it('counts what it reaches, what it would sort, and what it must leave alone', () => {
    const rows = [
      transaction({ id: 'a' }),
      transaction({ id: 'b', categoryId: 'cat-a' }),
      transaction({ id: 'c', categoryId: 'cat-a', categoryLockedAt: '2026-09-01T00:00:00Z' }),
      transaction({ id: 'd', counterpartyName: 'REWE' }),
    ];

    expect(previewRule(condition, rows, [])).toMatchObject({
      matches: 3,
      uncategorized: 1,
      locked: 1,
      claimedEarlier: 0,
    });
  });

  it('counts the rows an earlier rule already wins, and only active rules compete', () => {
    const rows = [transaction({ id: 'a' }), transaction({ id: 'b' })];

    expect(previewRule(condition, rows, [rule({ value: 'gmbh' })]).claimedEarlier).toBe(2);
    expect(
      previewRule(condition, rows, [rule({ value: 'gmbh', active: false })]).claimedEarlier,
    ).toBe(0);
  });

  it('reaches nothing with an empty keyword', () => {
    expect(previewRule({ ...condition, value: '  ' }, [transaction({})], []).matches).toBe(0);
  });
});
