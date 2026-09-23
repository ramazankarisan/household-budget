/**
 * What a categorization rule is, and what it takes to accept one from a form.
 *
 * A rule is one condition — field, operator, value — pointing at a category. Combining
 * conditions is done by writing two rules: that keeps the stored shape flat, the UI one
 * row per rule, and leaves a `RuleCondition` table available later without invalidating
 * anything already stored.
 *
 * Validation lives here rather than in a Nest pipe because both ends need it: the API
 * rejects a bad body, and the browser marks the bad field before it ever sends one. It
 * returns codes rather than sentences for the same reason `csv/errors.ts` does — the
 * wording is `apps/web`'s, in whichever language it is showing.
 */
import { normalizeIban } from './normalize.js';

export type RuleField = 'counterpartyName' | 'purpose' | 'counterpartyIban';
export type RuleOperator = 'contains' | 'startsWith' | 'endsWith' | 'equals';

export const RULE_FIELDS: readonly RuleField[] = [
  'counterpartyName',
  'purpose',
  'counterpartyIban',
];
export const RULE_OPERATORS: readonly RuleOperator[] = [
  'contains',
  'startsWith',
  'endsWith',
  'equals',
];

/**
 * An IBAN is an identifier, not prose: a rule that matches half of one is a rule that
 * matches the wrong account.
 */
const OPERATORS_BY_FIELD: Readonly<Record<RuleField, readonly RuleOperator[]>> = {
  counterpartyName: RULE_OPERATORS,
  purpose: RULE_OPERATORS,
  counterpartyIban: ['equals'],
};

/** Long enough for any payee name, short enough that the column is not a text dump. */
export const MAX_RULE_VALUE_LENGTH = 200;

/** Matches the Prisma default, so an omitted priority means the same thing on both ends. */
export const DEFAULT_RULE_PRIORITY = 100;

export type RuleInputErrorCode =
  | 'FIELD_UNKNOWN'
  | 'OPERATOR_UNKNOWN'
  | 'OPERATOR_NOT_ALLOWED_FOR_FIELD'
  | 'VALUE_EMPTY'
  | 'VALUE_TOO_LONG'
  | 'PRIORITY_NOT_AN_INTEGER'
  | 'CATEGORY_REQUIRED';

export interface RuleInputError {
  readonly code: RuleInputErrorCode;
  /** The form field this is about, so the UI can mark it. */
  readonly field: string;
}

export interface Rule {
  readonly id: string;
  readonly field: RuleField;
  readonly operator: RuleOperator;
  readonly value: string;
  /** Lower runs first. See {@link orderRules} for how ties are broken. */
  readonly priority: number;
  readonly categoryId: string;
  readonly active: boolean;
  /** ISO 8601, for the tiebreak. A string, not a `Date`: core has no `Date` to spare. */
  readonly createdAt: string;
}

/**
 * What a create or update supplies: a `Rule` without the fields the database owns.
 * `active` is here because the form can toggle it; `id` and `createdAt` never are.
 */
export type RuleInput = Omit<Rule, 'id' | 'createdAt'>;

export type ParseRuleInputResult =
  | { readonly ok: true; readonly rule: RuleInput }
  | { readonly ok: false; readonly errors: readonly RuleInputError[] };

function isRuleField(value: unknown): value is RuleField {
  return typeof value === 'string' && (RULE_FIELDS as readonly string[]).includes(value);
}

function isRuleOperator(value: unknown): value is RuleOperator {
  return typeof value === 'string' && (RULE_OPERATORS as readonly string[]).includes(value);
}

/**
 * Validates a rule body and returns it typed, or **every** problem it has.
 *
 * Every problem rather than the first: the form marks each bad field at once, and a user
 * who fixes one thing per round trip stops after two.
 */
export function parseRuleInput(body: unknown): ParseRuleInputResult {
  const errors: RuleInputError[] = [];
  const source = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

  const field = source['field'];
  if (!isRuleField(field)) {
    errors.push({ code: 'FIELD_UNKNOWN', field: 'field' });
  }

  const operator = source['operator'];
  if (!isRuleOperator(operator)) {
    errors.push({ code: 'OPERATOR_UNKNOWN', field: 'operator' });
  } else if (isRuleField(field) && !OPERATORS_BY_FIELD[field].includes(operator)) {
    errors.push({ code: 'OPERATOR_NOT_ALLOWED_FOR_FIELD', field: 'operator' });
  }

  const rawValue = source['value'];
  const trimmed = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (trimmed === '') {
    errors.push({ code: 'VALUE_EMPTY', field: 'value' });
  } else if (trimmed.length > MAX_RULE_VALUE_LENGTH) {
    errors.push({ code: 'VALUE_TOO_LONG', field: 'value' });
  }

  const rawPriority = source['priority'];
  const priority = rawPriority === undefined ? DEFAULT_RULE_PRIORITY : rawPriority;
  if (typeof priority !== 'number' || !Number.isSafeInteger(priority)) {
    errors.push({ code: 'PRIORITY_NOT_AN_INTEGER', field: 'priority' });
  }

  const categoryId = source['categoryId'];
  if (typeof categoryId !== 'string' || categoryId.trim() === '') {
    errors.push({ code: 'CATEGORY_REQUIRED', field: 'categoryId' });
  }

  if (errors.length > 0 || !isRuleField(field) || !isRuleOperator(operator)) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    rule: {
      field,
      operator,
      // Normalized here so grouping spaces never reach the database: the stored value is
      // what the UI echoes back, and `DE89 3704…` stored raw would look unlike the rule
      // that matched.
      value: field === 'counterpartyIban' ? normalizeIban(trimmed) : trimmed,
      priority: priority as number,
      categoryId: (categoryId as string).trim(),
      // Absent means on. A rule the form did not mention is a rule the user wants.
      active: source['active'] === undefined ? true : source['active'] === true,
    },
  };
}
