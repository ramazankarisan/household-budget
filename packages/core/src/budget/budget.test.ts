import { describe, expect, it } from 'vitest';

import { type BudgetInputErrorCode, MAX_BUDGET_CENTS, parseBudgetInput } from './budget.js';

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    month: '2025-09',
    categoryId: 'cat-wohnen',
    amountCents: 70000,
    ...overrides,
  };
}

function codesOf(input: unknown): BudgetInputErrorCode[] {
  const result = parseBudgetInput(input);
  return result.ok ? [] : result.errors.map((error) => error.code);
}

describe('parseBudgetInput', () => {
  it('accepts a well-formed budget', () => {
    const result = parseBudgetInput(body());

    expect(result).toEqual({
      ok: true,
      budget: { categoryId: 'cat-wohnen', month: '2025-09', amountCents: 70000 },
    });
  });

  it('accepts zero, which is a real limit and not an absent one', () => {
    expect(parseBudgetInput(body({ amountCents: 0 })).ok).toBe(true);
  });

  it('accepts the cap and refuses one cent past it', () => {
    expect(parseBudgetInput(body({ amountCents: MAX_BUDGET_CENTS })).ok).toBe(true);
    expect(codesOf(body({ amountCents: MAX_BUDGET_CENTS + 1 }))).toEqual(['AMOUNT_TOO_LARGE']);
  });

  it('refuses a negative limit', () => {
    expect(codesOf(body({ amountCents: -1 }))).toEqual(['AMOUNT_NEGATIVE']);
  });

  it('refuses a limit that is not integer cents', () => {
    // 19.99 * 100 is 1998.9999999999998. Nothing stored here is ever a float.
    expect(codesOf(body({ amountCents: 1.5 }))).toEqual(['AMOUNT_NOT_AN_INTEGER']);
    expect(codesOf(body({ amountCents: '700' }))).toEqual(['AMOUNT_NOT_AN_INTEGER']);
    expect(codesOf(body({ amountCents: Number.NaN }))).toEqual(['AMOUNT_NOT_AN_INTEGER']);
    expect(codesOf(body({ amountCents: undefined }))).toEqual(['AMOUNT_NOT_AN_INTEGER']);
  });

  it('refuses every month that is not one', () => {
    for (const month of ['2025-13', '2025-9', '2025-', 'x-y', '', '2025-09-22']) {
      expect(codesOf(body({ month }))).toEqual(['MONTH_INVALID']);
    }
  });

  it('refuses a missing category', () => {
    expect(codesOf(body({ categoryId: '   ' }))).toEqual(['CATEGORY_REQUIRED']);
    expect(codesOf(body({ categoryId: undefined }))).toEqual(['CATEGORY_REQUIRED']);
  });

  it('trims the category id it returns', () => {
    const result = parseBudgetInput(body({ categoryId: ' cat-wohnen ' }));

    expect(result.ok && result.budget.categoryId).toBe('cat-wohnen');
  });

  it('reports two bad fields at once rather than the first', () => {
    expect(codesOf(body({ month: '2025-13', amountCents: -1 }))).toEqual([
      'MONTH_INVALID',
      'AMOUNT_NEGATIVE',
    ]);
  });

  it('marks the field each problem is about', () => {
    const result = parseBudgetInput(body({ amountCents: -1 }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toEqual([
      { code: 'AMOUNT_NEGATIVE', field: 'amountCents' },
    ]);
  });

  it('reports everything about a body that is not an object at all', () => {
    expect(codesOf(null)).toEqual(['MONTH_INVALID', 'CATEGORY_REQUIRED', 'AMOUNT_NOT_AN_INTEGER']);
  });
});
