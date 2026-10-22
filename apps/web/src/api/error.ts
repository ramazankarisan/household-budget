/**
 * A rejection the API stated as a machine code rather than a sentence. Nest returns the
 * object thrown with it — `{ code, columns }` — verbatim and adds no `message`, so the
 * code is what reaches the UI, and `src/locales` is what words it.
 */
export class ApiError extends Error {
  readonly code: string;
  /** The missing column names, for `REQUIRED_COLUMN_MISSING`. */
  readonly columns: readonly string[];
  /**
   * The rest of the object the API threw, verbatim. `CATEGORY_IN_USE` carries the three
   * counts that explain the refusal; `RULE_INVALID` carries one entry per bad form field.
   * Kept untyped here because this layer's job is to hand it on, not to interpret it.
   */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    columns: readonly string[] = [],
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(columns.length > 0 ? `${code}: ${columns.join(', ')}` : code);
    this.name = 'ApiError';
    this.code = code;
    this.columns = columns;
    this.details = details;
  }
}
