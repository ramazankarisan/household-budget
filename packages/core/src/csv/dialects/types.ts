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
  readonly bookingDate: string;
  readonly valueDate?: string;
  readonly amount: string;
  readonly currency: string;
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
   * Where the own account's IBAN comes from. Sparkasse repeats it on every row; Deutsche
   * Bank states it once, in a small `Konto;…;IBAN;Währung` table in the preamble, whose
   * next line holds the value. Provenance and a cross-check only — the account an import
   * lands in is the user's choice before upload, never inferred from this.
   */
  readonly accountIban:
    | { readonly from: 'column'; readonly column: string }
    | { readonly from: 'preamble'; readonly label: string };
  /**
   * The booking-status column and its values. A value not listed fails the row loudly
   * rather than defaulting to `booked`: a silently booked pending row is a duplicate
   * waiting to happen, and a silently booked cancellation is money the user never spent.
   *
   * Absent means the export has no pending concept and every row is booked — Deutsche
   * Bank says so in its own preamble.
   */
  readonly status?: {
    readonly column: string;
    readonly byValue: ReadonlyMap<string, BookingStatus>;
  };
  /**
   * First field of a closing summary line after the data (`Kontostand;30.9.2026;;;…`).
   * It has fewer fields than the header, which csv-parse would reject as a ragged file,
   * so it is dropped before parsing — only as the last non-blank line, never mid-file.
   */
  readonly footerMarker?: string;
  readonly delimiter: string;
  /**
   * For exports that never quote: a `"` inside a field is then a literal character, and
   * csv-parse must not read `Hotel "Nord" GmbH` as a malformed quoted field.
   */
  readonly relaxQuotes?: boolean;
  readonly parseAmount: (raw: string) => Cents | undefined;
  readonly parseDate: (raw: string, options: ParseGermanDateOptions) => string | undefined;
}
