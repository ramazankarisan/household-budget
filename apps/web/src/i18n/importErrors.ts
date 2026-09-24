import {
  type ImportErrorCode,
  type ImportFileErrorCode,
  type RowError,
} from '@household-budget/core';

/**
 * Core returns machine codes; the wording lives here.
 *
 * That split is what lets the same import report read in German or English without the
 * parser knowing either language, and it is why a `RowError` carries a code, a line and
 * a field rather than a finished sentence.
 */
export type Locale = 'de' | 'en';

const MESSAGES: Record<Locale, Record<ImportErrorCode, string>> = {
  de: {
    AMOUNT_UNPARSEABLE: 'Betrag nicht lesbar',
    DATE_UNPARSEABLE: 'Datum nicht lesbar',
    STATUS_UNKNOWN: 'Unbekannter Umsatzstatus',
    REQUIRED_FIELD_MISSING: 'Pflichtfeld fehlt',
    FIELD_COUNT_MISMATCH: 'Zeile hat die falsche Spaltenzahl',
  },
  en: {
    AMOUNT_UNPARSEABLE: 'amount not parseable',
    DATE_UNPARSEABLE: 'date not parseable',
    STATUS_UNKNOWN: 'unknown transaction status',
    REQUIRED_FIELD_MISSING: 'required field missing',
    FIELD_COUNT_MISMATCH: 'row has the wrong number of columns',
  },
};

const LINE_LABEL: Record<Locale, string> = { de: 'Zeile', en: 'line' };

/** `Zeile 88: Betrag nicht lesbar — Betrag "12,3,4"` */
export function describeRowError(error: RowError, locale: Locale = 'de'): string {
  const head = `${LINE_LABEL[locale]} ${String(error.line)}: ${MESSAGES[locale][error.code]}`;
  if (error.field === undefined) {
    return head;
  }
  const value = error.value === undefined ? '' : ` "${error.value}"`;
  return `${head} — ${error.field}${value}`;
}

/**
 * A file that was rejected whole. Three sources of code: core's own
 * `ImportFileErrorCode`, the upload checks in the API's import controller, and the
 * `CSV_`-prefixed codes csv-parse raises for a structurally broken file. The last set is
 * open-ended, so an unknown one still reaches the user as its code rather than as silence.
 */
const FILE_MESSAGES: Record<
  Locale,
  Record<ImportFileErrorCode | KnownUploadErrorCode | KnownCsvErrorCode, string>
> = {
  de: {
    UNSUPPORTED_CONTENT_TYPE:
      'Dateityp nicht unterstützt — bitte den CSV-Export der Sparkasse hochladen',
    HEADER_NOT_FOUND: 'Keine Kopfzeile gefunden — ist das ein CSV-CAMT-Export der Sparkasse?',
    REQUIRED_COLUMN_MISSING: 'Pflichtspalte fehlt',
    CSV_QUOTE_NOT_CLOSED: 'Ein Anführungszeichen in der Datei wird nie geschlossen',
    CSV_INVALID_CLOSING_QUOTE: 'Ungültiges schließendes Anführungszeichen',
    CSV_RECORD_INCONSISTENT_FIELDS_LENGTH: 'Eine Zeile hat die falsche Spaltenzahl',
  },
  en: {
    UNSUPPORTED_CONTENT_TYPE: 'unsupported file type — upload the Sparkasse CSV export',
    HEADER_NOT_FOUND: 'no header row found — is this a Sparkasse CSV-CAMT export?',
    REQUIRED_COLUMN_MISSING: 'required column missing',
    CSV_QUOTE_NOT_CLOSED: 'a quoted value in the file is never closed',
    CSV_INVALID_CLOSING_QUOTE: 'invalid closing quote',
    CSV_RECORD_INCONSISTENT_FIELDS_LENGTH: 'a row has the wrong number of columns',
  },
};

/** Raised by the API before the parser sees the file, so not part of core's codes. */
type KnownUploadErrorCode = 'UNSUPPORTED_CONTENT_TYPE';

type KnownCsvErrorCode =
  'CSV_QUOTE_NOT_CLOSED' | 'CSV_INVALID_CLOSING_QUOTE' | 'CSV_RECORD_INCONSISTENT_FIELDS_LENGTH';

const UNKNOWN_FILE_ERROR: Record<Locale, (code: string) => string> = {
  de: (code) => `Datei nicht lesbar (${code})`,
  en: (code) => `file not readable (${code})`,
};

/** `Pflichtspalte fehlt: Betrag, Buchungstag` */
export function describeFileError(
  code: string,
  columns: readonly string[] = [],
  locale: Locale = 'de',
): string {
  const known = FILE_MESSAGES[locale] as Record<string, string | undefined>;
  const head = known[code] ?? UNKNOWN_FILE_ERROR[locale](code);
  return columns.length > 0 ? `${head}: ${columns.join(', ')}` : head;
}
