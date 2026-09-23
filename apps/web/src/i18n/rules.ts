import {
  type RuleField,
  type RuleInputError,
  type RuleInputErrorCode,
  type RuleOperator,
} from '@household-budget/core';

import { type Locale } from './importErrors';

/**
 * Every string the rules UI shows, in both languages.
 *
 * The same posture `importErrors.ts` already has: German by default, English available
 * and tested, and no locale state anywhere — a `locale: Locale = 'de'` parameter is the
 * whole mechanism. A switcher is a feature this app has not asked for; wording that only
 * exists in one language is a bug waiting for the day it does.
 */
interface RulesText {
  readonly navTransactions: string;
  readonly navRules: string;
  readonly categoriesTitle: string;
  readonly categoryName: string;
  readonly addCategory: string;
  readonly deleteCategory: string;
  readonly noCategories: string;
  readonly rulesTitle: string;
  readonly applyRules: string;
  readonly applying: string;
  readonly addRule: string;
  readonly editRule: string;
  readonly saveRule: string;
  readonly cancel: string;
  readonly deleteRule: string;
  readonly noRules: string;
  readonly priority: string;
  readonly field: string;
  readonly operator: string;
  readonly value: string;
  readonly category: string;
  readonly active: string;
  readonly inactive: string;
  readonly uncategorized: string;
  readonly clearCategory: string;
  readonly lockedHint: string;
  readonly fields: Readonly<Record<RuleField, string>>;
  readonly operators: Readonly<Record<RuleOperator, string>>;
}

const TEXT: Record<Locale, RulesText> = {
  de: {
    navTransactions: 'Umsätze',
    navRules: 'Regeln',
    categoriesTitle: 'Kategorien',
    categoryName: 'Name',
    addCategory: 'Kategorie anlegen',
    deleteCategory: 'Kategorie löschen',
    noCategories: 'Noch keine Kategorien. Legen Sie eine an, bevor Sie eine Regel schreiben.',
    rulesTitle: 'Regeln',
    applyRules: 'Regeln anwenden',
    applying: 'Regeln laufen…',
    addRule: 'Regel anlegen',
    editRule: 'Regel bearbeiten',
    saveRule: 'Speichern',
    cancel: 'Abbrechen',
    deleteRule: 'Regel löschen',
    noRules: 'Noch keine Regeln.',
    priority: 'Priorität',
    field: 'Feld',
    operator: 'Operator',
    value: 'Suchbegriff',
    category: 'Kategorie',
    active: 'aktiv',
    inactive: 'inaktiv',
    uncategorized: 'Ohne Kategorie',
    clearCategory: 'Kategorie entfernen',
    lockedHint: 'von Hand gesetzt — Regeln ändern das nicht',
    fields: {
      counterpartyName: 'Empfänger',
      purpose: 'Zweck',
      counterpartyIban: 'IBAN',
    },
    operators: {
      contains: 'enthält',
      startsWith: 'beginnt mit',
      endsWith: 'endet mit',
      equals: 'ist',
    },
  },
  en: {
    navTransactions: 'Transactions',
    navRules: 'Rules',
    categoriesTitle: 'Categories',
    categoryName: 'Name',
    addCategory: 'Add category',
    deleteCategory: 'Delete category',
    noCategories: 'No categories yet. Add one before writing a rule.',
    rulesTitle: 'Rules',
    applyRules: 'Apply rules',
    applying: 'Applying…',
    addRule: 'Add rule',
    editRule: 'Edit rule',
    saveRule: 'Save',
    cancel: 'Cancel',
    deleteRule: 'Delete rule',
    noRules: 'No rules yet.',
    priority: 'Priority',
    field: 'Field',
    operator: 'Operator',
    value: 'Keyword',
    category: 'Category',
    active: 'active',
    inactive: 'inactive',
    uncategorized: 'Uncategorized',
    clearCategory: 'Remove category',
    lockedHint: 'set by hand — rules will not change it',
    fields: {
      counterpartyName: 'Payee',
      purpose: 'Purpose',
      counterpartyIban: 'IBAN',
    },
    operators: {
      contains: 'contains',
      startsWith: 'starts with',
      endsWith: 'ends with',
      equals: 'is',
    },
  },
};

export function rulesText(locale: Locale = 'de'): RulesText {
  return TEXT[locale];
}

const RULE_ERRORS: Record<Locale, Record<RuleInputErrorCode, string>> = {
  de: {
    FIELD_UNKNOWN: 'Unbekanntes Feld',
    OPERATOR_UNKNOWN: 'Unbekannter Operator',
    OPERATOR_NOT_ALLOWED_FOR_FIELD: 'Dieser Operator passt nicht zu diesem Feld',
    VALUE_EMPTY: 'Suchbegriff fehlt',
    VALUE_TOO_LONG: 'Suchbegriff ist zu lang',
    PRIORITY_NOT_AN_INTEGER: 'Priorität muss eine ganze Zahl sein',
    CATEGORY_REQUIRED: 'Kategorie fehlt',
  },
  en: {
    FIELD_UNKNOWN: 'unknown field',
    OPERATOR_UNKNOWN: 'unknown operator',
    OPERATOR_NOT_ALLOWED_FOR_FIELD: 'this operator does not apply to this field',
    VALUE_EMPTY: 'keyword is required',
    VALUE_TOO_LONG: 'keyword is too long',
    PRIORITY_NOT_AN_INTEGER: 'priority must be a whole number',
    CATEGORY_REQUIRED: 'category is required',
  },
};

/** One sentence per rejected field, in the order core reported them. */
export function describeRuleError(error: RuleInputError, locale: Locale = 'de'): string {
  return RULE_ERRORS[locale][error.code];
}

/** `{ value: 'Suchbegriff fehlt' }` — what a form marks each field with. */
export function describeRuleErrors(
  errors: readonly RuleInputError[],
  locale: Locale = 'de',
): Readonly<Record<string, string>> {
  const marked: Record<string, string> = {};
  for (const error of errors) {
    marked[error.field] ??= describeRuleError(error, locale);
  }
  return marked;
}

const CATEGORY_IN_USE: Record<Locale, (rules: number, transactions: number) => string> = {
  de: (rules, transactions) =>
    `Wird noch verwendet: ${String(rules)} Regeln, ${String(transactions)} Umsätze.`,
  en: (rules, transactions) =>
    `Still in use: ${String(rules)} rules, ${String(transactions)} transactions.`,
};

/** The refusal that deleting a category in use earns, with the counts that explain it. */
export function describeCategoryInUse(
  rules: number,
  transactions: number,
  locale: Locale = 'de',
): string {
  return CATEGORY_IN_USE[locale](rules, transactions);
}
