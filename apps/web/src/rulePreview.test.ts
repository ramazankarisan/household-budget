import { type RulePayload, type TransactionPayload } from '@household-budget/core';
import { describe, expect, it } from 'vitest';

import { previewRule } from './rulePreview';

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
