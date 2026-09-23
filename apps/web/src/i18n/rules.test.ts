import { type RuleInputError, type RuleInputErrorCode } from '@household-budget/core';
import { describe, expect, it } from 'vitest';

import { type Locale } from './importErrors';
import { describeCategoryInUse, describeRuleError, describeRuleErrors, rulesText } from './rules';

const LOCALES: Locale[] = ['de', 'en'];

/** Walks the whole object, so a nested block of labels cannot go unchecked. */
function leaves(value: unknown, path = ''): { path: string; value: unknown }[] {
  if (typeof value !== 'object' || value === null) {
    return [{ path, value }];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, path === '' ? key : `${path}.${key}`),
  );
}

describe('rulesText', () => {
  it('has wording for every label in both languages', () => {
    // The assertion importErrors.test.ts makes, over an object rather than a code list:
    // this feature roughly doubles the app's user-facing text, and a missing key renders
    // as the word "undefined" in front of the user.
    for (const locale of LOCALES) {
      for (const { path, value } of leaves(rulesText(locale))) {
        expect(typeof value, path).toBe('string');
        expect(value as string, path).not.toBe('');
        expect(value as string, path).not.toContain('undefined');
      }
    }
  });

  it('defaults to German', () => {
    expect(rulesText().navRules).toBe('Regeln');
    expect(rulesText('en').navRules).toBe('Rules');
  });

  it('words every field and operator core can emit', () => {
    expect(rulesText().fields.counterpartyName).toBe('Empfänger');
    expect(rulesText().operators.contains).toBe('enthält');
    expect(rulesText('en').fields.counterpartyIban).toBe('IBAN');
  });
});

describe('describeRuleError', () => {
  const codes: RuleInputErrorCode[] = [
    'FIELD_UNKNOWN',
    'OPERATOR_UNKNOWN',
    'OPERATOR_NOT_ALLOWED_FOR_FIELD',
    'VALUE_EMPTY',
    'VALUE_TOO_LONG',
    'PRIORITY_NOT_AN_INTEGER',
    'CATEGORY_REQUIRED',
  ];

  it('has a sentence for every code core can emit', () => {
    for (const code of codes) {
      for (const locale of LOCALES) {
        const sentence = describeRuleError({ code, field: 'value' }, locale);
        expect(sentence, code).not.toBe('');
        expect(sentence, code).not.toContain('undefined');
      }
    }
  });

  it('says the same thing in English', () => {
    expect(describeRuleError({ code: 'VALUE_EMPTY', field: 'value' })).toBe('Suchbegriff fehlt');
    expect(describeRuleError({ code: 'VALUE_EMPTY', field: 'value' }, 'en')).toBe(
      'keyword is required',
    );
  });
});

describe('describeRuleErrors', () => {
  it('marks every bad field at once, keyed by the form field', () => {
    const errors: RuleInputError[] = [
      { code: 'VALUE_EMPTY', field: 'value' },
      { code: 'PRIORITY_NOT_AN_INTEGER', field: 'priority' },
    ];

    expect(describeRuleErrors(errors)).toEqual({
      value: 'Suchbegriff fehlt',
      priority: 'Priorität muss eine ganze Zahl sein',
    });
  });

  it('keeps the first sentence when one field has two problems', () => {
    expect(
      describeRuleErrors([
        { code: 'VALUE_EMPTY', field: 'value' },
        { code: 'VALUE_TOO_LONG', field: 'value' },
      ]),
    ).toEqual({ value: 'Suchbegriff fehlt' });
  });
});

describe('describeCategoryInUse', () => {
  it('names both counts, because they are the answer to "why not"', () => {
    expect(describeCategoryInUse(2, 47)).toBe('Wird noch verwendet: 2 Regeln, 47 Umsätze.');
    expect(describeCategoryInUse(2, 47, 'en')).toBe('Still in use: 2 rules, 47 transactions.');
  });
});
