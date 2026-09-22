/**
 * Locating the header row and matching columns by name.
 *
 * Never a hard-coded skip count: Sparkasse's header is line 1, but other German banks
 * put 4 to 13 preamble lines in front of theirs and sources disagree on the legacy
 * counts. Scanning costs nothing now and is what makes a second dialect additive.
 *
 * Never an index, either: both a 17-column CSV-CAMT (ending at `Info`) and an
 * 18-column one (ending at `Kategorie`) exist, and one parser has to satisfy both.
 */

/** Columns without which a row cannot become a `Transaction`. `Kategorie` is not one. */
export const REQUIRED_COLUMNS = [
  'Auftragskonto',
  'Buchungstag',
  'Betrag',
  'Waehrung',
  'Info',
] as const;

/** Two tokens are enough to recognise a Sparkasse header and cheap to scan for. */
const HEADER_MARKERS = ['Auftragskonto', 'Betrag'] as const;

/** Far past any documented preamble (the longest is ING's 13 lines). */
const HEADER_SCAN_LINES = 30;

/**
 * Quoting varies between institutions and within a single header line, so strip it
 * before matching. Whitespace is collapsed because `"Betrag (€)"` and `"Betrag(€)"`
 * have both been reported for the same column.
 */
export function normalizeHeaderToken(token: string): string {
  const withoutBom = token.replace(/^\uFEFF/u, '').trim();
  const unquoted =
    withoutBom.length >= 2 && withoutBom.startsWith('"') && withoutBom.endsWith('"')
      ? withoutBom.slice(1, -1)
      : withoutBom;
  return unquoted.replace(/\s+/gu, ' ').trim();
}

/**
 * @returns the 1-based line the header sits on, or `undefined` if none of the first
 * {@link HEADER_SCAN_LINES} lines looks like one.
 */
export function findHeaderLine(text: string): number | undefined {
  const lines = text.split('\n');
  const limit = Math.min(lines.length, HEADER_SCAN_LINES);

  for (let index = 0; index < limit; index += 1) {
    const tokens = (lines[index] ?? '').split(';').map(normalizeHeaderToken);
    if (HEADER_MARKERS.every((marker) => tokens.includes(marker))) {
      return index + 1;
    }
  }
  return undefined;
}

export interface ColumnMap {
  /** Normalized column name to its position in the row. */
  readonly byName: ReadonlyMap<string, number>;
  /** Required columns the header does not carry. Empty means the file is usable. */
  readonly missing: readonly string[];
}

/** Builds the name → index map a row mapper reads through. */
export function mapColumns(headerTokens: readonly string[]): ColumnMap {
  const byName = new Map<string, number>();

  headerTokens.forEach((token, index) => {
    const name = normalizeHeaderToken(token);
    // First occurrence wins: a duplicated column name is the bank's problem, and
    // silently preferring the later one would change which value a row reports.
    if (name !== '' && !byName.has(name)) {
      byName.set(name, index);
    }
  });

  return {
    byName,
    missing: REQUIRED_COLUMNS.filter((name) => !byName.has(name)),
  };
}
