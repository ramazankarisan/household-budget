/**
 * Import errors are machine codes plus structured data, never pre-formatted sentences.
 * The UI owns the wording, in German and in English — core only says what went wrong
 * and where.
 */
export type ImportErrorCode =
  | 'AMOUNT_UNPARSEABLE'
  | 'DATE_UNPARSEABLE'
  | 'STATUS_UNKNOWN'
  | 'REQUIRED_FIELD_MISSING'
  | 'FIELD_COUNT_MISMATCH';

/**
 * A single bad row. Row failures are reported and the rest of the file is imported:
 * a user cannot hand-edit a bank export, so rejecting the whole file leaves them stuck.
 */
export interface RowError {
  readonly code: ImportErrorCode;
  /** 1-based line in the source file. */
  readonly line: number;
  /** German column name, as it appears in the export's header. */
  readonly field?: string;
  /** The offending raw value. Never a whole row — that is the user's spending history. */
  readonly value?: string;
}

/** A file that cannot be read at all, as opposed to a row that cannot be understood. */
export type ImportFileErrorCode = 'HEADER_NOT_FOUND' | 'REQUIRED_COLUMN_MISSING';

/**
 * Thrown rather than returned. Row failures degrade — the good rows still import —
 * but a file with no recognisable header has no good rows to salvage, so the whole
 * request fails, and `apps/api` turns this into a 4xx rather than a 500.
 */
export class CsvFileError extends Error {
  readonly code: ImportFileErrorCode;
  /** The missing column names, for `REQUIRED_COLUMN_MISSING`. */
  readonly columns: readonly string[];

  constructor(code: ImportFileErrorCode, columns: readonly string[] = []) {
    super(columns.length > 0 ? `${code}: ${columns.join(', ')}` : code);
    this.name = 'CsvFileError';
    this.code = code;
    this.columns = columns;
  }
}
