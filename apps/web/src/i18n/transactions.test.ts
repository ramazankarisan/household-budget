import { describe, expect, it } from 'vitest';

import { type Locale } from './importErrors';
import { describeUncategorized, transactionsText } from './transactions';

const LOCALES: Locale[] = ['de', 'en'];

/** Walks the whole object, so the nested column headers cannot go unchecked. */
function leaves(value: unknown, path = ''): { path: string; value: unknown }[] {
  if (typeof value !== 'object' || value === null) {
    return [{ path, value }];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, path === '' ? key : `${path}.${key}`),
  );
}

describe('transactionsText', () => {
  it('has wording for every label in both languages', () => {
    for (const locale of LOCALES) {
      for (const { path, value } of leaves(transactionsText(locale))) {
        expect(typeof value, path).toBe('string');
        expect(value as string, path).not.toBe('');
        expect(value as string, path).not.toContain('undefined');
      }
    }
  });

  it('defaults to German', () => {
    expect(transactionsText().columns.amount).toBe('Betrag');
    expect(transactionsText('en').columns.amount).toBe('Amount');
  });

  it('names the category filter something the row selects are not called', () => {
    // `CategoryCell` puts a combobox named "Kategorie" on every row. A second control by
    // that name is a strict-mode locator failure in three tests that already pass.
    expect(transactionsText().filterCategory).not.toBe(transactionsText().columns.category);
  });
});

describe('describeUncategorized', () => {
  it('states the count in both languages', () => {
    expect(describeUncategorized(7)).toBe('7 ohne Kategorie');
    expect(describeUncategorized(7, 'en')).toBe('7 uncategorized');
  });

  it('says the work is done rather than counting zero', () => {
    // "0 ohne Kategorie" is a number to read; "Alle kategorisiert" is an answer.
    expect(describeUncategorized(0)).toBe('Alle kategorisiert');
    expect(describeUncategorized(0, 'en')).toBe('All categorized');
    for (const locale of LOCALES) {
      expect(describeUncategorized(0, locale), locale).not.toContain('0');
      expect(describeUncategorized(1, locale), locale).not.toContain('undefined');
    }
  });
});
