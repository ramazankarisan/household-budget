/**
 * What a month is, in the one form everything here agrees on: `'YYYY-MM'`.
 *
 * The shape lived in two places that cannot see each other — `apps/web/src/filter.ts`
 * derived it from a booking date, `apps/web/src/format.ts` guarded a formatter with it —
 * and the API now needs the same rule to accept a path segment. A rule both ends run
 * belongs here, the posture `rules/match.ts` states.
 *
 * No `Date` is constructed, in this module or anywhere under `budget/`. A month has no
 * time and no zone, and `new Date('2025-09-01')` is UTC midnight, which is August west of
 * Greenwich.
 */

/**
 * A validated `'YYYY-MM'`. Branded so a month that was never checked cannot be passed
 * where one that was is expected — the same reason `Cents` is branded.
 */
export type MonthKey = string & { readonly __brand: 'MonthKey' };

/**
 * The twelve real months, four-digit year, both padded.
 *
 * Checked before anything is parsed, because splitting and parsing cannot check it:
 * `Number('')` is `0`, not `NaN`, so `'2025-'` survives every test a parsed pair can be
 * put to. `format.ts` records what that costs — it renders as `Dezember 2024`.
 */
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/u;

/** Whether this is a month key. The guard the API validates a path segment with. */
export function isMonthKey(value: unknown): value is MonthKey {
  return typeof value === 'string' && MONTH_KEY.test(value);
}

/**
 * The month a `'YYYY-MM-DD'` booking date belongs to.
 *
 * A substring rather than a parse, for the reason stated above: the stored date is text
 * precisely so that no zone can move it, and slicing keeps that promise.
 */
export function monthOfDate(isoDate: string): string {
  return isoDate.slice(0, 7);
}
