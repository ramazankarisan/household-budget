import { type Locale } from './locales/messages';

const CURRENCY = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

// The default de-DE date format is 22.9.2025, unpadded. A statement lines up or it does not.
const DATE = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/**
 * Integer cents to `-832,90 €`. The division is the one place a stored amount meets a
 * float, and nothing is computed from the result — it goes straight to the formatter,
 * which rounds to two decimals.
 */
export function formatAmount(cents: number): string {
  return CURRENCY.format(cents / 100);
}

/**
 * `'2025-09-22'` to `22.09.2025`.
 *
 * The date is split by hand rather than handed to `new Date('2025-09-22')`, which the
 * language parses as **UTC** midnight. Formatted anywhere west of Greenwich that renders
 * as the day before — the exact failure that keeping dates as strings exists to avoid.
 */
export function formatBookingDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return isoDate;
  }
  return DATE.format(new Date(year, month - 1, day));
}

/**
 * Month names are words, so they follow the language; amounts and dates are the
 * statement's and stay de-DE in both (plan 07, decision 1). `en-GB`: `December 2024`.
 */
const MONTH: Record<Locale, Intl.DateTimeFormat> = {
  de: new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }),
  en: new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }),
};

/** `2025-09`, and nothing else — the twelve real months, four-digit year, both padded. */
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/u;

/**
 * `'2025-09'` to `September 2025` — or `Dezember 2024` / `December 2024`, by `locale`.
 *
 * Built from parts for the reason above, plus one this needs and `formatBookingDate` does
 * not: `Intl` throws `RangeError` on an invalid `Date`, so `'x-y'` would take the page
 * down rather than render as itself.
 *
 * The shape is checked before anything is parsed, because splitting and parsing cannot
 * check it: `Number('')` is `0`, not `NaN`, so `'2025-'` survives every test a parsed
 * pair can be put to and renders as `Dezember 2024` — a month key one character short of
 * real, silently showing the wrong month rather than showing itself.
 */
export function formatMonth(month: string, locale: Locale = 'de'): string {
  if (!MONTH_KEY.test(month)) {
    return month;
  }
  const [year, monthNumber] = month.split('-').map(Number);
  if (year === undefined || monthNumber === undefined) {
    return month;
  }
  return MONTH[locale].format(new Date(year, monthNumber - 1, 1));
}
