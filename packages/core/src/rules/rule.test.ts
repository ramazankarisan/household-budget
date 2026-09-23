import { describe, expect, it } from 'vitest';

import { MAX_RULE_VALUE_LENGTH, parseRuleInput, type RuleInputErrorCode } from './rule.js';

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    field: 'counterpartyName',
    operator: 'contains',
    value: 'müller',
    priority: 10,
    categoryId: 'cat-wohnen',
    ...overrides,
  };
}

function codesOf(input: unknown): RuleInputErrorCode[] {
  const result = parseRuleInput(input);
  return result.ok ? [] : result.errors.map((error) => error.code);
}

describe('parseRuleInput', () => {
  it('accepts a well-formed rule', () => {
    const result = parseRuleInput(body());

    expect(result).toEqual({
      ok: true,
      rule: {
        field: 'counterpartyName',
        operator: 'contains',
        value: 'müller',
        priority: 10,
        categoryId: 'cat-wohnen',
        active: true,
      },
    });
  });

  it('defaults an omitted priority to the one the database would have used', () => {
    const result = parseRuleInput(body({ priority: undefined }));

    expect(result.ok && result.rule.priority).toBe(100);
  });

  it('strips the grouping spaces out of an IBAN before it can be stored', () => {
    // Otherwise the stored value and the one the next form submits look like two rules.
    const result = parseRuleInput(
      body({ field: 'counterpartyIban', operator: 'equals', value: 'DE89 3704 0044 0532 0130 00' }),
    );

    expect(result.ok && result.rule.value).toBe('de89370400440532013000');
  });

  it('refuses a substring match on an IBAN', () => {
    // An IBAN is an identifier: half of one is a different account.
    expect(codesOf(body({ field: 'counterpartyIban', operator: 'contains' }))).toEqual([
      'OPERATOR_NOT_ALLOWED_FOR_FIELD',
    ]);
  });

  it('rejects an empty keyword, including one that is only whitespace', () => {
    expect(codesOf(body({ value: '' }))).toEqual(['VALUE_EMPTY']);
    expect(codesOf(body({ value: '   ' }))).toEqual(['VALUE_EMPTY']);
    expect(codesOf(body({ value: 42 }))).toEqual(['VALUE_EMPTY']);
  });

  it('caps the keyword length', () => {
    expect(codesOf(body({ value: 'x'.repeat(MAX_RULE_VALUE_LENGTH) }))).toEqual([]);
    expect(codesOf(body({ value: 'x'.repeat(MAX_RULE_VALUE_LENGTH + 1) }))).toEqual([
      'VALUE_TOO_LONG',
    ]);
  });

  it('rejects a priority that is not an integer', () => {
    expect(codesOf(body({ priority: 1.5 }))).toEqual(['PRIORITY_NOT_AN_INTEGER']);
    expect(codesOf(body({ priority: '10' }))).toEqual(['PRIORITY_NOT_AN_INTEGER']);
  });

  it('rejects an unknown field and an unknown operator', () => {
    expect(codesOf(body({ field: 'amount' }))).toEqual(['FIELD_UNKNOWN']);
    expect(codesOf(body({ operator: 'matches' }))).toEqual(['OPERATOR_UNKNOWN']);
  });

  it('requires a category', () => {
    expect(codesOf(body({ categoryId: undefined }))).toEqual(['CATEGORY_REQUIRED']);
    expect(codesOf(body({ categoryId: '  ' }))).toEqual(['CATEGORY_REQUIRED']);
  });

  it('reports every problem at once, not the first', () => {
    // The form marks each bad field in one pass; a user fixing one per round trip gives up.
    expect(codesOf({ field: 'amount', value: '', priority: 1.5, categoryId: 'cat-1' })).toEqual([
      'FIELD_UNKNOWN',
      'OPERATOR_UNKNOWN',
      'VALUE_EMPTY',
      'PRIORITY_NOT_AN_INTEGER',
    ]);
  });

  it('names the form field each error belongs to', () => {
    const result = parseRuleInput(body({ value: '' }));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]?.field).toBe('value');
  });

  it('survives a body that is not an object at all', () => {
    expect(parseRuleInput(null).ok).toBe(false);
    expect(parseRuleInput('nonsense').ok).toBe(false);
    // Four, not five: an omitted priority is the database's default, not a mistake.
    expect(codesOf(undefined)).toEqual([
      'FIELD_UNKNOWN',
      'OPERATOR_UNKNOWN',
      'VALUE_EMPTY',
      'CATEGORY_REQUIRED',
    ]);
  });

  it('treats an omitted active flag as on', () => {
    const enabled = parseRuleInput(body({ active: undefined }));
    expect(enabled.ok && enabled.rule.active).toBe(true);

    const disabled = parseRuleInput(body({ active: false }));
    expect(disabled.ok && disabled.rule.active).toBe(false);
  });
});
