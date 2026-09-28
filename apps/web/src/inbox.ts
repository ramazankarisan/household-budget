import {
  matchingRule,
  matchRule,
  normalize,
  type Rule,
  type RuleCondition,
  type RuleInput,
  type RulePayload,
  type TransactionPayload,
} from '@household-budget/core';

import { uncategorizedRows } from './filter';

/**
 * Sortieren's arithmetic (plan 08, decision 11): what to sort, what to suggest, and what a
 * rule would do. Pure, over rows already loaded — the same posture as `filter.ts`. The
 * domain rules underneath (`matchRule`, `matchingRule`) are core's, reused, not copied.
 */

/**
 * The rows to sort, newest first: what „Ohne Kategorie“ counts everywhere else
 * (`uncategorizedRows`), so the inbox empties exactly when the badge reaches zero.
 */
export function inboxRows(
  transactions: readonly TransactionPayload[],
  month: string,
): readonly TransactionPayload[] {
  return [...uncategorizedRows(transactions, { month })].sort(
    (a, b) => b.bookingDate.localeCompare(a.bookingDate) || a.id.localeCompare(b.id),
  );
}

/**
 * The category most often given to other rows with the same counterparty, or `undefined`
 * when none has one or two are tied. A hint the user confirms with one key — never
 * applied on its own.
 */
export function categoryHint(
  row: TransactionPayload,
  transactions: readonly TransactionPayload[],
): string | undefined {
  const name = normalize(row.counterpartyName);
  if (name === '') {
    return undefined;
  }
  const counts = new Map<string, number>();
  for (const other of transactions) {
    if (other.id === row.id || other.categoryId === null) {
      continue;
    }
    if (normalize(other.counterpartyName) === name) {
      counts.set(other.categoryId, (counts.get(other.categoryId) ?? 0) + 1);
    }
  }
  let best: string | undefined;
  let bestCount = 0;
  let tied = false;
  for (const [categoryId, count] of counts) {
    if (count > bestCount) {
      best = categoryId;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }
  return tied ? undefined : best;
}

/** A word worth matching on: at least three letters, so `S.A.` and `42` never are. */
const WORD = /\p{L}{3,}/u;

/**
 * The rule that would have caught this row: `Empfänger enthält <first real word>` → the
 * category just chosen. A first guess shown in an editor, with its reach counted live —
 * when `paypal` is too broad the count says so before anything is saved.
 *
 * No priority: the API appends a rule created without one (plan 08, decision 8).
 */
export function proposeRule(
  row: TransactionPayload,
  categoryId: string,
): Omit<RuleInput, 'priority'> {
  const name = normalize(row.counterpartyName);
  const word = name.split(' ').find((part) => WORD.test(part)) ?? name;
  return {
    field: 'counterpartyName',
    operator: 'contains',
    value: word,
    categoryId,
    active: true,
  };
}

export interface RulePreview {
  /** Rows the condition matches — booked and vorgemerkt, categorized or not. */
  readonly matches: number;
  /** Of those, how many have no category yet: what the rule would sort. */
  readonly uncategorized: number;
  /** Of those, how many were set by hand: a rule never touches them. */
  readonly locked: number;
  /** Of those, how many an earlier rule already wins: an appended rule never gets them. */
  readonly claimedEarlier: number;
  /** Up to three of the matching rows, for the eye. */
  readonly sample: readonly TransactionPayload[];
}

/**
 * What a rule would do if it were appended now. `rules` in the engine's order, as the API
 * lists them; only active ones compete for a row.
 */
export function previewRule(
  condition: RuleCondition,
  transactions: readonly TransactionPayload[],
  rules: readonly RulePayload[],
): RulePreview {
  // The API lists rules in engine order; `createdAt` only breaks ties the list has
  // already broken, so the payloads walk the same way as core's own `Rule`s.
  const ordered: readonly Rule[] = rules
    .filter((rule) => rule.active)
    .map((rule) => ({ ...rule, createdAt: '' }));
  const matching =
    condition.value.trim() === '' ? [] : transactions.filter((row) => matchRule(condition, row));
  return {
    matches: matching.length,
    uncategorized: matching.filter((row) => row.categoryId === null).length,
    locked: matching.filter((row) => row.categoryLockedAt !== null).length,
    claimedEarlier: matching.filter(
      (row) => row.categoryLockedAt === null && matchingRule(ordered, row) !== undefined,
    ).length,
    sample: matching.slice(0, 3),
  };
}
