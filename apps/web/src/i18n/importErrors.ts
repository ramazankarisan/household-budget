import { type ImportErrorCode, type RowError } from '@household-budget/core';

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
