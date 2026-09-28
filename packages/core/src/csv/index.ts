/**
 * The `@household-budget/core/csv` entry point: the CSV parser, and nothing else.
 *
 * It is separate from the package root on purpose. `csv-parse/sync` is csv-parse's
 * Node build and uses `Buffer`; a web bundle that reaches it references an undefined
 * global at runtime. `apps/web` imports the root entry — types, value parsers,
 * fingerprinting — and physically cannot pull this module in. `apps/api` imports this
 * one, where `Buffer` exists and the Node build is the right build.
 *
 * Verified: building `apps/web` with a forced reference to the root entry emits a
 * bundle with no `Buffer` reference.
 */
export type { DetectedDialect } from './dialects/index.js';
export { detectDialect, DIALECTS } from './dialects/index.js';
export { deutscheBank } from './dialects/deutsche-bank.js';
export { sparkasseCamt } from './dialects/sparkasse-camt.js';
export type { BankDialect, BankDialectId, ColumnBindings } from './dialects/types.js';
export type { ColumnMap } from './header.js';
export { findHeaderLine, mapColumns, normalizeHeaderToken } from './header.js';
export type { ParseBankCsvContext, ParseBankCsvResult } from './parse.js';
export { parseBankCsv } from './parse.js';
