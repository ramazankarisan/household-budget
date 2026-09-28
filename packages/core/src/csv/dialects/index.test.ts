import { describe, expect, it } from 'vitest';

import sparkasse17Csv from '../../../../../fixtures/sparkasse-camt-17.csv?raw';
import sparkasse18Csv from '../../../../../fixtures/sparkasse-camt-18-utf8.csv?raw';
import deutscheBankCsv from '../../../../../fixtures/deutsche-bank.csv?raw';

import { deutscheBank } from './deutsche-bank.js';
import { detectDialect } from './index.js';
import type { BankDialect } from './types.js';

describe('detectDialect', () => {
  it('recognises both Sparkasse CSV-CAMT shapes on line 1', () => {
    expect(detectDialect(sparkasse17Csv)).toMatchObject({
      dialect: { id: 'sparkasse-camt' },
      headerLine: 1,
    });
    expect(detectDialect(sparkasse18Csv)).toMatchObject({
      dialect: { id: 'sparkasse-camt' },
      headerLine: 1,
    });
  });

  it('recognises Deutsche Bank past its preamble', () => {
    expect(detectDialect(deutscheBankCsv)).toMatchObject({
      dialect: { id: 'deutsche-bank' },
      headerLine: 8,
    });
  });

  it('returns undefined when nothing looks like a header', () => {
    expect(detectDialect('eins;zwei\r\ndrei;vier\r\n')).toBeUndefined();
  });

  it('prefers the dialect with more markers on a line both recognise', () => {
    const generic: BankDialect = { ...deutscheBank, headerMarkers: ['Buchungstag'] };

    expect(detectDialect(deutscheBankCsv, [generic, deutscheBank])?.dialect).toBe(deutscheBank);
  });

  it('throws on a tie rather than picking by registry order', () => {
    const twin: BankDialect = { ...deutscheBank };

    expect(() => detectDialect(deutscheBankCsv, [deutscheBank, twin])).toThrowError(
      /Ambiguous bank dialects on line 8/u,
    );
  });
});
