import {
  type BudgetInputError,
  type BudgetInputErrorCode,
  type MonthlyReport,
} from '@household-budget/core';

import { formatAmount } from '../format';
import { type Locale } from './importErrors';

/**
 * Every string the budgets dashboard shows, in both languages.
 *
 * Only what is new: `Monat`, `Ohne Kategorie` and the "nothing imported yet" sentence are
 * `transactions.ts`'s and are reused from there, so the two pages cannot drift on what
 * the same thing is called.
 */
interface BudgetsText {
  readonly navBudgets: string;
  readonly columns: {
    readonly category: string;
    readonly booked: string;
    readonly pending: string;
    readonly budget: string;
    readonly remaining: string;
  };
  /** The empty field's placeholder: what typing into it does. */
  readonly setBudget: string;
  readonly clearBudget: string;
  readonly over: string;
  readonly left: string;
  /** The month total when nothing in the month is budgeted. */
  readonly noBudgets: string;
  /** The ⏳ marker's accessible name — the same word the transactions table uses. */
  readonly pendingHint: string;
  /** What the uncategorized row's button does, for its title. */
  readonly showUncategorized: string;
  readonly toTransactions: string;
  /** The chart's caption, and its accessible name. */
  readonly chartTitle: string;
}

const TEXT: Record<Locale, BudgetsText> = {
  de: {
    navBudgets: 'Budgets',
    columns: {
      category: 'Kategorie',
      booked: 'Gebucht',
      pending: 'Vorgemerkt',
      budget: 'Budget',
      remaining: 'Rest',
    },
    setBudget: 'Budget setzen',
    clearBudget: 'Budget entfernen',
    over: 'über',
    left: 'übrig',
    noBudgets: 'kein Budget gesetzt',
    pendingHint: 'vorgemerkt',
    showUncategorized: 'Umsätze ohne Kategorie in diesem Monat zeigen',
    toTransactions: 'Zu den Umsätzen',
    chartTitle: 'Ausgaben nach Kategorie',
  },
  en: {
    navBudgets: 'Budgets',
    columns: {
      category: 'Category',
      booked: 'Booked',
      pending: 'Pending',
      budget: 'Budget',
      remaining: 'Remaining',
    },
    setBudget: 'Set budget',
    clearBudget: 'Remove budget',
    over: 'over',
    left: 'left',
    noBudgets: 'no budget set',
    pendingHint: 'pending',
    showUncategorized: 'Show this month’s transactions without a category',
    toTransactions: 'Go to transactions',
    chartTitle: 'Spending by category',
  },
};

export function budgetsText(locale: Locale = 'de'): BudgetsText {
  return TEXT[locale];
}

/** `175,07 € über`. The word is the signal; the colour only repeats it. */
export function describeOverBy(cents: number, locale: Locale = 'de'): string {
  return `${formatAmount(cents)} ${TEXT[locale].over}`;
}

/** `400,00 € übrig`. */
export function describeLeft(cents: number, locale: Locale = 'de'): string {
  return `${formatAmount(cents)} ${TEXT[locale].left}`;
}

/**
 * The remainder a row shows: over, left, or nothing to compare against.
 *
 * `remainingCents` is signed — negative means over — and the sentence is not: "−175,07 €
 * übrig" is a sign error the reader has to undo, which is what decision 5 of the plan
 * keeps out of the arithmetic and this keeps out of the words.
 */
export function describeRemaining(remainingCents: number | null, locale: Locale = 'de'): string {
  if (remainingCents === null) {
    return '—';
  }
  return remainingCents < 0
    ? describeOverBy(-remainingCents, locale)
    : describeLeft(remainingCents, locale);
}

const MONTH_TOTAL: Record<Locale, { readonly of: string; readonly pending: string }> = {
  de: { of: 'von', pending: 'vorgemerkt' },
  en: { of: 'of', pending: 'pending' },
};

/**
 * The month in one line: `2.385,74 € von 700,00 € · 1.685,74 € über`.
 *
 * The headline figure is what is **booked**, across every row including the uncategorized
 * ones, set against the sum of the limits actually set. Pending money is named after it
 * rather than folded in, for the reason the report keeps the two apart: it is a snapshot
 * the next import replaces, and a headline that silently contains it can fall overnight.
 *
 * A function rather than pieces a page concatenates — "no budget set" is a different
 * sentence, not the same sentence with a dash in it.
 */
export function describeMonthTotal(report: MonthlyReport, locale: Locale = 'de'): string {
  const words = MONTH_TOTAL[locale];
  const text = TEXT[locale];
  const booked = formatAmount(report.totalBookedCents);
  const parts =
    report.totalBudgetCents === null
      ? [`${booked} ${words.of} —`, text.noBudgets]
      : [
          `${booked} ${words.of} ${formatAmount(report.totalBudgetCents)}`,
          describeRemaining(report.totalBudgetCents - report.totalBookedCents, locale),
        ];

  if (report.totalPendingCents > 0) {
    parts.push(`${formatAmount(report.totalPendingCents)} ${words.pending}`);
  }
  return parts.join(' · ');
}

const BUDGET_ERRORS: Record<Locale, Record<BudgetInputErrorCode, string>> = {
  de: {
    MONTH_INVALID: 'Ungültiger Monat',
    CATEGORY_REQUIRED: 'Kategorie fehlt',
    AMOUNT_NOT_AN_INTEGER: 'Betrag in Euro, z. B. 700 oder 700,50',
    AMOUNT_NEGATIVE: 'Ein Budget kann nicht negativ sein',
    AMOUNT_TOO_LARGE: 'Budget ist zu groß',
  },
  en: {
    MONTH_INVALID: 'invalid month',
    CATEGORY_REQUIRED: 'category is required',
    AMOUNT_NOT_AN_INTEGER: 'an amount in euro, e.g. 700 or 700,50',
    AMOUNT_NEGATIVE: 'a budget cannot be negative',
    AMOUNT_TOO_LARGE: 'budget is too large',
  },
};

export function describeBudgetError(error: BudgetInputError, locale: Locale = 'de'): string {
  return BUDGET_ERRORS[locale][error.code];
}

/** `{ amountCents: 'Budget ist zu groß' }` — the shape `describeRuleErrors` returns. */
export function describeBudgetErrors(
  errors: readonly BudgetInputError[],
  locale: Locale = 'de',
): Readonly<Record<string, string>> {
  const marked: Record<string, string> = {};
  for (const error of errors) {
    marked[error.field] ??= describeBudgetError(error, locale);
  }
  return marked;
}
