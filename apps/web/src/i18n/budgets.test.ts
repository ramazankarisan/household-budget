import { type BudgetInputErrorCode, type MonthlyReport } from '@household-budget/core';
import { describe, expect, it } from 'vitest';

import {
  budgetsText,
  describeBudgetError,
  describeBudgetErrors,
  describeMonthTotal,
  describeOverBy,
  describeRemaining,
} from './budgets';
import { type Locale } from './importErrors';

const LOCALES: Locale[] = ['de', 'en'];

/** `Intl` puts U+00A0 between the amount and the €; the assertions read better without it. */
const plain = (text: string): string => text.replaceAll('\u00a0', ' ');

/** Walks the whole object, so the nested column headers cannot go unchecked. */
function leaves(value: unknown, path = ''): { path: string; value: unknown }[] {
  if (typeof value !== 'object' || value === null) {
    return [{ path, value }];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, path === '' ? key : `${path}.${key}`),
  );
}

function report(overrides: Partial<MonthlyReport> = {}): MonthlyReport {
  return {
    month: '2025-09',
    categories: [],
    totalBookedCents: 238574,
    totalPendingCents: 0,
    totalBudgetCents: 70000,
    ...overrides,
  };
}

describe('budgetsText', () => {
  it('has wording for every label in both languages', () => {
    for (const locale of LOCALES) {
      for (const { path, value } of leaves(budgetsText(locale))) {
        expect(typeof value, path).toBe('string');
        expect(value as string, path).not.toBe('');
        expect(value as string, path).not.toContain('undefined');
      }
    }
  });

  it('defaults to German', () => {
    expect(budgetsText().columns.booked).toBe('Gebucht');
    expect(budgetsText('en').columns.booked).toBe('Booked');
  });

  it('calls a pending amount what the transactions table calls it', () => {
    // The ⏳ marker's accessible name on both pages; one word, not two.
    expect(budgetsText().pendingHint).toBe('vorgemerkt');
  });
});

describe('describeRemaining', () => {
  it('says over, with the amount as a magnitude', () => {
    expect(plain(describeRemaining(-17507))).toBe('175,07 € über');
    expect(plain(describeRemaining(-17507, 'en'))).toBe('175,07 € over');
    expect(plain(describeOverBy(17507))).toBe('175,07 € über');
  });

  it('says left, including exactly at the limit', () => {
    expect(plain(describeRemaining(40000))).toBe('400,00 € übrig');
    expect(plain(describeRemaining(0))).toBe('0,00 € übrig');
  });

  it('shows a dash when there is nothing to compare against', () => {
    expect(describeRemaining(null)).toBe('—');
  });
});

describe('describeMonthTotal', () => {
  it('sets what was booked against what was budgeted, and says how far over', () => {
    expect(plain(describeMonthTotal(report()))).toBe('2.385,74 € von 700,00 € · 1.685,74 € über');
    expect(plain(describeMonthTotal(report(), 'en'))).toBe(
      '2.385,74 € of 700,00 € · 1.685,74 € over',
    );
  });

  it('names pending money after the headline rather than inside it', () => {
    expect(plain(describeMonthTotal(report({ totalPendingCents: 1900 })))).toBe(
      '2.385,74 € von 700,00 € · 1.685,74 € über · 19,00 € vorgemerkt',
    );
  });

  it('states only what was spent while the limits are still loading', () => {
    // The rows are in memory, the limits are not: saying "kein Budget gesetzt" here would
    // be a claim about data that has not arrived (dogfood ISSUE-009).
    const loading = { limitsLoading: true };
    expect(plain(describeMonthTotal(report({ totalBookedCents: 241364 }), 'de', loading))).toBe(
      '2.413,64 € ausgegeben',
    );
    expect(
      plain(
        describeMonthTotal(
          report({ totalBookedCents: 241364, totalPendingCents: 1900 }),
          'en',
          loading,
        ),
      ),
    ).toBe('2.413,64 € spent · 19,00 € pending');
  });

  it('says no budget is set rather than comparing against zero', () => {
    expect(
      plain(describeMonthTotal(report({ totalBookedCents: 114341, totalBudgetCents: null }))),
    ).toBe('1.143,41 € von — · kein Budget gesetzt');
  });

  it('never prints undefined in either language', () => {
    for (const locale of LOCALES) {
      for (const totalBudgetCents of [null, 0, 70000]) {
        expect(describeMonthTotal(report({ totalBudgetCents }), locale)).not.toContain('undefined');
      }
    }
  });
});

describe('describeBudgetError', () => {
  const codes: BudgetInputErrorCode[] = [
    'MONTH_INVALID',
    'CATEGORY_REQUIRED',
    'AMOUNT_NOT_AN_INTEGER',
    'AMOUNT_NEGATIVE',
    'AMOUNT_TOO_LARGE',
  ];

  it('has a sentence for every code core can emit', () => {
    for (const code of codes) {
      for (const locale of LOCALES) {
        const sentence = describeBudgetError({ code, field: 'amountCents' }, locale);
        expect(sentence, code).not.toBe('');
        expect(sentence, code).not.toContain('undefined');
      }
    }
  });

  it('marks each bad field once, keeping the first sentence', () => {
    expect(
      describeBudgetErrors([
        { code: 'MONTH_INVALID', field: 'month' },
        { code: 'AMOUNT_NEGATIVE', field: 'amountCents' },
        { code: 'AMOUNT_TOO_LARGE', field: 'amountCents' },
      ]),
    ).toEqual({ month: 'Ungültiger Monat', amountCents: 'Ein Budget kann nicht negativ sein' });
  });
});
