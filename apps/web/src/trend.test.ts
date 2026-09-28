import { type CategoryReport, type TransactionPayload } from '@household-budget/core';
import { describe, expect, it } from 'vitest';

import { budgetTone, monthTotals, paceOf, trailingMonths } from './trend';

function transaction(overrides: Partial<TransactionPayload>): TransactionPayload {
  return {
    id: `t-${String(Math.random())}`,
    bookingDate: '2025-09-22',
    valueDate: null,
    amountCents: -1000,
    currency: 'EUR',
    status: 'booked',
    counterpartyName: null,
    counterpartyIban: null,
    purpose: null,
    bookingText: null,
    bankCategory: null,
    categoryId: null,
    categoryLockedAt: null,
    ...overrides,
  };
}

function entry(overrides: Partial<CategoryReport>): CategoryReport {
  const bookedCents = overrides.bookedCents ?? 0;
  const pendingCents = overrides.pendingCents ?? 0;
  const budgetCents = overrides.budgetCents ?? null;
  const spent = bookedCents + pendingCents;
  return {
    categoryId: 'cat',
    bookedCents,
    pendingCents,
    budgetCents,
    remainingCents: budgetCents === null ? null : budgetCents - spent,
    isOver: budgetCents !== null && spent > budgetCents,
    transactionCount: 1,
    ...overrides,
  };
}

describe('trailingMonths', () => {
  it('counts back calendar months, across a year boundary', () => {
    expect(trailingMonths('2025-02', 4)).toEqual(['2024-11', '2024-12', '2025-01', '2025-02']);
  });

  it('keeps months that have no data: a gap is what a trend should show', () => {
    expect(trailingMonths('2025-09', 6)).toHaveLength(6);
  });

  it('gives nothing for a month it cannot read', () => {
    expect(trailingMonths('', 6)).toEqual([]);
  });
});

describe('monthTotals', () => {
  it('reads each month the way the month itself is read: money out, booked', () => {
    const rows = [
      transaction({ bookingDate: '2025-08-10', amountCents: -5000 }),
      transaction({ bookingDate: '2025-09-10', amountCents: -2000 }),
      transaction({ bookingDate: '2025-09-11', amountCents: -700, status: 'pending' }),
      transaction({ bookingDate: '2025-09-12', amountCents: 250000 }),
    ];
    const budgets = new Map([
      ['2025-09', [{ categoryId: 'cat', month: '2025-09', amountCents: 10000 }]],
    ]);

    expect(
      monthTotals(
        rows,
        budgets,
        [{ id: 'cat', name: 'Wohnen', colorIndex: 0 }],
        ['2025-08', '2025-09'],
      ),
    ).toEqual([
      { month: '2025-08', bookedCents: 5000, limitCents: null },
      { month: '2025-09', bookedCents: 2000, limitCents: 10000 },
    ]);
  });
});

describe('budgetTone', () => {
  it('has no tone without a limit', () => {
    expect(budgetTone(entry({ bookedCents: 5000 }))).toBe('none');
  });

  it.each([
    [8490, 'ok'],
    [8500, 'near'],
    [10000, 'near'],
    [10001, 'over'],
  ] as const)('at %i of 10000 cents is %s', (spent, tone) => {
    expect(budgetTone(entry({ bookedCents: spent, budgetCents: 10000 }))).toBe(tone);
  });

  it('counts vorgemerkt against the limit, as the word „über“ does', () => {
    expect(budgetTone(entry({ bookedCents: 9000, pendingCents: 2000, budgetCents: 10000 }))).toBe(
      'over',
    );
  });
});

describe('paceOf', () => {
  it('says where today is in the current month', () => {
    expect(paceOf('2025-09', new Date(2025, 8, 18))).toEqual({ day: 18, days: 30 });
  });

  it('says nothing for any other month', () => {
    expect(paceOf('2025-08', new Date(2025, 8, 18))).toBeUndefined();
  });
});
