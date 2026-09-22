/**
 * The shapes `apps/api` returns and `apps/web` renders.
 *
 * Declared once here for the same reason `HelloPayload` was: it is the contract
 * between the two, and a contract that lives in one of them is a contract only one of
 * them can change. Browser-safe — plain data, no `Date`, amounts in integer cents.
 */
import type { BankFileEncoding, BookingStatus } from './csv/transaction.js';
import type { RowError } from './csv/errors.js';

export interface AccountPayload {
  readonly id: string;
  readonly iban: string;
  readonly name: string;
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
  readonly purpose: string | null;
  readonly bookingText: string | null;
  readonly bankCategory: string | null;
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
  readonly failed: readonly RowError[];
  readonly encoding: BankFileEncoding;
  /** Set when this exact file was uploaded to this account before. */
  readonly duplicateOfBatchId?: string;
}
