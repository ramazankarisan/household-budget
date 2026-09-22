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
