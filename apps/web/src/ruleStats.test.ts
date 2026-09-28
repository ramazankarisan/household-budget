import { type RulePayload, type TransactionPayload } from '@household-budget/core';
import { describe, expect, it } from 'vitest';

import { ruleWins } from './ruleStats';

function row(id: string, overrides: Partial<TransactionPayload> = {}): TransactionPayload {
  return {
    id,
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

function rule(id: string, value: string, overrides: Partial<RulePayload> = {}): RulePayload {
  return {
    id,
    field: 'counterpartyName',
    operator: 'contains',
    value,
    priority: 10,
    categoryId: 'cat-a',
    active: true,
    ...overrides,
  };
}

describe('ruleWins', () => {
  it('counts a row for the first rule that matches it, never for a later one', () => {
    const rules = [rule('r-1', 'müller'), rule('r-2', 'rewe'), rule('r-3', 'gmbh')];
    const rows = [row('a'), row('b', { counterpartyName: 'REWE GmbH' })];

    const wins = ruleWins(rules, rows);

    expect(wins.get('r-1')).toBe(1);
    expect(wins.get('r-2')).toBe(1);
    expect(wins.get('r-3')).toBeUndefined();
  });

  it('leaves rows set by hand out, and lets switched-off rules win nothing', () => {
    const rules = [rule('r-off', 'müller', { active: false }), rule('r-on', 'gmbh')];
    const rows = [row('a'), row('locked', { categoryLockedAt: '2026-09-01T00:00:00Z' })];

    const wins = ruleWins(rules, rows);

    expect(wins.get('r-off')).toBeUndefined();
    expect(wins.get('r-on')).toBe(1);
  });
});
