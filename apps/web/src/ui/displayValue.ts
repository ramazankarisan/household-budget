import { type RuleField } from '@household-budget/core';

/**
 * A rule's keyword as the user should read it. An IBAN is stored normalized — no spaces,
 * lower case, so matching never depends on how it was typed — and
 * `de89370400440532013000` is not how anyone reads one back. Upper-cased for the eye only.
 */
export function displayValue(rule: { readonly field: RuleField; readonly value: string }): string {
  return rule.field === 'counterpartyIban' ? rule.value.toUpperCase() : rule.value;
}
