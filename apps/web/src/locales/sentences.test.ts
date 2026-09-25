import {
  type BudgetInputErrorCode,
  type MonthlyReport,
  type RowError,
  type RuleInputError,
  type RuleInputErrorCode,
} from '@household-budget/core';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../api/client';
import i18n from './i18n';
import {
  describeApplySummary,
  describeBudgetError,
  describeBudgetErrors,
  describeCategoryDeleted,
  describeCategoryInUse,
  describeFailure,
  describeFileError,
  describeImportFailure,
  describeLeft,
  describeMonthTotal,
  describeOverBy,
  describeRemaining,
  describeRowError,
  describeRuleDeleted,
  describeRuleError,
  describeRuleErrors,
  describeUncategorized,
} from './sentences';

const de = i18n.getFixedT('de');
const en = i18n.getFixedT('en');
const BOTH = [de, en];

/** `Intl` puts U+00A0 between the amount and the €; the assertions read better without it. */
const plain = (text: string): string => text.replaceAll('\u00a0', ' ');

describe('describeUncategorized', () => {
  it('states the count in both languages', () => {
    expect(describeUncategorized(de, 7)).toBe('7 ohne Kategorie');
    expect(describeUncategorized(en, 7)).toBe('7 uncategorized');
  });

  it('says the work is done rather than counting zero', () => {
    // "0 ohne Kategorie" is a number to read; "Alle kategorisiert" is an answer.
    expect(describeUncategorized(de, 0)).toBe('Alle kategorisiert');
    expect(describeUncategorized(en, 0)).toBe('All categorized');
    for (const t of BOTH) {
      expect(describeUncategorized(t, 0)).not.toContain('0');
      expect(describeUncategorized(t, 1)).not.toContain('undefined');
    }
  });
});

describe('describeRowError', () => {
  const error: RowError = {
    code: 'AMOUNT_UNPARSEABLE',
    line: 88,
    field: 'Betrag',
    value: '12,3,4',
  };

  it('names the line, the column and the offending value', () => {
    expect(describeRowError(de, error)).toBe('Zeile 88: Betrag nicht lesbar — Betrag "12,3,4"');
  });

  it('says the same thing in English', () => {
    // Core returns a code; both of these are the UI's wording, which is the point of
    // the split.
    expect(describeRowError(en, error)).toBe('line 88: amount not parseable — Betrag "12,3,4"');
  });

  it('drops the detail when the row error carries none', () => {
    expect(describeRowError(de, { code: 'REQUIRED_FIELD_MISSING', line: 12 })).toBe(
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
      for (const t of BOTH) {
        expect(describeRowError(t, { code, line: 1 })).not.toContain('undefined');
        expect(describeRowError(t, { code, line: 1 })).not.toContain('errors.');
      }
    }
  });
});

describe('describeFileError', () => {
  it('names the columns a rejected header is missing', () => {
    expect(describeFileError(de, 'REQUIRED_COLUMN_MISSING', ['Betrag', 'Buchungstag'])).toBe(
      'Pflichtspalte fehlt: Betrag, Buchungstag',
    );
  });

  it('words a csv-parse structural code', () => {
    expect(describeFileError(de, 'CSV_QUOTE_NOT_CLOSED')).toBe(
      'Ein Anführungszeichen in der Datei wird nie geschlossen',
    );
  });

  it('says the same thing in English', () => {
    expect(describeFileError(en, 'HEADER_NOT_FOUND', [])).toBe(
      'no header row found — is this a Sparkasse CSV-CAMT export?',
    );
  });

  it('words the upload check that turns away a non-CSV file, in both languages', () => {
    expect(describeFileError(de, 'UNSUPPORTED_CONTENT_TYPE')).toBe(
      'Dateityp nicht unterstützt — bitte den CSV-Export der Sparkasse hochladen',
    );
    expect(describeFileError(en, 'UNSUPPORTED_CONTENT_TYPE', [])).toBe(
      'unsupported file type — upload the Sparkasse CSV export',
    );
  });

  it('still shows an unknown code rather than swallowing it', () => {
    // csv-parse's code list is open-ended, and a code the user can quote is worth more
    // than a generic "import failed".
    expect(describeFileError(de, 'CSV_SOMETHING_NEW')).toBe(
      'Datei nicht lesbar (CSV_SOMETHING_NEW)',
    );
    expect(describeFileError(en, 'CSV_SOMETHING_NEW')).toBe(
      'file not readable (CSV_SOMETHING_NEW)',
    );
  });

  it('does not take an inherited property for a known code', () => {
    expect(describeFileError(de, 'toString')).toBe('Datei nicht lesbar (toString)');
  });
});

