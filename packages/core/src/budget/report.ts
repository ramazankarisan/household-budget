/**
 * The month's arithmetic: what was spent per category, against what was budgeted.
 *
 * One function, read by both the table and the chart, because "what counts as spending"
 * is a rule that must exist exactly once. Three decisions are baked into it, and all
 * three come from what the stored data actually contains
 * (`docs/research/04-monthly-budgets.md` §4):
 *
 * 1. **Money out only.** `amountCents` is signed and a salary is a positive row. A raw
 *    sum of the fixture's uncategorized bucket for September 2025 is `+920,33 €` — a
 *    "spending" figure with a plus in front of it.
 * 2. **Booked and pending are both reported and never added into one number.** A pending
 *    row is a snapshot the next import replaces wholesale, so a total that silently
 *    contains one can fall without explanation. The table already keeps them apart
 *    visually with the vorgemerkt marker; this keeps them apart arithmetically.
 * 3. **Spending is a positive magnitude.** `spent > budget` is what every comparison in
 *    the feature wants, and carrying `-87507` instead would put a sign flip between the
 *    data and the word "über". This is the one place the signed convention is left
 *    behind, and {@link monthlyReport} is the only function here that calls `Math.abs`
 *    on an amount.
 *
 * It runs in the browser over the rows the page has already loaded — 0.478 ms for a month
 * of 50 000 rows (research §7), against 0.162 ms of server time plus a second place where
 * decision 1 would have to be made. Living here is what leaves an endpoint available
 * later without the browser changing its mind about the answer.
 */
import { toCents } from '../csv/transaction.js';
import type { BookingStatus } from '../csv/transaction.js';
import type { Budget } from './budget.js';
import { monthOfDate } from './month.js';

/**
 * The part of a transaction this arithmetic reads. `TransactionPayload` satisfies it
 * structurally, which is why nothing here imports it — the same posture
 * `MatchableTransaction` takes.
 */
export interface MonthlyReportRow {
  /** `'YYYY-MM-DD'`. */
  readonly bookingDate: string;
  /** Signed integer cents. Negative is money out. */
  readonly amountCents: number;
  readonly status: BookingStatus;
  /** `null` is the uncategorized bucket, not a missing value. */
  readonly categoryId: string | null;
}

export interface CategoryReport {
  /** `null` is the uncategorized bucket. It has a row and never a budget. */
  readonly categoryId: string | null;
  /** Money out, booked, as a positive magnitude. See the module comment. */
  readonly bookedCents: number;
  /** Money out on rows still vorgemerkt. Never added into `bookedCents`. */
  readonly pendingCents: number;
  /** The limit for this month, or `null` when none is set — always `null` for the bucket. */
  readonly budgetCents: number | null;
  /** `budgetCents - (booked + pending)`. Negative means over. `null` when unbudgeted. */
  readonly remainingCents: number | null;
  readonly isOver: boolean;
  /** Rows that contributed, booked and pending together. Income is not one of them. */
  readonly transactionCount: number;
}

export interface MonthlyReport {
  readonly month: string;
  /** Category order as given, with the uncategorized bucket last when it has anything. */
  readonly categories: readonly CategoryReport[];
  readonly totalBookedCents: number;
  readonly totalPendingCents: number;
  /** Sum of the limits actually set, or `null` when the month has none. */
  readonly totalBudgetCents: number | null;
}

/** Just enough of a category to place and order a row. */
export interface ReportableCategory {
  readonly id: string;
}

/** What one key accumulates while the rows are walked. */
interface Bucket {
  bookedCents: number;
  pendingCents: number;
  transactionCount: number;
}

function emptyBucket(): Bucket {
  return { bookedCents: 0, pendingCents: 0, transactionCount: 0 };
}

/**
 * The month's spending per category, and how it stands against the limits set for it.
 *
 * Every category gets a row whether or not it was spent in, because the rows are built
 * from `categories` and not from the transactions: `GROUP BY` supplies no zeros
 * (research §5), and a category that was budgeted and left alone is exactly the row a
 * dashboard exists to show. The uncategorized bucket is appended only when it has
 * something in it — it cannot be budgeted, so an empty one says nothing.
 */
export function monthlyReport(
  rows: readonly MonthlyReportRow[],
  budgets: readonly Budget[],
  categories: readonly ReportableCategory[],
  month: string,
): MonthlyReport {
  // Keyed by `categoryId` as it stands, `null` included: the bucket is a real key here,
  // exactly as it is a real key in the `GROUP BY` this replaces.
  const buckets = new Map<string | null, Bucket>();

  for (const row of rows) {
    // Money out, this month, and nothing else. A salary is not negative spending.
    if (row.amountCents >= 0 || monthOfDate(row.bookingDate) !== month) {
      continue;
    }

    const bucket = buckets.get(row.categoryId) ?? emptyBucket();
    /*
     * The one `Math.abs` this arithmetic contains, through `toCents` so a float that
     * reached a stored amount cannot reach a total silently. Decision 3 in the module
     * comment is what it implements.
     */
    const magnitude = toCents(Math.abs(row.amountCents));

    if (row.status === 'pending') {
      bucket.pendingCents += magnitude;
    } else {
      bucket.bookedCents += magnitude;
    }
    bucket.transactionCount += 1;
    buckets.set(row.categoryId, bucket);
  }

  const limits = new Map<string, number>();
  for (const budget of budgets) {
    if (budget.month === month) {
      limits.set(budget.categoryId, budget.amountCents);
    }
  }

  const reports: CategoryReport[] = categories.map((category) => {
    const bucket = buckets.get(category.id) ?? emptyBucket();
    const budgetCents = limits.get(category.id) ?? null;
    const spent = bucket.bookedCents + bucket.pendingCents;

    return {
      categoryId: category.id,
      bookedCents: bucket.bookedCents,
      pendingCents: bucket.pendingCents,
      budgetCents,
      remainingCents: budgetCents === null ? null : budgetCents - spent,
      // Exactly at the limit is not over: a budget is what may be spent, not what may not.
      isOver: budgetCents !== null && spent > budgetCents,
      transactionCount: bucket.transactionCount,
    };
  });

  const uncategorized = buckets.get(null);
  if (uncategorized !== undefined) {
    reports.push({
      categoryId: null,
      bookedCents: uncategorized.bookedCents,
      pendingCents: uncategorized.pendingCents,
      budgetCents: null,
      remainingCents: null,
      isOver: false,
      transactionCount: uncategorized.transactionCount,
    });
  }

  const budgeted = reports.filter((report) => report.budgetCents !== null);

  return {
    month,
    categories: reports,
    totalBookedCents: reports.reduce((sum, report) => sum + report.bookedCents, 0),
    totalPendingCents: reports.reduce((sum, report) => sum + report.pendingCents, 0),
    totalBudgetCents:
      budgeted.length === 0
        ? null
        : budgeted.reduce((sum, report) => sum + (report.budgetCents ?? 0), 0),
  };
}
