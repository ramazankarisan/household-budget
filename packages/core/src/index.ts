export type { BuildHelloPayloadOptions, DbStatus, HelloPayload } from './hello.js';
export { buildHelloPayload, describeHello } from './hello.js';

/*
 * The CSV parser is deliberately absent: it pulls in csv-parse's Node build, which uses
 * `Buffer`. It lives behind the `@household-budget/core/csv` subpath, which only
 * `apps/api` imports. Everything exported here is browser-safe, because `apps/web`
 * bundles it.
 */
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
