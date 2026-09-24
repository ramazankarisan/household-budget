import {
  type ApplySummary,
  type BudgetInputError,
  type MonthlyReport,
  type RowError,
  type RuleInputError,
} from '@household-budget/core';
import { type TFunction } from 'i18next';

import { ApiError } from '../api/client';
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

/**
 * One sentence per bad form field, keyed by the field: the first error core reported for
 * it wins. Shared by the rule form and the budget writes, so the two cannot drift.
 */
function markFields<E extends { readonly field: string }>(
  errors: readonly E[],
  describe: (error: E) => string,
): Readonly<Record<string, string>> {
  const marked: Record<string, string> = {};
  for (const error of errors) {
    marked[error.field] ??= describe(error);
  }
  return marked;
}

/** `{ value: 'Suchbegriff fehlt' }` — what a form marks each field with. */
export function describeRuleErrors(
  t: TFunction,
  errors: readonly RuleInputError[],
): Readonly<Record<string, string>> {
  return markFields(errors, (error) => describeRuleError(t, error));
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

/** The counts a `CATEGORY_IN_USE` refusal carries, read defensively: it is JSON. */
export function categoryUseOf(details: Readonly<Record<string, unknown>>): CategoryUse {
  const count = (value: unknown) => (typeof value === 'number' ? value : 0);
  return {
    rules: count(details['rules']),
    transactions: count(details['transactions']),
    budgets: count(details['budgets']),
  };
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
    parts.push(`${formatAmount(report.totalPendingCents)} ${t('common.pending')}`);
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
  return markFields(errors, (error) => describeBudgetError(t, error));
}

// ── failures ──────────────────────────────────────────────────────────────────────────

type ApiRefusalCode = keyof typeof de.errors.api;

function isApiRefusalCode(code: string): code is ApiRefusalCode {
  return Object.hasOwn(de.errors.api, code);
}

/** The per-field errors a `RULE_INVALID` / `BUDGET_INVALID` refusal carries. */
function fieldErrorsOf<E>(cause: ApiError): readonly E[] {
  const { errors } = cause.details as { errors?: unknown };
  return Array.isArray(errors) ? (errors as E[]) : [];
}

/**
 * Any failed request, in words — the one place a caught `unknown` becomes a sentence.
 *
 * Called at render, not when the failure happens: pages keep the cause in state, so an
 * alert already on screen switches language with everything around it rather than
 * staying half in the old one.
 *
 * Coded refusals get the UI's wording; one this UI has no sentence for still shows its
 * code. A failure with no code — the network, a 500 — shows what the browser or the
 * server said, which is the only detail there is.
 */
export function describeFailure(t: TFunction, cause: unknown): string {
  if (cause instanceof ApiError) {
    switch (cause.code) {
      case 'CATEGORY_IN_USE':
        return describeCategoryInUse(t, categoryUseOf(cause.details));
      case 'RULE_INVALID': {
        const sentences = Object.values(describeRuleErrors(t, fieldErrorsOf(cause)));
        if (sentences.length > 0) {
          return sentences.join(' · ');
        }
        break;
      }
      case 'BUDGET_INVALID': {
        const sentences = Object.values(describeBudgetErrors(t, fieldErrorsOf(cause)));
        if (sentences.length > 0) {
          return sentences.join(' · ');
        }
        break;
      }
    }
    if (isApiRefusalCode(cause.code)) {
      return t(`errors.api.${cause.code}`);
    }
    if (isKnownFileErrorCode(cause.code)) {
      return describeFileError(t, cause.code, cause.columns);
    }
    return t('errors.unknownApi', { code: cause.code });
  }
  const detail = cause instanceof Error ? cause.message : String(cause);
  return t('errors.requestFailed', { detail });
}

/**
 * A failed upload. Every code there is about the file, so an unknown one — csv-parse's
 * list is open-ended — reads as "file not readable (CODE)" rather than a refused request.
 */
export function describeImportFailure(t: TFunction, cause: unknown): string {
  return cause instanceof ApiError
    ? describeFileError(t, cause.code, cause.columns)
    : describeFailure(t, cause);
}
