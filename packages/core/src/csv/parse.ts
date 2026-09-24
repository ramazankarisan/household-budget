/**
 * Sparkasse CSV-CAMT text → `Transaction[]` plus a report of the rows that failed.
 *
 * This module is **not** exported from the package root. `csv-parse/sync` is the Node
 * build and uses `Buffer`; reaching it from `apps/web` would ship a broken bundle. It
 * is reachable only through the `@household-budget/core/csv` subpath, which only
 * `apps/api` imports — see `packages/core/src/csv/index.ts`.
 */
import { parse } from 'csv-parse/sync';

import { type RowError, CsvFileError, truncateErrorValue } from './errors.js';
import { parseGermanAmount, parseGermanDate } from './fields.js';
import { findHeaderLine, mapColumns } from './header.js';
import type { BankFileEncoding, BookingStatus, Transaction } from './transaction.js';

/** German column names, in one place, because they are the parser's entire contract. */
const COLUMN = {
  accountIban: 'Auftragskonto',
  bookingDate: 'Buchungstag',
  valueDate: 'Valutadatum',
  bookingText: 'Buchungstext',
  purpose: 'Verwendungszweck',
  creditorId: 'Glaeubiger ID',
  mandateRef: 'Mandatsreferenz',
  endToEndRef: 'Kundenreferenz (End-to-End)',
  counterpartyName: 'Beguenstigter/Zahlungspflichtiger',
  counterpartyIban: 'Kontonummer/IBAN',
  counterpartyBic: 'BIC (SWIFT-Code)',
  amount: 'Betrag',
  currency: 'Waehrung',
  status: 'Info',
  bankCategory: 'Kategorie',
} as const;

/**
 * The only two `Info` values attested in a V8 export. A third one fails loudly rather
 * than defaulting to `booked`: a silently booked pending row is a duplicate waiting to
 * happen, and a silently booked cancellation is money the user never spent.
 */
const STATUS_BY_INFO = new Map<string, BookingStatus>([
  ['Umsatz gebucht', 'booked'],
  ['Umsatz vorgemerkt', 'pending'],
]);

export interface ParseSparkasseCsvContext {
  /** Recorded on every transaction, so a row can be traced back to its download. */
  readonly fileName: string;
  /** The encoding the bytes were actually decoded with, decided in `apps/api`. */
  readonly encoding: BankFileEncoding;
  /** Resolves two-digit years. Injected, never read from a clock — see `fields.ts`. */
  readonly referenceYear: number;
}

export interface ParseSparkasseCsvResult {
  readonly transactions: readonly Transaction[];
  /** One entry per row that could not be understood. The other rows still import. */
  readonly errors: readonly RowError[];
}

/** What `raw: true` actually produces. csv-parse's own types still say `string[][]`. */
interface RawRecord {
  readonly record: readonly string[];
  readonly raw: string;
}

function countNewlines(text: string, from: number, to: number): number {
  let count = 0;
  for (let index = text.indexOf('\n', from); index !== -1 && index < to;) {
    count += 1;
    index = text.indexOf('\n', index + 1);
  }
  return count;
}

/**
 * csv-parse's own `info.lines` counts a CRLF inside a quoted field as two lines, so
 * every row after one is reported one line too high — and a real export is CRLF with
 * multi-line `Verwendungszweck` fields. Walking the source text with the verbatim
 * record text instead is exact, and independent of the library's bookkeeping.
 */
function lineNumbersFor(text: string, records: readonly RawRecord[]): number[] {
  const lineNumbers: number[] = [];
  let cursor = 0;
  let line = 1;

  for (const record of records) {
    // A record that follows a skipped empty line arrives with that line's leftover CR
    // glued to its front, and `\rDE89…` then matches nothing in the source text.
    const raw = record.raw.replace(/^[\r\n]+/u, '');
    const start = text.indexOf(raw, cursor);
    if (start === -1) {
      // Cannot happen: records are verbatim slices in file order. Degrade rather than
      // report a confidently wrong line.
      lineNumbers.push(line);
      continue;
    }
    line += countNewlines(text, cursor, start);
    lineNumbers.push(line);
    line += countNewlines(text, start, start + raw.length);
    cursor = start + raw.length;
  }

  return lineNumbers;
}

