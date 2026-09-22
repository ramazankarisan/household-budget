/**
 * The normalized transaction a bank CSV row becomes.
 *
 * Framework-free and browser-safe: no Node types, no `Date`, no bytes. `apps/web`
 * bundles this package, and `packages/core/tsconfig.json` sets `"types": []`, so
 * anything needing `TextDecoder` or `node:crypto` lives in `apps/api` instead.
 */

/**
 * Signed minor units. Branded so a euro amount cannot be passed where cents are
 * expected: `19.99 * 100` is `1998.9999999999998`, and no amount here is ever a float.
 */
export type Cents = number & { readonly __brand: 'Cents' };

/** Asserts at the one place integer cents are produced, so the brand stays honest. */
export function toCents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Cents must be a safe integer, received ${String(value)}`);
  }
  return value as Cents;
}

/**
 * Booking status. Sparkasse's `Info` column carries `Umsatz gebucht` / `Umsatz vorgemerkt`.
 * Pending rows are a replaceable snapshot, never deduplicated — they reappear booked with a
 * different `Buchungstag` and a rewritten `Verwendungszweck`.
 */
export type BookingStatus = 'booked' | 'pending';

/** Encoding a bank file was actually decoded with. Worth logging: format changes show up here. */
export type BankFileEncoding = 'utf-8' | 'windows-1252';

export interface TransactionSource {
  /** Only Sparkasse CSV-CAMT is in scope today; the union exists so adding one is additive. */
  readonly dialect: 'sparkasse-camt';
  readonly fileName: string;
  /** 1-based line in the source file. Embedded newlines are counted. */
  readonly lineNumber: number;
  readonly encoding: BankFileEncoding;
  /** The row verbatim, so a normalization change can re-key without a re-download. */
  readonly raw: Readonly<Record<string, string>>;
}

export interface Transaction {
  /**
   * Own account, IBAN, spaces stripped. Provenance and cross-checking only — the account an
   * import belongs to is chosen by the user before upload, never inferred from this.
   */
  readonly accountIban: string;
  /** Booking date, 'YYYY-MM-DD'. Primary date for budgeting. */
  readonly bookingDate: string;
  /** Value date, 'YYYY-MM-DD'. Stored, not used for grouping. */
  readonly valueDate?: string;
  /** Signed minor units. Negative is money out. */
  readonly amount: Cents;
  /** ISO 4217, normally 'EUR'. */
  readonly currency: string;
  readonly status: BookingStatus;

  /** Beguenstigter/Zahlungspflichtiger. */
  readonly counterpartyName?: string;
  readonly counterpartyIban?: string;
  readonly counterpartyBic?: string;

  /** Verwendungszweck. */
  readonly purpose?: string;
  /** Buchungstext — the bank's own transaction-type label. */
  readonly bookingText?: string;

  /** SEPA references. Present on direct debits, often empty. */
  readonly endToEndRef?: string;
  readonly mandateRef?: string;
  readonly creditorId?: string;

  /** Bank-assigned category, when the export carries one. Never trusted as a key. */
  readonly bankCategory?: string;

  /** Which file and line this came from. */
  readonly source: TransactionSource;
}
