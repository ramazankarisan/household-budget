/**
 * The shapes `apps/api` returns and `apps/web` renders.
 *
 * Declared once here because it is the contract between the two, and a contract that
 * lives in one of them is a contract only one of them can change. Browser-safe — plain
 * data, no `Date`, amounts in integer cents.
 */
import type { BankFileEncoding, BookingStatus } from './csv/transaction.js';
import type { RowError } from './csv/errors.js';
import type { RuleField, RuleOperator } from './rules/rule.js';

export interface AccountPayload {
  readonly id: string;
  readonly iban: string;
  readonly name: string;
}

export interface CategoryPayload {
  readonly id: string;
  readonly name: string;
}

/**
 * A stored rule as the UI sees it. `createdAt` is absent on purpose: it exists to break
 * a priority tie, and the API has already applied it by the time a list arrives.
 */
export interface RulePayload {
  readonly id: string;
  readonly field: RuleField;
  readonly operator: RuleOperator;
  readonly value: string;
  readonly priority: number;
  readonly categoryId: string;
  readonly active: boolean;
}

/** What one run of the rules engine changed. */
export interface ApplySummary {
  /** Rows offered to the rules — every row not locked by hand, matched or not. */
  readonly evaluated: number;
  /** Rows given a category they did not already hold. A repeat apply reports 0. */
  readonly assigned: number;
  /** Rows whose category no rule claims any more, set back to none. */
  readonly cleared: number;
  /** Standing total of hand-set rows. Never loaded, never matched — only counted. */
  readonly locked: number;
}

/**
 * A limit for one category in one month. Household-wide, because `Category` is: a
 * per-account limit would need a per-account category to mean anything.
 */
export interface BudgetPayload {
  readonly categoryId: string;
  /** `'YYYY-MM'`. */
  readonly month: string;
  /** Positive integer cents. `0` is a real limit and means "nothing may be spent here". */
  readonly amountCents: number;
}

export interface TransactionPayload {
  readonly id: string;
  /** 'YYYY-MM-DD'. Formatted for display at the UI edge, never here. */
  readonly bookingDate: string;
  readonly valueDate: string | null;
  /** Signed integer cents. `Intl.NumberFormat` turns this into `-832,90 €`. */
  readonly amountCents: number;
  readonly currency: string;
  readonly status: BookingStatus;
  readonly counterpartyName: string | null;
  /** Carried so an IBAN rule is explainable on screen rather than only in the database. */
  readonly counterpartyIban: string | null;
  readonly purpose: string | null;
  readonly bookingText: string | null;
  readonly bankCategory: string | null;
  readonly categoryId: string | null;
  /**
   * ISO 8601 when a human set the category, `null` otherwise. Non-null is what the lock
   * on screen means, and what keeps the rules engine off this row.
   */
  readonly categoryLockedAt: string | null;
}

export interface ImportSummary {
  readonly batchId: string;
  /** Rows the parser understood, booked and pending together. */
  readonly parsed: number;
  readonly imported: number;
  /** Already stored and still live — the count that proves a re-import is a no-op. */
  readonly skipped: number;
  /** Soft-deleted rows the file brought back. */
  readonly restored: number;
  /** Pending rows replaced wholesale, because pending is a snapshot and not a ledger. */
  readonly pendingReplaced: number;
  /** Rows this import categorized on the way in, so no second step is needed. */
  readonly categorized: number;
  /** The first rows that failed, capped by the API; `failedCount` is the true total. */
  readonly failed: readonly RowError[];
  /** True total of failed rows; `failed` is capped. */
  readonly failedCount: number;
  readonly encoding: BankFileEncoding;
  /** Set when this exact file was uploaded to this account before. */
  readonly duplicateOfBatchId?: string;
}
