import { describe, expect, it } from 'vitest';

import { formatAmount, formatBookingDate, formatMonth } from './format';

/** de-DE puts U+00A0 between the amount and the €. Compare without fighting it. */
const plain = (text: string): string => text.replaceAll('\u00a0', ' ');

describe('formatAmount', () => {
  it('renders integer cents as German euros', () => {
    expect(plain(formatAmount(-83290))).toBe('-832,90 €');
    expect(plain(formatAmount(-4217))).toBe('-42,17 €');
    expect(plain(formatAmount(245000))).toBe('2.450,00 €');
    expect(plain(formatAmount(0))).toBe('0,00 €');
  });

  it('keeps the cent the parser produced', () => {
    // The truncated forms the bank writes: 832,9 became 83290 cents, and it has to come
    // back out as 832,90 rather than 8329,00 or 83,29.
    expect(plain(formatAmount(83290))).toBe('832,90 €');
    expect(plain(formatAmount(-19000))).toBe('-190,00 €');
    expect(plain(formatAmount(7))).toBe('0,07 €');
  });
});

describe('formatBookingDate', () => {
  it('pads day and month, which the de-DE default does not', () => {
    expect(formatBookingDate('2025-09-22')).toBe('22.09.2025');
    expect(formatBookingDate('2014-03-24')).toBe('24.03.2014');
    expect(formatBookingDate('2025-01-05')).toBe('05.01.2025');
  });

  it('renders the calendar date, not a UTC instant', () => {
    // `new Date('2025-09-01')` is UTC midnight, which formats as 31.08.2025 anywhere
    // west of Greenwich — a transaction silently moved into the previous month.
    expect(formatBookingDate('2025-09-01')).toBe('01.09.2025');
    expect(formatBookingDate('2025-01-01')).toBe('01.01.2025');
  });

  it('passes anything that is not a date straight through', () => {
    expect(formatBookingDate('')).toBe('');
  });
});

describe('formatMonth', () => {
  it('names the month a filter option stands for', () => {
    expect(formatMonth('2025-09')).toBe('September 2025');
    expect(formatMonth('2014-03')).toBe('März 2014');
    expect(formatMonth('2025-01')).toBe('Januar 2025');
  });

  it('renders the calendar month, not a UTC instant', () => {
    // Built from parts for `formatBookingDate`'s reason: `new Date('2025-01')` is UTC
    // midnight, which is December anywhere west of Greenwich.
    expect(formatMonth('2025-12')).toBe('Dezember 2025');
  });

  it('passes anything that is not a month straight through, and does not throw', () => {
    // `Intl` throws RangeError on `new Date(NaN, NaN, 1)`, so 'x-y' — two parts, both
    // unparseable — would take the page down rather than render as itself.
    expect(formatMonth('x-y')).toBe('x-y');
    expect(formatMonth('nonsense')).toBe('nonsense');
    expect(formatMonth('')).toBe('');
  });

  it('shows a half-written key as itself rather than as the wrong month', () => {
    // `Number('')` is 0, not NaN, so each of these parses into a number pair and formats
    // as a real month: '2025-' as Dezember 2024 and '-09' as September 1900. Silently
    // wrong beats loudly wrong only if nobody reads it.
    expect(formatMonth('2025-')).toBe('2025-');
    expect(formatMonth('-09')).toBe('-09');
    expect(formatMonth('2025-00')).toBe('2025-00');
    expect(formatMonth('2025-13')).toBe('2025-13');
    expect(formatMonth('2025-9')).toBe('2025-9');
  });
});
