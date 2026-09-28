/**
 * What a bank's CSV export is, as data. The parser in `../parse.ts` is one generic function
 * over this descriptor, so a new bank is a new descriptor rather than a new branch in it.
 *
 * Keep it declarative. The moment a dialect carries a `mapRow` callback, two banks can
 * disagree about what a required field is, and that shows up as a row error in production
 * rather than a type error at build time.
 */
import type { ParseGermanDateOptions } from '../fields.js';
import type { BankDialectId, BookingStatus, Cents } from '../transaction.js';

export type { BankDialectId } from '../transaction.js';

/** Semantic field → the column name this bank uses for it. Absent where the bank has none. */
export interface ColumnBindings {
  readonly accountIban: string;
  readonly bookingDate: string;
  readonly valueDate?: string;
  readonly amount: string;
  readonly currency: string;
  readonly status: string;
  readonly counterpartyName?: string;
  readonly counterpartyIban?: string;
  readonly counterpartyBic?: string;
  readonly purpose?: string;
  readonly bookingText?: string;
  readonly endToEndRef?: string;
  readonly mandateRef?: string;
  readonly creditorId?: string;
  readonly bankCategory?: string;
}

export interface BankDialect {
  readonly id: BankDialectId;
  /** Tokens that identify this bank's header line. Two is usually enough and cheap to scan for. */
  readonly headerMarkers: readonly string[];
  /** Columns without which a row cannot become a `Transaction`. Missing one is a file-level 4xx. */
  readonly requiredColumns: readonly string[];
  readonly columns: ColumnBindings;
  /**
   * Raw status value → `BookingStatus`. A value not listed fails the row loudly rather than
   * defaulting to `booked`: a silently booked pending row is a duplicate waiting to happen,
   * and a silently booked cancellation is money the user never spent.
   */
  readonly statusByValue: ReadonlyMap<string, BookingStatus>;
  readonly delimiter: string;
  readonly parseAmount: (raw: string) => Cents | undefined;
  readonly parseDate: (raw: string, options: ParseGermanDateOptions) => string | undefined;
}
