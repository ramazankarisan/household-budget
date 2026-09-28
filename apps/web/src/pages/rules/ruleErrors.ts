import { type RuleInputError } from '@household-budget/core';

import { ApiError } from '../../api/client';

/** A rejection the API stated as `RULE_INVALID`, unpacked back into core's own errors. */
export function ruleErrorsOf(error: unknown): readonly RuleInputError[] {
  if (!(error instanceof ApiError) || error.code !== 'RULE_INVALID') {
    return [];
  }
  const { errors } = error.details as { errors?: unknown };
  return Array.isArray(errors) ? (errors as RuleInputError[]) : [];
}
