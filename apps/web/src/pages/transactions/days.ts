import { type TransactionPayload } from '@household-budget/core';

import { type Locale } from '../../locales/messages';

const DAY: Record<Locale, Intl.DateTimeFormat> = {
  de: new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }),
  en: new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }),
};

/**
 * `'2025-09-18'` → `Donnerstag, 18. September 2025`, split by hand for the zone reason
 * `format.ts` gives. Weekday and month are words, so they follow the language — like
 * `formatMonth`; numeric dates stay `de-DE` (apps/web/CLAUDE.md).
 */
export function formatDay(isoDate: string, locale: Locale): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return isoDate;
  }
  return DAY[locale].format(new Date(year, month - 1, day));
}

/** Rows grouped by booking day, newest day first, each day in the order given. */
export function byDay(
  rows: readonly TransactionPayload[],
): readonly { readonly day: string; readonly rows: readonly TransactionPayload[] }[] {
  const days = new Map<string, TransactionPayload[]>();
  for (const row of rows) {
    const list = days.get(row.bookingDate) ?? [];
    list.push(row);
    days.set(row.bookingDate, list);
  }
  return [...days.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, dayRows]) => ({ day, rows: dayRows }));
}
