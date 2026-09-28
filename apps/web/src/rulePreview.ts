import {
  matchingRule,
  matchRule,
  type Rule,
  type RuleCondition,
  type RulePayload,
  type TransactionPayload,
} from '@household-budget/core';

/**
 * What a rule would do, counted live while it is written (plan 08, decision 11). Pure, over
 * rows already loaded — the same posture as `filter.ts`. The domain rules underneath
 * (`matchRule`, `matchingRule`) are core's, reused, not copied.
 */

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
