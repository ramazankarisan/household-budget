import { describe, expect, it } from 'vitest';

import { formatAmount, formatBookingDate } from './format';

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
