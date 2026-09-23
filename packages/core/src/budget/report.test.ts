import { describe, expect, it } from 'vitest';

import type { Budget } from './budget.js';
import { monthlyReport, type MonthlyReportRow } from './report.js';

const WOHNEN = 'cat-wohnen';
const LEBENSMITTEL = 'cat-lebensmittel';

function row(overrides: Partial<MonthlyReportRow> = {}): MonthlyReportRow {
  return {
    bookingDate: '2025-09-22',
    amountCents: -1000,
    status: 'booked',
    categoryId: null,
    ...overrides,
  };
}

/**
 * The nine live rows the Playwright database holds after `fixtures/sparkasse-camt-18.csv`
 * is imported and `Wohnen` is applied, exactly as `docs/research/04-monthly-budgets.md`
 * §4 lists them. Every disagreement the data contains is in here: a month that is not the
 * one being reported, a salary, a pending row, two identical card payments one of which
 * was categorized, and a bucket with no category.
 */
const FIXTURE_ROWS: readonly MonthlyReportRow[] = [
  row({ bookingDate: '2014-03-24', amountCents: -114341 }),
  row({ bookingDate: '2025-09-15', amountCents: 245000 }),
  row({ bookingDate: '2025-09-18', amountCents: -19000 }),
  row({ bookingDate: '2025-09-19', amountCents: -12850 }),
  row({ bookingDate: '2025-09-20', amountCents: -115000 }),
  row({ bookingDate: '2025-09-20', amountCents: -1900, status: 'pending' }),
  row({ bookingDate: '2025-09-21', amountCents: -4217, categoryId: WOHNEN }),
  row({ bookingDate: '2025-09-21', amountCents: -4217 }),
  row({ bookingDate: '2025-09-22', amountCents: -83290, categoryId: WOHNEN }),
];

const CATEGORIES = [{ id: WOHNEN }, { id: LEBENSMITTEL }];

function budget(categoryId: string, amountCents: number, month = '2025-09'): Budget {
  return { categoryId, month, amountCents };
}

describe('monthlyReport', () => {
  describe('over the fixture month', () => {
    const report = monthlyReport(FIXTURE_ROWS, [budget(WOHNEN, 70000)], CATEGORIES, '2025-09');
    const [wohnen, lebensmittel, uncategorized] = report.categories;

    it('reports the categorized spending as a positive magnitude', () => {
      expect(wohnen).toEqual({
        categoryId: WOHNEN,
        bookedCents: 87507,
        pendingCents: 0,
        budgetCents: 70000,
        remainingCents: -17507,
        isOver: true,
        transactionCount: 2,
      });
    });

    it('keeps the uncategorized bucket last, and keeps its pending row out of the booked figure', () => {
      expect(uncategorized).toEqual({
        categoryId: null,
        bookedCents: 151067,
        pendingCents: 1900,
        budgetCents: null,
        remainingCents: null,
        isOver: false,
        transactionCount: 5,
      });
    });

    it('ignores the salary rather than netting it off the bucket it sits in', () => {
      // A raw SUM of this bucket is +92 033: a spending figure with a plus in front of it.
      expect(uncategorized?.bookedCents).toBe(151067);
    });

    it('ignores the rows belonging to another month', () => {
      expect(report.totalBookedCents).toBe(87507 + 151067);
      expect(report.totalPendingCents).toBe(1900);
    });

    it('gives a budgeted category with no spending a row of zeros and its whole limit', () => {
      // GROUP BY supplies no such row. The dashboard exists to show it.
      const withBoth = monthlyReport(
        FIXTURE_ROWS,
        [budget(WOHNEN, 70000), budget(LEBENSMITTEL, 40000)],
        CATEGORIES,
        '2025-09',
      );

      expect(withBoth.categories[1]).toEqual({
        categoryId: LEBENSMITTEL,
        bookedCents: 0,
        pendingCents: 0,
        budgetCents: 40000,
        remainingCents: 40000,
        isOver: false,
        transactionCount: 0,
      });
    });

    it('leaves an unbudgeted category without a remainder to show', () => {
      expect(lebensmittel?.budgetCents).toBeNull();
      expect(lebensmittel?.remainingCents).toBeNull();
    });

    it('totals only the limits that were actually set', () => {
      expect(report.totalBudgetCents).toBe(70000);
    });
  });

  describe('the over/under comparison', () => {
    const spend = [row({ amountCents: -70000, categoryId: WOHNEN })];

    it('is not over at exactly the limit', () => {
      const report = monthlyReport(spend, [budget(WOHNEN, 70000)], CATEGORIES, '2025-09');

      expect(report.categories[0]?.isOver).toBe(false);
      expect(report.categories[0]?.remainingCents).toBe(0);
    });

    it('is over one cent past it', () => {
      const report = monthlyReport(spend, [budget(WOHNEN, 69999)], CATEGORIES, '2025-09');

      expect(report.categories[0]?.isOver).toBe(true);
      expect(report.categories[0]?.remainingCents).toBe(-1);
    });

    it('counts a pending row against the limit while still reporting it separately', () => {
      const report = monthlyReport(
        [
          row({ amountCents: -69999, categoryId: WOHNEN }),
          row({ amountCents: -1, categoryId: WOHNEN, status: 'pending' }),
        ],
        [budget(WOHNEN, 69999)],
        CATEGORIES,
        '2025-09',
      );

      expect(report.categories[0]?.pendingCents).toBe(1);
      expect(report.categories[0]?.isOver).toBe(true);
    });

    it('treats a zero limit as a real one: anything spent is over it', () => {
      const report = monthlyReport(
        [row({ amountCents: -1, categoryId: WOHNEN })],
        [budget(WOHNEN, 0)],
        CATEGORIES,
        '2025-09',
      );

      expect(report.categories[0]).toMatchObject({
        budgetCents: 0,
        remainingCents: -1,
        isOver: true,
      });
    });

    it('leaves a zero limit with nothing spent under it', () => {
      const report = monthlyReport([], [budget(WOHNEN, 0)], CATEGORIES, '2025-09');

      expect(report.categories[0]).toMatchObject({ budgetCents: 0, isOver: false });
    });
  });

  describe('a month with nothing in it', () => {
    const report = monthlyReport(FIXTURE_ROWS, [], CATEGORIES, '1990-01');

    it('still lists every category, at zero', () => {
      expect(report.categories).toHaveLength(2);
      expect(report.categories.every((entry) => entry.bookedCents === 0)).toBe(true);
    });

    it('omits the uncategorized bucket, which cannot be budgeted and has nothing to say', () => {
      expect(report.categories.some((entry) => entry.categoryId === null)).toBe(false);
    });

    it('reports no budget at all rather than a total of zero', () => {
      expect(report.totalBudgetCents).toBeNull();
      expect(report.totalBookedCents).toBe(0);
    });
  });

  it('ignores a limit set for another month', () => {
    const report = monthlyReport(
      FIXTURE_ROWS,
      [budget(WOHNEN, 70000, '2025-08')],
      CATEGORIES,
      '2025-09',
    );

    expect(report.categories[0]?.budgetCents).toBeNull();
    expect(report.totalBudgetCents).toBeNull();
  });

  it('refuses to total an amount that is not integer cents', () => {
    // The brand exists so a float cannot reach a total silently; this is where it bites.
    expect(() => monthlyReport([row({ amountCents: -19.99 })], [], CATEGORIES, '2025-09')).toThrow(
      TypeError,
    );
  });
});
