import { type RowError } from '@household-budget/core';
import { describe, expect, it } from 'vitest';

import { describeFileError, describeRowError } from './importErrors';

describe('describeRowError', () => {
  const error: RowError = {
    code: 'AMOUNT_UNPARSEABLE',
    line: 88,
    field: 'Betrag',
    value: '12,3,4',
  };

  it('names the line, the column and the offending value', () => {
    expect(describeRowError(error)).toBe('Zeile 88: Betrag nicht lesbar — Betrag "12,3,4"');
  });

  it('says the same thing in English', () => {
    // Core returns a code; both of these are the UI's wording, which is the point of
    // the split.
    expect(describeRowError(error, 'en')).toBe('line 88: amount not parseable — Betrag "12,3,4"');
  });

  it('drops the detail when the row error carries none', () => {
    expect(describeRowError({ code: 'REQUIRED_FIELD_MISSING', line: 12 })).toBe(
      'Zeile 12: Pflichtfeld fehlt',
    );
  });

  it('has wording for every code core can emit', () => {
    const codes: RowError['code'][] = [
      'AMOUNT_UNPARSEABLE',
      'DATE_UNPARSEABLE',
      'STATUS_UNKNOWN',
      'REQUIRED_FIELD_MISSING',
      'FIELD_COUNT_MISMATCH',
    ];

    for (const code of codes) {
      expect(describeRowError({ code, line: 1 })).not.toContain('undefined');
      expect(describeRowError({ code, line: 1 }, 'en')).not.toContain('undefined');
    }
  });
});

describe('describeFileError', () => {
  it('names the columns a rejected header is missing', () => {
    expect(describeFileError('REQUIRED_COLUMN_MISSING', ['Betrag', 'Buchungstag'])).toBe(
      'Pflichtspalte fehlt: Betrag, Buchungstag',
    );
  });

  it('words a csv-parse structural code', () => {
    expect(describeFileError('CSV_QUOTE_NOT_CLOSED')).toBe(
      'Ein Anführungszeichen in der Datei wird nie geschlossen',
    );
  });

  it('says the same thing in English', () => {
    expect(describeFileError('HEADER_NOT_FOUND', [], 'en')).toBe(
      'no header row found — is this a Sparkasse CSV-CAMT export?',
    );
  });

  it('still shows an unknown code rather than swallowing it', () => {
    // csv-parse's code list is open-ended, and a code the user can quote is worth more
    // than a generic "import failed".
    expect(describeFileError('CSV_SOMETHING_NEW')).toBe('Datei nicht lesbar (CSV_SOMETHING_NEW)');
  });
});
