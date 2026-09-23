import { describe, expect, it } from 'vitest';

import { isMonthKey, monthOfDate } from './month.js';

describe('isMonthKey', () => {
  it('accepts the twelve real months', () => {
    const months = Array.from(
      { length: 12 },
      (_, index) => `2025-${String(index + 1).padStart(2, '0')}`,
    );

    expect(months.every(isMonthKey)).toBe(true);
  });

  it('rejects a thirteenth month and a zeroth one', () => {
    expect(isMonthKey('2025-13')).toBe(false);
    expect(isMonthKey('2025-00')).toBe(false);
  });

  it('rejects an unpadded month', () => {
    expect(isMonthKey('2025-9')).toBe(false);
  });

  it('rejects a key one character short of real', () => {
    // `format.ts` records what this costs downstream: parsed instead of shape-checked,
    // `'2025-'` renders as `Dezember 2024`.
    expect(isMonthKey('2025-')).toBe(false);
  });

  it('rejects anything that is not a month at all', () => {
    expect(isMonthKey('x-y')).toBe(false);
    expect(isMonthKey('2025-09-22')).toBe(false);
    expect(isMonthKey('')).toBe(false);
    expect(isMonthKey(202509)).toBe(false);
    expect(isMonthKey(null)).toBe(false);
    expect(isMonthKey(undefined)).toBe(false);
  });
});

describe('monthOfDate', () => {
  it('takes the month out of a booking date without parsing it', () => {
    expect(monthOfDate('2025-09-22')).toBe('2025-09');
  });

  it('gives the same answer for the first of the month in every zone', () => {
    // `new Date('2025-09-01')` is UTC midnight, which is August west of Greenwich. A
    // slice cannot have that problem, which is the whole reason for this function.
    expect(monthOfDate('2025-09-01')).toBe('2025-09');
  });

  it('leaves a date it does not understand alone rather than guessing', () => {
    expect(monthOfDate('nonsense')).toBe('nonsens');
    expect(isMonthKey(monthOfDate('nonsense'))).toBe(false);
  });
});
