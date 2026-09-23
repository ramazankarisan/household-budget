/*
 * The CSV parser is deliberately absent: it pulls in csv-parse's Node build, which uses
 * `Buffer`. It lives behind the `@household-budget/core/csv` subpath, which only
 * `apps/api` imports. Everything exported here is browser-safe, because `apps/web`
 * bundles it.
 */
export type {
  AccountPayload,
  ApplySummary,
  BudgetPayload,
  CategoryPayload,
  ImportSummary,
  RulePayload,
  TransactionPayload,
} from './api.js';
export type {
  Budget,
  BudgetInput,
  BudgetInputError,
  BudgetInputErrorCode,
  ParseBudgetInputResult,
} from './budget/budget.js';
export { MAX_BUDGET_CENTS, parseBudgetInput } from './budget/budget.js';
export type { MonthKey } from './budget/month.js';
export { isMonthKey, monthOfDate } from './budget/month.js';
export type {
  CategoryReport,
  MonthlyReport,
  MonthlyReportRow,
  ReportableCategory,
} from './budget/report.js';
export { monthlyReport } from './budget/report.js';
export type { ImportErrorCode, ImportFileErrorCode, RowError } from './csv/errors.js';
export { CsvFileError } from './csv/errors.js';
export type { ParseGermanDateOptions } from './csv/fields.js';
export { parseGermanAmount, parseGermanDate } from './csv/fields.js';
export { assignOccurrences, dedupKeyInput, fingerprintInput } from './csv/fingerprint.js';
export type {
  BankFileEncoding,
  BookingStatus,
  Cents,
  Transaction,
  TransactionSource,
} from './csv/transaction.js';
export { toCents } from './csv/transaction.js';
export type { MatchableTransaction, RuleCondition } from './rules/match.js';
export { categorize, compareRules, matchingRule, matchRule, orderRules } from './rules/match.js';
export { normalize, normalizeIban } from './rules/normalize.js';
export type {
  ParseRuleInputResult,
  Rule,
  RuleField,
  RuleInput,
  RuleInputError,
  RuleInputErrorCode,
  RuleOperator,
} from './rules/rule.js';
export {
  DEFAULT_RULE_PRIORITY,
  MAX_RULE_VALUE_LENGTH,
  operatorsForField,
  parseRuleInput,
  RULE_FIELDS,
  RULE_OPERATORS,
} from './rules/rule.js';
