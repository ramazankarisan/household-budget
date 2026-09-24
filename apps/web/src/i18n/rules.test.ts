import { type RuleInputError, type RuleInputErrorCode } from '@household-budget/core';
import { describe, expect, it } from 'vitest';

import { type Locale } from './importErrors';
import {
  describeApplySummary,
  describeCategoryDeleted,
  describeCategoryInUse,
  describeRuleDeleted,
  describeRuleError,
  describeRuleErrors,
  rulesText,
} from './rules';

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
  it('names all three counts, because they are the answer to "why not"', () => {
    const use = { rules: 2, transactions: 47, budgets: 3 };

    expect(describeCategoryInUse(use)).toBe(
      'Wird noch verwendet: 2 Regeln, 47 Umsätze, 3 Budgets.',
    );
    expect(describeCategoryInUse(use, 'en')).toBe(
      'Still in use: 2 rules, 47 transactions, 3 budgets.',
    );
  });
});

describe('describeCategoryDeleted', () => {
  it('names the category that went, in both languages', () => {
    expect(describeCategoryDeleted('Wohnen')).toBe('„Wohnen“ gelöscht');
    expect(describeCategoryDeleted('Wohnen', 'en')).toBe('"Wohnen" deleted');
  });
});

describe('describeRuleDeleted', () => {
  it('names the rule by its search term, in both languages', () => {
    expect(describeRuleDeleted('müller')).toBe('Regel „müller“ gelöscht');
    expect(describeRuleDeleted('müller', 'en')).toBe('Rule "müller" deleted');
  });
});

describe('describeApplySummary', () => {
  const summary = { evaluated: 412, assigned: 318, cleared: 4, locked: 11 };

  it('states all four counts in both languages', () => {
    // This sentence was four literals inside RulesPage, which is how the English half
    // went missing while the test above still passed.
    expect(describeApplySummary(summary)).toBe(
      '412 geprüft · 318 zugeordnet · 4 gelöscht · 11 manuell',
    );
    expect(describeApplySummary(summary, 'en')).toBe(
      '412 checked · 318 assigned · 4 cleared · 11 set by hand',
    );
  });

  it('says zero rather than nothing when an apply changed nothing', () => {
    for (const locale of LOCALES) {
      const sentence = describeApplySummary(
        { evaluated: 0, assigned: 0, cleared: 0, locked: 0 },
        locale,
      );
      expect(sentence, locale).toContain('0');
      expect(sentence, locale).not.toContain('undefined');
    }
  });
});
