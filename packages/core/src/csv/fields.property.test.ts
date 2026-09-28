/**
 * Properties the hand-picked cases in fields.test.ts sample one value at a time: every
 * German amount a bank can print comes back as the exact integer cents it stands for, and
 * every real calendar date comes back as the same ISO date. fast-check generates the
 * inputs and shrinks any failure to its smallest form.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseGermanAmount, parseGermanDate } from './fields.js';

/** `123456` → `1.234,56`, the way a German statement prints it. */
function withThousands(euros: string): string {
  return euros.replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
}

/** Every spelling a bank uses for one amount: grouped or not, trailing zeros cut or not. */
const germanSpelling = fc
  .record({
    cents: fc.integer({ min: -99_999_999_99, max: 99_999_999_99 }),
    grouped: fc.boolean(),
    truncate: fc.boolean(),
  })
  .map(({ cents, grouped, truncate }) => {
    const magnitude = Math.abs(cents);
    const eurosDigits = String(Math.trunc(magnitude / 100));
    const euros = grouped ? withThousands(eurosDigits) : eurosDigits;
    let fraction = String(magnitude % 100).padStart(2, '0');
    if (truncate) {
      // Sparkasse's '832,9' and '-190': zeros are cut from the right, never the left.
      fraction = fraction.replace(/0+$/u, '');
    }
    const sign = cents < 0 ? '-' : '';
    return { cents, text: fraction === '' ? `${sign}${euros}` : `${sign}${euros},${fraction}` };
  });

describe('parseGermanAmount (properties)', () => {
  it('reads every spelling back as the exact cents it was printed from', () => {
    fc.assert(
      fc.property(germanSpelling, ({ cents, text }) => {
        // `+ 0` folds -0 into 0: '-0' and '0' are the same amount.
        expect(parseGermanAmount(text)).toBe(cents + 0);
      }),
    );
  });

  it('returns integer cents or undefined for any string, and never throws', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const result = parseGermanAmount(raw);
        expect(result === undefined || Number.isSafeInteger(result)).toBe(true);
      }),
    );
  });
});

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** A real calendar date as its parts. Built from parts because core never constructs a `Date`. */
const calendarDate = fc
  .record({ year: fc.integer({ min: 1900, max: 2100 }), month: fc.integer({ min: 1, max: 12 }) })
  .chain(({ year, month }) => {
    const last = month === 2 && isLeap(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 31);
    return fc.integer({ min: 1, max: last }).map((day) => ({ year, month, day }));
  });

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

describe('parseGermanDate (properties)', () => {
  it('reads every real dd.mm.yyyy date back as the same ISO date', () => {
    fc.assert(
      fc.property(calendarDate, ({ year, month, day }) => {
        expect(
          parseGermanDate(`${pad(day)}.${pad(month)}.${String(year)}`, { referenceYear: 2025 }),
        ).toBe(`${String(year)}-${pad(month)}-${pad(day)}`);
      }),
    );
  });

  it('resolves a two-digit year to the same day and month, in one of two centuries', () => {
    // 29 February is left out: '29.02.00' is real in 2000 and not in 1900, so which
    // century the year resolves to decides whether the date exists at all.
    const notLeapDay = calendarDate.filter(({ month, day }) => !(month === 2 && day === 29));
    fc.assert(
      fc.property(notLeapDay, fc.integer({ min: 1990, max: 2090 }), (date, referenceYear) => {
        const yy = pad(date.year % 100);
        const result = parseGermanDate(`${pad(date.day)}.${pad(date.month)}.${yy}`, {
          referenceYear,
        });
        expect([`19${yy}`, `20${yy}`]).toContain(result?.slice(0, 4));
        expect(result?.slice(4)).toBe(`-${pad(date.month)}-${pad(date.day)}`);
      }),
    );
  });

  it('only ever returns a well-formed ISO date or undefined, and never throws', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const result = parseGermanDate(raw, { referenceYear: 2025 });
        expect(result === undefined || /^\d{4}-\d{2}-\d{2}$/u.test(result)).toBe(true);
      }),
    );
  });
});
