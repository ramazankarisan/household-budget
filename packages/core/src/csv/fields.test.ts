import { describe, expect, it } from 'vitest';

import { parseGermanAmount, parseGermanDate } from './fields.js';

describe('parseGermanAmount', () => {
  it('parses the truncated forms Sparkasse actually emits', () => {
    // '832,9' is 832,90 — a parser assuming two decimals is off by a factor of ten.
    expect(parseGermanAmount('832,9')).toBe(83290);
    expect(parseGermanAmount('-190')).toBe(-19000);
    expect(parseGermanAmount('-128,5')).toBe(-12850);
  });

  it('parses ordinary amounts, separated or not', () => {
    expect(parseGermanAmount('1.234,56')).toBe(123456);
    expect(parseGermanAmount('-1143,41')).toBe(-114341);
    expect(parseGermanAmount('0,07')).toBe(7);
    expect(parseGermanAmount('19,99')).toBe(1999);
    expect(parseGermanAmount('2.450,00')).toBe(245000);
    expect(parseGermanAmount('-42,17')).toBe(-4217);
  });

  it('never routes an amount through a float', () => {
    // The three measurements from the research, restated as a test: if this module ever
    // grows a `parseFloat(x) * 100`, these are the values that break first.
    expect(parseGermanAmount('19,99')).toBe(1999);
    expect(parseGermanAmount('1,005')).toBeUndefined();
    expect(parseGermanAmount('0,1')).toBe(10);
    expect(parseGermanAmount('0,2')).toBe(20);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseGermanAmount('  -42,17 ')).toBe(-4217);
  });

  it('returns undefined for anything that is not a German amount', () => {
    // The caller turns this into an AMOUNT_UNPARSEABLE row error — a bad amount is
    // never silently defaulted to zero.
    expect(parseGermanAmount('12,3,4')).toBeUndefined();
    expect(parseGermanAmount('')).toBeUndefined();
    expect(parseGermanAmount('abc')).toBeUndefined();
    expect(parseGermanAmount('42.17')).toBeUndefined();
    expect(parseGermanAmount('1,234,56')).toBeUndefined();
    expect(parseGermanAmount('-')).toBeUndefined();
    expect(parseGermanAmount('12 34')).toBeUndefined();
  });
});

describe('parseGermanDate', () => {
  const options = { referenceYear: 2026 };

  it('parses both widths, which mix within one row', () => {
    expect(parseGermanDate('24.03.14', options)).toBe('2014-03-24');
    expect(parseGermanDate('01.04.2014', options)).toBe('2014-04-01');
  });

  it('pivots two-digit years around the reference year', () => {
    // One year ahead is still this century; two years ahead is an old export.
    expect(parseGermanDate('01.01.27', options)).toBe('2027-01-01');
    expect(parseGermanDate('01.01.28', options)).toBe('1928-01-01');
    expect(parseGermanDate('22.09.25', options)).toBe('2025-09-22');
  });

  it('moves the pivot with the injected reference year', () => {
    expect(parseGermanDate('01.01.28', { referenceYear: 2027 })).toBe('2028-01-01');
    expect(parseGermanDate('01.01.28', { referenceYear: 2030 })).toBe('2028-01-01');
  });

  it('rejects dates that do not exist', () => {
    expect(parseGermanDate('32.13.25', options)).toBeUndefined();
    expect(parseGermanDate('31.02.25', options)).toBeUndefined();
    expect(parseGermanDate('00.01.25', options)).toBeUndefined();
    expect(parseGermanDate('01.00.25', options)).toBeUndefined();
  });

  it('knows which Februaries have 29 days', () => {
    expect(parseGermanDate('29.02.2024', options)).toBe('2024-02-29');
    expect(parseGermanDate('29.02.2023', options)).toBeUndefined();
    expect(parseGermanDate('29.02.2000', options)).toBe('2000-02-29');
    expect(parseGermanDate('29.02.1900', options)).toBeUndefined();
  });

  it('returns undefined for anything that is not a German date', () => {
    expect(parseGermanDate('2025-09-22', options)).toBeUndefined();
    expect(parseGermanDate('', options)).toBeUndefined();
    expect(parseGermanDate('22.09.2025 12:00', options)).toBeUndefined();
    expect(parseGermanDate('22/09/2025', options)).toBeUndefined();
  });
});
