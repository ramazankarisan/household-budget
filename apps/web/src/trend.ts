import {
  type BudgetPayload,
  type CategoryPayload,
  type CategoryReport,
  monthlyReport,
  type TransactionPayload,
} from '@household-budget/core';

/**
 * The `n` calendar months ending with `month`, oldest first: `('2025-09', 3)` →
 * `['2025-07', '2025-08', '2025-09']`. Calendar months, not the months that have data — a
 * trend with the empty months left out would hide exactly the gap it should show.
 */
export function trailingMonths(month: string, n: number): readonly string[] {
  const [year, monthOfYear] = month.split('-').map(Number);
  if (year === undefined || monthOfYear === undefined || Number.isNaN(year + monthOfYear)) {
    return [];
  }
  const out: string[] = [];
  for (let back = n - 1; back >= 0; back -= 1) {
    // Months since year 0, so the subtraction crosses a year boundary by itself.
    const index = year * 12 + (monthOfYear - 1) - back;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    out.push(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

export interface MonthTotal {
  readonly month: string;
  /** Money out, booked — the same number the month's hero shows. */
  readonly bookedCents: number;
  /** The month's summed limits; `null` when none are set or they are not loaded. */
  readonly limitCents: number | null;
}

/**
 * Each month's booked spending, through the same `monthlyReport` the month itself is read
 * with, so the trend and the hero can never disagree about a month.
 */
export function monthTotals(
  transactions: readonly TransactionPayload[],
  budgetsByMonth: ReadonlyMap<string, readonly BudgetPayload[]>,
  categories: readonly CategoryPayload[],
  months: readonly string[],
): readonly MonthTotal[] {
  return months.map((month) => {
    const budgets = budgetsByMonth.get(month);
    const report = monthlyReport(transactions, budgets ?? [], categories, month);
    return {
      month,
      bookedCents: report.totalBookedCents,
      limitCents: budgets === undefined ? null : report.totalBudgetCents,
    };
  });
}

/** How a category stands against its limit. `none`: it has no limit to stand against. */
export type BudgetTone = 'none' | 'ok' | 'near' | 'over';

/** From 85 % of a limit on, a category is close enough to it to say so (DESIGN.md §2.1). */
const NEAR_SHARE = 0.85;

/**
 * The tone of a category's row. Measured on booked **and** vorgemerkt against the limit —
 * the same comparison `monthlyReport`'s `isOver` makes (plan 08, decision 6) — so the bar's
 * colour and the word „über“ beside it cannot disagree.
 */
export function budgetTone(entry: CategoryReport): BudgetTone {
  if (entry.budgetCents === null) {
    return 'none';
  }
  if (entry.isOver) {
    return 'over';
  }
  const spent = entry.bookedCents + entry.pendingCents;
  if (entry.budgetCents === 0) {
    return 'ok';
  }
  return spent / entry.budgetCents >= NEAR_SHARE ? 'near' : 'ok';
}

/** Where today is in `month`, or `undefined` when `month` is not the current one. */
export function paceOf(
  month: string,
  today: Date = new Date(),
): { readonly day: number; readonly days: number } | undefined {
  const current = `${String(today.getFullYear())}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  if (current !== month) {
    return undefined;
  }
  // Day 0 of the next month is the last day of this one.
  const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return { day: today.getDate(), days };
}
