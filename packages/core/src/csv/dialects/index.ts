/**
 * The dialect registry, and detection by header.
 *
 * Detection beats asking the user which bank a file is from: the header is in the file,
 * the user's answer can be wrong, and a wrong answer parses a real file into wrong
 * numbers instead of failing.
 */
import { HEADER_SCAN_LINES, isHeaderLine } from '../header.js';
import { deutscheBank } from './deutsche-bank.js';
import { sparkasseCamt } from './sparkasse-camt.js';
import type { BankDialect } from './types.js';

export const DIALECTS: readonly BankDialect[] = [sparkasseCamt, deutscheBank];

export interface DetectedDialect {
  readonly dialect: BankDialect;
  /** 1-based line the header sits on. */
  readonly headerLine: number;
}

/**
 * The first of the first {@link HEADER_SCAN_LINES} lines that some dialect recognises
 * decides. Where several recognise it, the one with the most markers wins, so a specific
 * dialect beats a generic one.
 *
 * @returns `undefined` when no line looks like any registered header — the caller's
 * `HEADER_NOT_FOUND`.
 * @throws {Error} when two dialects tie on one line. That is a registry bug, and picking
 * by array order would make behaviour depend on the order entries were added in.
 */
export function detectDialect(
  text: string,
  dialects: readonly BankDialect[] = DIALECTS,
): DetectedDialect | undefined {
  const lines = text.split('\n').slice(0, HEADER_SCAN_LINES);

  for (const [index, line] of lines.entries()) {
    const matches = dialects.filter((dialect) =>
      isHeaderLine(line, dialect.headerMarkers, dialect.delimiter),
    );
    if (matches.length === 0) {
      continue;
    }
    const most = Math.max(...matches.map((dialect) => dialect.headerMarkers.length));
    const [winner, ...tied] = matches.filter((dialect) => dialect.headerMarkers.length === most);
    if (winner === undefined || tied.length > 0) {
      const ids = matches.map((dialect) => dialect.id).join(', ');
      throw new Error(`Ambiguous bank dialects on line ${String(index + 1)}: ${ids}`);
    }
    return { dialect: winner, headerLine: index + 1 };
  }
  return undefined;
}