describe('describeRuleError', () => {
  const codes: RuleInputErrorCode[] = [
    'FIELD_UNKNOWN',
    'OPERATOR_UNKNOWN',
    'OPERATOR_NOT_ALLOWED_FOR_FIELD',
    'VALUE_EMPTY',
    'VALUE_TOO_LONG',
    'PRIORITY_NOT_AN_INTEGER',
    'CATEGORY_REQUIRED',
  ];

  it('has a sentence for every code core can emit', () => {
    for (const code of codes) {
      for (const t of BOTH) {
        const sentence = describeRuleError(t, { code, field: 'value' });
        expect(sentence, code).not.toBe('');
        expect(sentence, code).not.toContain('undefined');
        expect(sentence, code).not.toContain('errors.');
      }
    }
  });

  it('says the same thing in English', () => {
    expect(describeRuleError(de, { code: 'VALUE_EMPTY', field: 'value' })).toBe(
      'Suchbegriff fehlt',
    );
    expect(describeRuleError(en, { code: 'VALUE_EMPTY', field: 'value' })).toBe(
      'keyword is required',
    );
  });
});

describe('describeRuleErrors', () => {
  it('marks every bad field at once, keyed by the form field', () => {
    const errors: RuleInputError[] = [
      { code: 'VALUE_EMPTY', field: 'value' },
      { code: 'PRIORITY_NOT_AN_INTEGER', field: 'priority' },
    ];

    expect(describeRuleErrors(de, errors)).toEqual({
      value: 'Suchbegriff fehlt',
      priority: 'Priorität muss eine ganze Zahl sein',
    });
  });

  it('keeps the first sentence when one field has two problems', () => {
    expect(
      describeRuleErrors(de, [
        { code: 'VALUE_EMPTY', field: 'value' },
        { code: 'VALUE_TOO_LONG', field: 'value' },
      ]),
    ).toEqual({ value: 'Suchbegriff fehlt' });
  });
});

describe('describeCategoryInUse', () => {
  it('names all three counts, because they are the answer to "why not"', () => {
    const use = { rules: 2, transactions: 47, budgets: 3 };

    expect(describeCategoryInUse(de, use)).toBe(
      'Wird noch verwendet: 2 Regeln, 47 Umsätze, 3 Budgets.',
    );
    expect(describeCategoryInUse(en, use)).toBe(
      'Still in use: 2 rules, 47 transactions, 3 budgets.',
    );
  });
});

describe('describeCategoryDeleted', () => {
  it('names the category that went, in both languages', () => {
    expect(describeCategoryDeleted(de, 'Wohnen')).toBe('„Wohnen“ gelöscht');
    expect(describeCategoryDeleted(en, 'Wohnen')).toBe('"Wohnen" deleted');
  });

  it('prints a name as typed, not HTML-escaped', () => {
    // React escapes; i18next escaping as well would show `&lt;` on screen.
    expect(describeCategoryDeleted(de, 'Kind & Kegel <3')).toBe('„Kind & Kegel <3“ gelöscht');
  });
});

describe('describeRuleDeleted', () => {
  it('names the rule by its search term, in both languages', () => {
    expect(describeRuleDeleted(de, 'müller')).toBe('Regel „müller“ gelöscht');
    expect(describeRuleDeleted(en, 'müller')).toBe('Rule "müller" deleted');
  });
});

describe('describeApplySummary', () => {
  const summary = { evaluated: 412, assigned: 318, cleared: 4, locked: 11 };

  it('states all four counts in both languages', () => {
    expect(describeApplySummary(de, summary)).toBe(
      '412 geprüft · 318 zugeordnet · 4 gelöscht · 11 manuell',
    );
    expect(describeApplySummary(en, summary)).toBe(
      '412 checked · 318 assigned · 4 cleared · 11 set by hand',
    );
  });

  it('says zero rather than nothing when an apply changed nothing', () => {
    for (const t of BOTH) {
      const sentence = describeApplySummary(t, {
        evaluated: 0,
        assigned: 0,
        cleared: 0,
        locked: 0,
      });
      expect(sentence).toContain('0');
      expect(sentence).not.toContain('undefined');
    }
  });
});

function report(overrides: Partial<MonthlyReport> = {}): MonthlyReport {
  return {
    month: '2025-09',
    categories: [],
    totalBookedCents: 238574,
    totalPendingCents: 0,
    totalBudgetCents: 70000,
    ...overrides,
  };
}

describe('describeRemaining', () => {
  it('says over, with the amount as a magnitude', () => {
    expect(plain(describeRemaining(de, -17507))).toBe('175,07 € über');
    expect(plain(describeRemaining(en, -17507))).toBe('175,07 € over');
    expect(plain(describeOverBy(de, 17507))).toBe('175,07 € über');
  });

  it('says left, including exactly at the limit', () => {
    expect(plain(describeRemaining(de, 40000))).toBe('400,00 € übrig');
    expect(plain(describeRemaining(de, 0))).toBe('0,00 € übrig');
    expect(plain(describeLeft(en, 40000))).toBe('400,00 € left');
  });

  it('shows a dash when there is nothing to compare against', () => {
    expect(describeRemaining(de, null)).toBe('—');
  });
});

