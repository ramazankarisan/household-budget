import { type RulePayload, type TransactionPayload } from '@household-budget/core';
import { describe, expect, it } from 'vitest';

import { alwaysRuleFor } from './alwaysRule';

function transaction(overrides: Partial<TransactionPayload> = {}): TransactionPayload {
  return {
    id: 't-1',
    bookingDate: '2025-09-22',
    valueDate: null,
    amountCents: -4217,
    currency: 'EUR',
    status: 'booked',
    counterpartyName: 'REWE SAGT DANKE; FILIALE 42',
    counterpartyIban: null,
    purpose: 'Einkauf Lebensmittel',
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
    categoryId: 'cat-food',
    active: true,
    ...overrides,
  };
}

describe('alwaysRuleFor', () => {
  it('offers the payee, contained, to the category just picked, appended', () => {
    expect(
      alwaysRuleFor(transaction({ counterpartyName: '  REWE Markt  ' }), 'cat-food', []),
    ).toEqual({
      field: 'counterpartyName',
      operator: 'contains',
      value: 'REWE Markt',
      categoryId: 'cat-food',
      active: true,
    });
  });

  it('offers nothing for a cleared category or a row without a payee', () => {
    expect(alwaysRuleFor(transaction(), null, [])).toBeUndefined();
    expect(alwaysRuleFor(transaction({ counterpartyName: null }), 'cat-food', [])).toBeUndefined();
    expect(alwaysRuleFor(transaction({ counterpartyName: '   ' }), 'cat-food', [])).toBeUndefined();
  });

  it('offers nothing for a payee longer than a rule may be', () => {
    expect(
      alwaysRuleFor(transaction({ counterpartyName: 'x'.repeat(201) }), 'cat-food', []),
    ).toBeUndefined();
  });

  it('offers nothing when the same rule is there, whatever its case or whether it is on', () => {
    const same = rule({ value: 'rewe sagt danke; filiale 42', active: false });

    expect(alwaysRuleFor(transaction(), 'cat-food', [same])).toBeUndefined();
    // The same keyword to another category is not the same rule — but see the next case.
    expect(alwaysRuleFor(transaction(), 'cat-home', [same])).toBeDefined();
  });

  it('offers nothing when an active rule already claims the row: appended, it would never win', () => {
    const earlier = rule({ value: 'rewe', categoryId: 'cat-other' });

    expect(alwaysRuleFor(transaction(), 'cat-food', [earlier])).toBeUndefined();
    expect(alwaysRuleFor(transaction(), 'cat-food', [{ ...earlier, active: false }])).toBeDefined();
  });
});
