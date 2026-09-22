/**
 * Value parsers for the German number and date formats a Sparkasse export uses.
 *
 * Both return `undefined` rather than a result object: each has exactly one failure
 * mode, so the caller in `parse.ts` already knows which `ImportErrorCode` to emit
 * (`AMOUNT_UNPARSEABLE` or `DATE_UNPARSEABLE`) and which field it was reading.
 */
import { type Cents, toCents } from './transaction.js';

/**
 * `-1.250,00` → -125000, `-42,17` → -4217, `12,3` → 1230, `-190` → -19000.
 *
 * The last two are Sparkasse's trailing-zero truncation, and they are why a parser that
 * assumes two decimals is wrong by a factor of ten. Thousands separators are accepted
 * although no real sample shows them — the regex costs nothing.
 */
const AMOUNT = /^(-?)(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/u;

/** Two-digit and four-digit years both occur, and they mix within a single row. */
const DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/u;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * Parses a German amount straight into integer cents. Never `parseFloat(x) * 100` —
 * that idiom is itself the bug: `Math.round(1.005 * 100)` is 100, not 101.
 *
 * @returns integer cents, or `undefined` if the string is not a German amount.
 */
export function parseGermanAmount(raw: string): Cents | undefined {
  const match = AMOUNT.exec(raw.trim());
  if (match === null) {
    return undefined;
  }

  const sign = match[1] ?? '';
  const euros = (match[2] ?? '').replaceAll('.', '');
  // '832,9' means 832,90 — pad on the right, never the left.
  const fraction = (match[3] ?? '').padEnd(2, '0');

  const magnitude = Number(`${euros}${fraction}`);
  if (!Number.isSafeInteger(magnitude)) {
    return undefined;
  }

  return toCents(sign === '-' ? -magnitude : magnitude);
}

export interface ParseGermanDateOptions {
  /**
   * The year two-digit dates are resolved against. Injected rather than read from a
   * clock, following `buildHelloPayload({ now })`, so this module stays pure.
   */
  readonly referenceYear: number;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Resolves `YY` against the reference year. `20YY` unless that lands more than one year
 * in the future, in which case `19YY` — a statement dated next year is a plausible
 * forward-value date; one dated eighty years ago is an old export.
 */
function resolveYear(digits: string, referenceYear: number): number {
  const value = Number(digits);
  if (digits.length === 4) {
    return value;
  }
  const thisCentury = 2000 + value;
  return thisCentury > referenceYear + 1 ? 1900 + value : thisCentury;
}

/**
 * `24.03.14` → `'2014-03-24'`, `01.04.2014` → `'2014-04-01'`.
 *
 * Returns a plain `'YYYY-MM-DD'` string, never a `Date`: a booking date has no time and
 * no zone, and a UTC midnight shifts a day backwards west of Greenwich, which is exactly
 * how transactions land in the wrong month. No `Date` is constructed even internally.
 *
 * @returns an ISO calendar date, or `undefined` if the string is not a real German date.
 */
export function parseGermanDate(
  raw: string,
  { referenceYear }: ParseGermanDateOptions,
): string | undefined {
  const match = DATE.exec(raw.trim());
  if (match === null) {
    return undefined;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = resolveYear(match[3] ?? '', referenceYear);

  if (month < 1 || month > 12) {
    return undefined;
  }

  const maxDay = month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  if (day < 1 || day > maxDay) {
    return undefined;
  }

  const paddedMonth = String(month).padStart(2, '0');
  const paddedDay = String(day).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${paddedMonth}-${paddedDay}`;
}