/** Trailing and leading whitespace is data in a `Verwendungszweck`; emptiness is not. */
function optional(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

interface RowOutcome {
  readonly transaction?: Transaction;
  readonly error?: RowError;
}

function mapRow(
  record: readonly string[],
  lineNumber: number,
  columns: ReadonlyMap<string, number>,
  headerLength: number,
  context: ParseSparkasseCsvContext,
): RowOutcome {
  const at = (column: string): string | undefined => {
    const index = columns.get(column);
    return index === undefined ? undefined : record[index];
  };
  const fail = (code: RowError['code'], field: string, value?: string): RowOutcome => ({
    error: {
      code,
      line: lineNumber,
      field,
      ...(value === undefined ? {} : { value: truncateErrorValue(value) }),
    },
  });

  // Unreachable while `relax_column_count` is false — csv-parse throws first — but a
  // ragged row should degrade to a reported row, never to silently shifted columns.
  if (record.length !== headerLength) {
    return fail('FIELD_COUNT_MISMATCH', COLUMN.accountIban, String(record.length));
  }

  const accountIban = at(COLUMN.accountIban)?.replaceAll(' ', '') ?? '';
  if (accountIban === '') {
    return fail('REQUIRED_FIELD_MISSING', COLUMN.accountIban);
  }

  const rawBookingDate = at(COLUMN.bookingDate) ?? '';
  if (rawBookingDate.trim() === '') {
    return fail('REQUIRED_FIELD_MISSING', COLUMN.bookingDate);
  }
  const bookingDate = parseGermanDate(rawBookingDate, context);
  if (bookingDate === undefined) {
    return fail('DATE_UNPARSEABLE', COLUMN.bookingDate, rawBookingDate);
  }

  const rawValueDate = optional(at(COLUMN.valueDate));
  const valueDate = rawValueDate === undefined ? undefined : parseGermanDate(rawValueDate, context);
  if (rawValueDate !== undefined && valueDate === undefined) {
    return fail('DATE_UNPARSEABLE', COLUMN.valueDate, rawValueDate);
  }

  const rawAmount = at(COLUMN.amount) ?? '';
  if (rawAmount.trim() === '') {
    return fail('REQUIRED_FIELD_MISSING', COLUMN.amount);
  }
  const amount = parseGermanAmount(rawAmount);
  if (amount === undefined) {
    return fail('AMOUNT_UNPARSEABLE', COLUMN.amount, rawAmount);
  }

  const currency = (at(COLUMN.currency) ?? '').trim();
  if (currency === '') {
    return fail('REQUIRED_FIELD_MISSING', COLUMN.currency);
  }

  const rawStatus = (at(COLUMN.status) ?? '').trim();
  const status = STATUS_BY_INFO.get(rawStatus);
  if (status === undefined) {
    return fail('STATUS_UNKNOWN', COLUMN.status, rawStatus);
  }

  const raw: Record<string, string> = {};
  for (const [name, index] of columns) {
    raw[name] = record[index] ?? '';
  }

  // `exactOptionalPropertyTypes` makes `{ purpose: undefined }` different from `{}`, and
  // `Transaction.purpose?: string` only accepts the second — hence the spreads.
  const counterpartyName = optional(at(COLUMN.counterpartyName));
  const counterpartyIban = optional(at(COLUMN.counterpartyIban)?.replaceAll(' ', ''));
  const counterpartyBic = optional(at(COLUMN.counterpartyBic));
  const purpose = optional(at(COLUMN.purpose));
  const bookingText = optional(at(COLUMN.bookingText));
  const endToEndRef = optional(at(COLUMN.endToEndRef));
  const mandateRef = optional(at(COLUMN.mandateRef));
  const creditorId = optional(at(COLUMN.creditorId));
  const bankCategory = optional(at(COLUMN.bankCategory));

  return {
    transaction: {
      accountIban,
      bookingDate,
      ...(valueDate === undefined ? {} : { valueDate }),
      amount,
      currency,
      status,
      ...(counterpartyName === undefined ? {} : { counterpartyName }),
      ...(counterpartyIban === undefined ? {} : { counterpartyIban }),
      ...(counterpartyBic === undefined ? {} : { counterpartyBic }),
      ...(purpose === undefined ? {} : { purpose }),
      ...(bookingText === undefined ? {} : { bookingText }),
      ...(endToEndRef === undefined ? {} : { endToEndRef }),
      ...(mandateRef === undefined ? {} : { mandateRef }),
      ...(creditorId === undefined ? {} : { creditorId }),
      ...(bankCategory === undefined ? {} : { bankCategory }),
      source: {
        dialect: 'sparkasse-camt',
        fileName: context.fileName,
        lineNumber,
        encoding: context.encoding,
        raw,
      },
    },
  };
}

/**
 * Parses a decoded Sparkasse CSV-CAMT export.
 *
 * @throws {CsvFileError} when the file has no recognisable header or is missing a
 * required column.
 * @throws {import('csv-parse').CsvError} when the CSV itself is malformed — an
 * unterminated quote or a ragged row. Silent corruption is the worst failure mode for
 * money, so a truncated download fails loudly instead of parsing to wrong numbers.
 */
export function parseSparkasseCsv(
  text: string,
  context: ParseSparkasseCsvContext,
): ParseSparkasseCsvResult {
  const headerLine = findHeaderLine(text);
  if (headerLine === undefined) {
    throw new CsvFileError('HEADER_NOT_FOUND');
  }

  const records = parse(text, {
    delimiter: ';',
    // TextDecoder already strips a UTF-8 BOM, but a file handed here as a string from
    // anywhere else may still carry one, and then the first column name is U+FEFF glued
    // to "Auftragskonto", which makes every row read as missing its own account number.
    bom: true,
    // Defaults to false, and a blank line would otherwise be a one-field record that
    // relax_column_count: false turns into a thrown CSV_RECORD_INCONSISTENT_FIELDS_LENGTH.
    skip_empty_lines: true,
    // Padding inside a Verwendungszweck is the bank's data, not noise.
    trim: false,
    relax_column_count: false,
    raw: true,
    from_line: headerLine,
    // csv-parse types the return as string[][] and does not model `raw: true`.
  }) as unknown as readonly RawRecord[];

  const [header, ...rows] = records;
  if (header === undefined) {
    throw new CsvFileError('HEADER_NOT_FOUND');
  }

  const { byName, missing } = mapColumns(header.record);
  if (missing.length > 0) {
    throw new CsvFileError('REQUIRED_COLUMN_MISSING', missing);
  }

  const lineNumbers = lineNumbersFor(text, records);
  const transactions: Transaction[] = [];
  const errors: RowError[] = [];

  rows.forEach((row, index) => {
    // +1 because lineNumbers still has the header at position 0.
    const lineNumber = lineNumbers[index + 1] ?? headerLine + index + 1;
    const { transaction, error } = mapRow(
      row.record,
      lineNumber,
      byName,
      header.record.length,
      context,
    );
    if (transaction !== undefined) {
      transactions.push(transaction);
    }
    if (error !== undefined) {
      errors.push(error);
    }
  });

  return { transactions, errors };
}
