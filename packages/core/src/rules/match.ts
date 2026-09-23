/**
 * The decision layer: which rule claims a transaction, and therefore which category it
 * gets.
 *
 * It runs in JavaScript over rows already loaded rather than as a `WHERE` clause, because
 * SQLite folds case for ASCII only: `LIKE '%müller%'` does not match `MÜLLER GmbH`, and
 * the generated Prisma `StringFilter` has no `mode` to escape with. German payee names
 * are the whole point of the feature. Measured at 50 000 rows × 20 rules: 21 ms to
 * normalize, 6 ms to match — the round trip dominates, not this.
 *
 * Living in `packages/core` is what lets the browser preview a rule and the server apply
 * it and both reach the same answer.
 */
import { normalize, normalizeIban } from './normalize.js';
import type { Rule, RuleField, RuleOperator } from './rule.js';

/**
 * The part of a transaction a rule can read. Both `Transaction` (optional fields, from
 * the parser) and `TransactionPayload` (nullable fields, from the API) satisfy it, which
 * is why nothing here imports either.
 */
export interface MatchableTransaction {
  readonly counterpartyName?: string | null;
  readonly purpose?: string | null;
  readonly counterpartyIban?: string | null;
}

/** Just enough of a rule to decide. A draft in a form is not a `Rule` yet and still matches. */
export type RuleCondition = Pick<Rule, 'field' | 'operator' | 'value'>;

function fieldValue(
  transaction: MatchableTransaction,
  field: RuleField,
): string | null | undefined {
  switch (field) {
    case 'counterpartyName':
      return transaction.counterpartyName;
    case 'purpose':
      return transaction.purpose;
    case 'counterpartyIban':
      return transaction.counterpartyIban;
  }
}

function applyOperator(haystack: string, operator: RuleOperator, needle: string): boolean {
  switch (operator) {
    case 'contains':
      return haystack.includes(needle);
    case 'startsWith':
      return haystack.startsWith(needle);
    case 'endsWith':
      return haystack.endsWith(needle);
    case 'equals':
      return haystack === needle;
  }
}

/**
 * Whether one rule claims one transaction.
 *
 * Both sides go through the same normalizer, so `müller` finds `MÜLLER GmbH`, the NFD
 * spelling of the same name, and the `Verwendungszweck` whose address sits behind a CRLF.
 * A field the bank left empty normalizes to `''` and matches nothing a form could store —
 * `parseRuleInput` rejects an empty value, so no stored rule has the needle that would.
 */
export function matchRule(rule: RuleCondition, transaction: MatchableTransaction): boolean {
  const raw = fieldValue(transaction, rule.field);
  const canonical = rule.field === 'counterpartyIban' ? normalizeIban : normalize;

  return applyOperator(canonical(raw), rule.operator, canonical(rule.value));
}

/**
 * The order rules are offered a transaction in: `priority` ascending, then `createdAt`,
 * then `id`.
 *
 * The tiebreak is explicit rather than left to the array's arrival order, because two
 * rules can carry the same integer priority and an apply has to produce the same result
 * on every run — the same standard `assignOccurrences` is held to. `id` is unique, so
 * this is a total order and no sort using it can depend on being stable.
 *
 * Exported because the rules list the user edits has to be in the same order as the one
 * the engine walks, and that list also shows the rules that are switched off.
 */
export function compareRules(left: Rule, right: Rule): number {
  return (
    left.priority - right.priority ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

/** The active rules, in {@link compareRules} order. What an apply actually walks. */
export function orderRules(rules: readonly Rule[]): readonly Rule[] {
  return rules.filter((rule) => rule.active).sort(compareRules);
}

/**
 * The category the first matching rule assigns, or `undefined` when none matches.
 *
 * First match wins, so the UI can say *which* rule decided. `ordered` is what
 * {@link orderRules} returned — passed in rather than sorted here, so a re-apply sorts
 * once for the whole database rather than once per row.
 */
export function categorize(
  ordered: readonly Rule[],
  transaction: MatchableTransaction,
): string | undefined {
  return ordered.find((rule) => matchRule(rule, transaction))?.categoryId;
}
