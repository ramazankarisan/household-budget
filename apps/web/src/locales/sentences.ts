import {
  type ApplySummary,
  type BudgetInputError,
  type MonthlyReport,
  type RowError,
  type RuleInputError,
} from '@household-budget/core';
import { type TFunction } from 'i18next';

import { formatAmount } from '../format';
import { de } from './de';

/*
 * Sentences that combine values with words. Functions rather than fragments a page
 * concatenates: zero, loading and unknown codes are different sentences, not the same
 * sentence with a blank in it — and a page assembling the German half is how the English
 * half goes missing. Each takes the caller's `t`, so it speaks whatever language that is.
 */

// ── transactions ──────────────────────────────────────────────────────────────────────

/**
 * How much of the account still has no category, in one chip. "0 ohne Kategorie" is a
 * number to read; "Alle kategorisiert" is an answer.
 */
export function describeUncategorized(t: TFunction, count: number): string {
  return count === 0
    ? t('transactions.allCategorized')
    : t('transactions.uncategorizedCount', { uncategorized: count });
}

// ── import errors ─────────────────────────────────────────────────────────────────────

/** `Zeile 88: Betrag nicht lesbar — Betrag "12,3,4"` */
export function describeRowError(t: TFunction, error: RowError): string {
  const head = `${t('errors.lineLabel')} ${String(error.line)}: ${t(`errors.row.${error.code}`)}`;
  if (error.field === undefined) {
    return head;
  }
  const value = error.value === undefined ? '' : ` "${error.value}"`;
  return `${head} — ${error.field}${value}`;
}

type KnownFileErrorCode = keyof typeof de.errors.file;

function isKnownFileErrorCode(code: string): code is KnownFileErrorCode {
  return Object.hasOwn(de.errors.file, code);
}

/**
 * A file that was rejected whole. Three sources of code: core's own
 * `ImportFileErrorCode`, the upload checks in the API's import controller, and the
 * `CSV_`-prefixed codes csv-parse raises for a structurally broken file. The last set is
 * open-ended, so an unknown one still reaches the user as its code rather than as silence.
 *
 * `Pflichtspalte fehlt: Betrag, Buchungstag`
 */
export function describeFileError(
  t: TFunction,
  code: string,
  columns: readonly string[] = [],
): string {
  const head = isKnownFileErrorCode(code)
    ? t(`errors.file.${code}`)
    : t('errors.unknownFile', { code });
  return columns.length > 0 ? `${head}: ${columns.join(', ')}` : head;
}

// ── rules ─────────────────────────────────────────────────────────────────────────────

/** One sentence per rejected field, in the order core reported them. */
export function describeRuleError(t: TFunction, error: RuleInputError): string {
  return t(`errors.rule.${error.code}`);
}

/** `{ value: 'Suchbegriff fehlt' }` — what a form marks each field with. */
export function describeRuleErrors(
  t: TFunction,
  errors: readonly RuleInputError[],
): Readonly<Record<string, string>> {
  const marked: Record<string, string> = {};
  for (const error of errors) {
    marked[error.field] ??= describeRuleError(t, error);
  }
  return marked;
}

/** What points at a category: the three counts a refused delete carries. */
export interface CategoryUse {
  readonly rules: number;
  readonly transactions: number;
  readonly budgets: number;
}

/**
 * The refusal that deleting a category in use earns, with the counts that explain it.
 *
 * An object rather than three positional numbers: the third arrived with budgets, and
 * three adjacent `number` parameters are two transpositions the compiler cannot see.
 */
export function describeCategoryInUse(t: TFunction, use: CategoryUse): string {
  return t('rules.categoryInUse', { ...use });
}

/** The snackbar after a category is deleted, next to the button that brings it back. */
export function describeCategoryDeleted(t: TFunction, name: string): string {
  return t('rules.categoryDeleted', { name });
}

/** The same snackbar for a rule, named by its search term — what the table shows for it. */
export function describeRuleDeleted(t: TFunction, label: string): string {
  return t('rules.ruleDeleted', { label });
}

/**
 * What an apply just did, in one line. The four counts only mean anything together, and a
 * page assembling them is how the German once ended up hard-coded in `RulesPage`.
 */
export function describeApplySummary(t: TFunction, summary: ApplySummary): string {
  return t('rules.applySummary', { ...summary });
}

// ── budgets ───────────────────────────────────────────────────────────────────────────

/** `175,07 € über`. The word is the signal; the colour only repeats it. */
export function describeOverBy(t: TFunction, cents: number): string {
  return `${formatAmount(cents)} ${t('budgets.over')}`;
}

/** `400,00 € übrig`. */
export function describeLeft(t: TFunction, cents: number): string {
  return `${formatAmount(cents)} ${t('budgets.left')}`;
}

/**
 * The remainder a row shows: over, left, or nothing to compare against.
 *
 * `remainingCents` is signed — negative means over — and the sentence is not: "−175,07 €
 * übrig" is a sign error the reader has to undo, which is what decision 5 of plan 04
 * keeps out of the arithmetic and this keeps out of the words.
 */
export function describeRemaining(t: TFunction, remainingCents: number | null): string {
  if (remainingCents === null) {
    return '—';
  }
  return remainingCents < 0 ? describeOverBy(t, -remainingCents) : describeLeft(t, remainingCents);
}

export interface MonthTotalOptions {
  /**
   * The month's limits have not arrived yet. The spending is known — the rows are already
   * loaded — so it is said; what it is measured against is not, so nothing is said about
   * that rather than "kein Budget gesetzt", which would be a claim.
   */
  readonly limitsLoading?: boolean;
}

/**
 * The month in one line: `2.385,74 € von 700,00 € · 1.685,74 € über`.
 *
 * The headline figure is what is **booked**, across every row including the uncategorized
 * ones, set against the sum of the limits actually set. Pending money is named after it
 * rather than folded in, for the reason the report keeps the two apart: it is a snapshot
 * the next import replaces, and a headline that silently contains it can fall overnight.
 *
 * "No budget set" is a different sentence, not the same sentence with a dash in it.
 */
export function describeMonthTotal(
  t: TFunction,
  report: MonthlyReport,
  { limitsLoading = false }: MonthTotalOptions = {},
): string {
  const booked = formatAmount(report.totalBookedCents);
  const parts = limitsLoading
    ? [`${booked} ${t('budgets.monthTotal.spent')}`]
    : report.totalBudgetCents === null
      ? [`${booked} ${t('budgets.monthTotal.of')} —`, t('budgets.noBudgets')]
      : [
          `${booked} ${t('budgets.monthTotal.of')} ${formatAmount(report.totalBudgetCents)}`,
          describeRemaining(t, report.totalBudgetCents - report.totalBookedCents),
        ];

  if (report.totalPendingCents > 0) {
    parts.push(`${formatAmount(report.totalPendingCents)} ${t('budgets.monthTotal.pending')}`);
  }
  return parts.join(' · ');
}

export function describeBudgetError(t: TFunction, error: BudgetInputError): string {
  return t(`errors.budget.${error.code}`);
}

/** `{ amountCents: 'Budget ist zu groß' }` — the shape `describeRuleErrors` returns. */
export function describeBudgetErrors(
  t: TFunction,
  errors: readonly BudgetInputError[],
): Readonly<Record<string, string>> {
  const marked: Record<string, string> = {};
  for (const error of errors) {
    marked[error.field] ??= describeBudgetError(t, error);
  }
  return marked;
}
