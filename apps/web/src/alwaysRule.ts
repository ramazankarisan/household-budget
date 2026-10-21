import {
  matchingRule,
  normalize,
  parseRuleInput,
  type RuleInput,
  type RulePayload,
  type TransactionPayload,
} from '@household-budget/core';

import { competingRules } from './rulePreview';

/** The rule „Immer so“ offers: the payee's name, contained, to the category just picked. */
export type AlwaysRule = Omit<RuleInput, 'priority'>;

/**
 * The rule worth offering after a category is set by hand on `row`, or `undefined` when
 * there is none (no category, no payee, a payee too long for a rule).
 *
 * Also `undefined` when the rule would change nothing:
 * - the same rule is already there, active or not (`RULE_EXISTS`) — a second copy only
 *   doubles a line on Regeln;
 * - an active rule already claims this row. If it gives the same category, the new rule is
 *   redundant; if another, the new one is appended after it and never wins this payee —
 *   first match wins (plan 08, decision 8) — and a rule that cannot win is not "immer so".
 *
 * `rules` in the engine's order, as the API lists them. Pure, over what is loaded — the
 * same posture as `rulePreview.ts`.
 */
export function alwaysRuleFor(
  row: TransactionPayload,
  categoryId: string | null,
  rules: readonly RulePayload[],
): AlwaysRule | undefined {
  if (categoryId === null || row.counterpartyName === null) {
    return undefined;
  }
  // The parser the API runs: it trims, and refuses an empty or over-long name here, not there.
  const parsed = parseRuleInput({
    field: 'counterpartyName',
    operator: 'contains',
    value: row.counterpartyName,
    categoryId,
    active: true,
  });
  if (!parsed.ok) {
    return undefined;
  }
  const { priority: _appended, ...rule } = parsed.rule;

  const exists = rules.some(
    (other) =>
      other.field === rule.field &&
      other.operator === rule.operator &&
      other.categoryId === rule.categoryId &&
      normalize(other.value) === normalize(rule.value),
  );
  if (exists || matchingRule(competingRules(rules), row) !== undefined) {
    return undefined;
  }
  return rule;
}
