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
export type { ColumnMap } from './header.js';
export { findHeaderLine, mapColumns, normalizeHeaderToken, REQUIRED_COLUMNS } from './header.js';
export type { ParseSparkasseCsvContext, ParseSparkasseCsvResult } from './parse.js';
export { parseSparkasseCsv } from './parse.js';
