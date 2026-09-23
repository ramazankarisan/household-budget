/**
 * What a budget is, and what it takes to accept one from a form or a request.
 *
 * A budget is one limit for one category in one month, household-wide. There is no
 * inheritance and no copy-forward: a month nobody has budgeted is empty, which is the
 * only rule with a single state on screen.
 *
 * Validation lives here rather than in a Nest pipe for the reason `parseRuleInput` does —
 * both ends need it. The API rejects a bad body, the browser marks the bad field before
 * it sends one, and the wording stays `apps/web`'s in whichever language it is showing.
 */
import { isMonthKey } from './month.js';

export interface Budget {
  readonly categoryId: string;
  /** `'YYYY-MM'`. Text for the reason `bookingDate` is text. */
  readonly month: string;
  /** Positive integer cents. `0` is a real limit: "nothing may be spent here". */
  readonly amountCents: number;
}

/**
 * What a `PUT` supplies. Identical to a stored budget: the month and the category are
 * path segments rather than body fields, and the database owns nothing else worth
 * naming here.
 */
export type BudgetInput = Budget;

/**
 * One million euro. A limit no household types on purpose, and therefore the one a
 * misplaced decimal point trips over rather than storing silently.
 */
export const MAX_BUDGET_CENTS = 100_000_000;

export type BudgetInputErrorCode =
  | 'MONTH_INVALID'
  | 'CATEGORY_REQUIRED'
  | 'AMOUNT_NOT_AN_INTEGER'
  | 'AMOUNT_NEGATIVE'
  | 'AMOUNT_TOO_LARGE';

export interface BudgetInputError {
  readonly code: BudgetInputErrorCode;
  /** The form field this is about, so the UI can mark it. */
  readonly field: string;
}

export type ParseBudgetInputResult =
  | { readonly ok: true; readonly budget: BudgetInput }
  | { readonly ok: false; readonly errors: readonly BudgetInputError[] };

/**
 * Validates a budget and returns it typed, or **every** problem it has.
 *
 * Every problem rather than the first, the standard `parseRuleInput` set: a form that
 * marks one bad field per round trip is a form the user stops using after two.
 *
 * The three parts arrive together even though two of them are path segments on the wire,
 * because a month that is not a month and an amount that is not an amount are the same
 * kind of refusal and are worth reporting in one answer.
 */
export function parseBudgetInput(body: unknown): ParseBudgetInputResult {
  const errors: BudgetInputError[] = [];
  const source = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

  const month = source['month'];
  if (!isMonthKey(month)) {
    errors.push({ code: 'MONTH_INVALID', field: 'month' });
  }

  const categoryId = source['categoryId'];
  if (typeof categoryId !== 'string' || categoryId.trim() === '') {
    errors.push({ code: 'CATEGORY_REQUIRED', field: 'categoryId' });
  }

  const amountCents = source['amountCents'];
  if (typeof amountCents !== 'number' || !Number.isSafeInteger(amountCents)) {
    errors.push({ code: 'AMOUNT_NOT_AN_INTEGER', field: 'amountCents' });
  } else if (amountCents < 0) {
    // A limit is a magnitude. Negative would have to mean something, and nothing it
    // could mean is what a row reading `-700,00 €` in a Budget column looks like.
    errors.push({ code: 'AMOUNT_NEGATIVE', field: 'amountCents' });
  } else if (amountCents > MAX_BUDGET_CENTS) {
    errors.push({ code: 'AMOUNT_TOO_LARGE', field: 'amountCents' });
  }

  if (errors.length > 0 || !isMonthKey(month) || typeof categoryId !== 'string') {
    return { ok: false, errors };
  }

  return {
    ok: true,
    budget: { categoryId: categoryId.trim(), month, amountCents: amountCents as number },
  };
}
