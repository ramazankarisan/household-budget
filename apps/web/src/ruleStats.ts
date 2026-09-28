import {
  matchingRule,
  type Rule,
  type RulePayload,
  type TransactionPayload,
} from '@household-budget/core';

/**
 * How many rows each rule wins right now (plan 08, decision 12): for every row a rule may
 * touch — not set by hand — the first active rule that matches it, in the engine's order.
 * `matchRule` alone would count a row for every rule that matches it, when only the first
 * one ever assigns it.
 *
 * @param rules in the order the API lists them, which is the order the engine walks
 */
export function ruleWins(
  rules: readonly RulePayload[],
  transactions: readonly TransactionPayload[],
): ReadonlyMap<string, number> {
  // The list is already in engine order; `createdAt` only breaks ties it has broken.
  const ordered: readonly Rule[] = rules
    .filter((rule) => rule.active)
    .map((rule) => ({ ...rule, createdAt: '' }));
  const wins = new Map<string, number>();
  for (const row of transactions) {
    if (row.categoryLockedAt !== null) {
      continue;
    }
    const winner = matchingRule(ordered, row);
    if (winner !== undefined) {
      wins.set(winner.id, (wins.get(winner.id) ?? 0) + 1);
    }
  }
  return wins;
}