describe('describeMonthTotal', () => {
  it('sets what was booked against what was budgeted, and says how far over', () => {
    expect(plain(describeMonthTotal(de, report()))).toBe(
      '2.385,74 € von 700,00 € · 1.685,74 € über',
    );
    expect(plain(describeMonthTotal(en, report()))).toBe(
      '2.385,74 € of 700,00 € · 1.685,74 € over',
    );
  });

  it('names pending money after the headline rather than inside it', () => {
    expect(plain(describeMonthTotal(de, report({ totalPendingCents: 1900 })))).toBe(
      '2.385,74 € von 700,00 € · 1.685,74 € über · 19,00 € vorgemerkt',
    );
  });

  it('states only what was spent while the limits are still loading', () => {
    // The rows are in memory, the limits are not: saying "kein Budget gesetzt" here would
    // be a claim about data that has not arrived (dogfood ISSUE-009).
    const loading = { limitsLoading: true };
    expect(plain(describeMonthTotal(de, report({ totalBookedCents: 241364 }), loading))).toBe(
      '2.413,64 € ausgegeben',
    );
    expect(
      plain(
        describeMonthTotal(
          en,
          report({ totalBookedCents: 241364, totalPendingCents: 1900 }),
          loading,
        ),
      ),
    ).toBe('2.413,64 € spent · 19,00 € pending');
  });

  it('says no budget is set rather than comparing against zero', () => {
    expect(
      plain(describeMonthTotal(de, report({ totalBookedCents: 114341, totalBudgetCents: null }))),
    ).toBe('1.143,41 € von — · kein Budget gesetzt');
  });

  it('never prints undefined in either language', () => {
    for (const t of BOTH) {
      for (const totalBudgetCents of [null, 0, 70000]) {
        expect(describeMonthTotal(t, report({ totalBudgetCents }))).not.toContain('undefined');
      }
    }
  });
});

describe('describeBudgetError', () => {
  const codes: BudgetInputErrorCode[] = [
    'MONTH_INVALID',
    'CATEGORY_REQUIRED',
    'AMOUNT_NOT_AN_INTEGER',
    'AMOUNT_NEGATIVE',
    'AMOUNT_TOO_LARGE',
  ];

  it('has a sentence for every code core can emit', () => {
    for (const code of codes) {
      for (const t of BOTH) {
        const sentence = describeBudgetError(t, { code, field: 'amountCents' });
        expect(sentence, code).not.toBe('');
        expect(sentence, code).not.toContain('undefined');
        expect(sentence, code).not.toContain('errors.');
      }
    }
  });

  it('marks each bad field once, keeping the first sentence', () => {
    expect(
      describeBudgetErrors(de, [
        { code: 'MONTH_INVALID', field: 'month' },
        { code: 'AMOUNT_NEGATIVE', field: 'amountCents' },
        { code: 'AMOUNT_TOO_LARGE', field: 'amountCents' },
      ]),
    ).toEqual({ month: 'Ungültiger Monat', amountCents: 'Ein Budget kann nicht negativ sein' });
  });
});

describe('describeFailure', () => {
  it('words a coded refusal the API sends, in both languages', () => {
    expect(describeFailure(de, new ApiError('RULE_EXISTS'))).toBe('Diese Regel gibt es bereits.');
    expect(describeFailure(en, new ApiError('RULE_EXISTS'))).toBe('This rule already exists.');
    expect(describeFailure(en, new ApiError('TRANSACTION_PENDING'))).toContain('pending');
  });

  it('unpacks a refusal that carries its own details', () => {
    expect(
      describeFailure(
        de,
        new ApiError('CATEGORY_IN_USE', [], { rules: 2, transactions: 47, budgets: 3 }),
      ),
    ).toBe('Wird noch verwendet: 2 Regeln, 47 Umsätze, 3 Budgets.');
    expect(
      describeFailure(
        en,
        new ApiError('BUDGET_INVALID', [], {
          errors: [{ code: 'AMOUNT_NEGATIVE', field: 'amountCents' }],
        }),
      ),
    ).toBe('a budget cannot be negative');
  });

  it('still quotes a code it has no sentence for', () => {
    expect(describeFailure(de, new ApiError('SOMETHING_NEW'))).toBe(
      'Anfrage abgelehnt (SOMETHING_NEW)',
    );
    // A validation refusal whose details did not survive is still a refusal, not silence.
    expect(describeFailure(en, new ApiError('RULE_INVALID'))).toBe(
      'request refused (RULE_INVALID)',
    );
  });

  it('frames an uncoded failure rather than showing it bare', () => {
    expect(describeFailure(de, new Error('/rules failed: 500 Internal Server Error'))).toBe(
      'Anfrage fehlgeschlagen: /rules failed: 500 Internal Server Error',
    );
    expect(describeFailure(en, 'offline')).toBe('Request failed: offline');
  });
});

describe('describeImportFailure', () => {
  it('reads every code as a file problem, an unknown one included', () => {
    expect(describeImportFailure(de, new ApiError('HEADER_NOT_FOUND'))).toBe(
      'Keine Kopfzeile gefunden — ist das ein CSV-CAMT-Export der Sparkasse?',
    );
    expect(describeImportFailure(en, new ApiError('CSV_SOMETHING_NEW'))).toBe(
      'file not readable (CSV_SOMETHING_NEW)',
    );
  });
});
