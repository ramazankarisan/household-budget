import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/** `?m=all` — every month. Only pages whose default is "all" accept it. */
export const ALL_MONTHS = 'all';

export const MONTH_PARAM = 'm';

interface UseMonthOptions {
  /**
   * What the page shows without a valid `?m`: the newest month with data (Überblick), or
   * every month (the list, the inbox).
   */
  readonly defaultTo: 'newest' | 'all';
}

export interface MonthState {
  /** `'YYYY-MM'`, `ALL_MONTHS`, or `''` while there are no months at all. */
  readonly month: string;
  readonly setMonth: (month: string) => void;
  /** `+1` = one month newer, `-1` = one month older. From "all", either goes to the newest. */
  readonly step: (delta: 1 | -1) => void;
}

/**
 * The month every page is looking at, kept in the URL (`?m=2025-09`) so a link is a view
 * and the back button undoes a month change.
 *
 * Derived, never copied into state: an unknown or malformed `?m` — a bookmark into a
 * history since re-imported, a month the chosen account does not have — falls back to the
 * page's default rather than showing an empty page that reads as a bug.
 *
 * @param available the months the data covers, newest first (`monthsOf`)
 */
export function useMonth(available: readonly string[], { defaultTo }: UseMonthOptions): MonthState {
  const [params, setParams] = useSearchParams();
  const raw = params.get(MONTH_PARAM);
  const allowAll = defaultTo === 'all';
  const fallback = allowAll ? ALL_MONTHS : (available[0] ?? '');
  const month =
    raw !== null && (available.includes(raw) || (allowAll && raw === ALL_MONTHS)) ? raw : fallback;

  const setMonth = useCallback(
    (next: string) => {
      setParams((current) => {
        const copy = new URLSearchParams(current);
        copy.set(MONTH_PARAM, next);
        return copy;
      });
    },
    [setParams],
  );

  const step = useCallback(
    (delta: 1 | -1) => {
      if (available.length === 0) {
        return;
      }
      if (month === ALL_MONTHS || !available.includes(month)) {
        setMonth(available[0] ?? '');
        return;
      }
      // Newest first, so "newer" is one index down.
      const next = available[available.indexOf(month) - delta];
      if (next !== undefined) {
        setMonth(next);
      }
    },
    [available, month, setMonth],
  );

  return { month, setMonth, step };
}

/** The current `?m`, for links that should keep the month when they leave the page. */
export function monthSearch(search: string): string {
  const month = new URLSearchParams(search).get(MONTH_PARAM);
  return month === null ? '' : `?${MONTH_PARAM}=${encodeURIComponent(month)}`;
}
