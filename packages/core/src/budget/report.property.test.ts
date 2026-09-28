/**
 * The invariants monthlyReport's module comment states, checked over generated months
 * rather than the handful in report.test.ts: money out only, booked and vorgemerkt kept
 * apart, every category a row, and nothing lost or counted twice.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { type MonthlyReportRow, monthlyReport } from './report.js';

const MONTH = '2025-09';
const CATEGORY_IDS = ['food', 'rent', 'fun'] as const;
const categories = CATEGORY_IDS.map((id) => ({ id }));

const row: fc.Arbitrary<MonthlyReportRow> = fc.record({
  bookingDate: fc
    .record({
      month: fc.constantFrom('2025-08', MONTH, '2025-10'),
      day: fc.integer({ min: 1, max: 28 }),
    })
    .map(({ month, day }) => `${month}-${String(day).padStart(2, '0')}`),
  amountCents: fc.integer({ min: -1_000_000, max: 1_000_000 }),
  status: fc.constantFrom('booked' as const, 'pending' as const),
  categoryId: fc.constantFrom<string | null>(null, ...CATEGORY_IDS),
});

const budget = fc.record({
  categoryId: fc.constantFrom(...CATEGORY_IDS),
  month: fc.constant(MONTH),
  amountCents: fc.integer({ min: 0, max: 1_000_000 }),
});

const outThisMonth = (r: MonthlyReportRow) => r.amountCents < 0 && r.bookingDate.startsWith(MONTH);
const sumOut = (rows: readonly MonthlyReportRow[]) =>
  rows.reduce((sum, r) => sum - r.amountCents, 0);

describe('monthlyReport (properties)', () => {
  it('totals exactly the money out of this month, booked and vorgemerkt kept apart', () => {
    fc.assert(
      fc.property(fc.array(row), fc.array(budget), (rows, budgets) => {
        const report = monthlyReport(rows, budgets, categories, MONTH);
        const counted = rows.filter(outThisMonth);

        expect(report.totalBookedCents).toBe(sumOut(counted.filter((r) => r.status === 'booked')));
        expect(report.totalPendingCents).toBe(
          sumOut(counted.filter((r) => r.status === 'pending')),
        );
        expect(report.categories.reduce((n, c) => n + c.transactionCount, 0)).toBe(counted.length);
      }),
    );
  });

  it('gives every category a row, and the uncategorized bucket never has a limit', () => {
    fc.assert(
      fc.property(fc.array(row), fc.array(budget), (rows, budgets) => {
        const report = monthlyReport(rows, budgets, categories, MONTH);
        const ids = report.categories.map((c) => c.categoryId);

        expect(ids.slice(0, CATEGORY_IDS.length)).toEqual([...CATEGORY_IDS]);
        for (const bucket of report.categories.filter((c) => c.categoryId === null)) {
          expect(bucket.budgetCents).toBeNull();
          expect(bucket.isOver).toBe(false);
        }
      }),
    );
  });

  it('does not depend on the order the rows arrive in', () => {
    fc.assert(
      fc.property(
        fc
          .array(row)
          .chain((rows) =>
            fc.tuple(fc.constant(rows), fc.shuffledSubarray(rows, { minLength: rows.length })),
          ),
        ([rows, shuffled]) => {
          expect(monthlyReport(shuffled, [], categories, MONTH)).toEqual(
            monthlyReport(rows, [], categories, MONTH),
          );
        },
      ),
    );
  });

  it('is over a limit only when spending strictly exceeds it', () => {
    fc.assert(
      fc.property(fc.array(row), fc.array(budget), (rows, budgets) => {
        for (const c of monthlyReport(rows, budgets, categories, MONTH).categories) {
          if (c.budgetCents === null) {
            continue;
          }
          expect(c.isOver).toBe(c.bookedCents + c.pendingCents > c.budgetCents);
          expect(c.remainingCents).toBe(c.budgetCents - c.bookedCents - c.pendingCents);
        }
      }),
    );
  });
});
