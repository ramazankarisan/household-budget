import {
  monthOfDate,
  normalize,
  normalizeIban,
  type TransactionPayload,
} from '@household-budget/core';

/**
 * Narrowing the list, in the browser, over the rows the page has already loaded.
 *
 * No React here, for the reason `format.ts` has none: the cases this has to get right are
 * German strings — `MÜLLER GmbH` found by `müller`, a `Verwendungszweck` carrying a CRLF —
 * and those are string-in/boolean-out claims that should not need a rendered table to
 * make. The text half could not have been a `WHERE` clause anyway: SQLite folds case for
 * ASCII only, which is the measurement `docs/research/03-transactions-list.md` §6 records
 * and `docs/research/02-categorization-rules.md` §3 recorded before it.
 */

/**
 * What narrows the list. The month is not here: it is navigation, kept in the URL by
 * `useMonth` and shared with every page, and passed to {@link filterTransactions} beside
 * this.
 */
export interface TransactionFilterState {
  /** `''` = every account, else an account id. */
  readonly accountId: string;
  /** `''` = every category, `UNCATEGORIZED` = rows with none, else a category id. */
  readonly categoryId: string;
  readonly search: string;
}

/**
 * Not a category id and never mistakable for one: every id here is a cuid, which is
 * lower-case alphanumeric and 25 characters long.
 */
export const UNCATEGORIZED = 'uncategorized';

export const NO_FILTERS: TransactionFilterState = { accountId: '', categoryId: '', search: '' };

/**
 * True while anything is narrowing the list — what tells the two empty states apart. The
 * month is not a filter: every month the stepper offers has rows.
 */
export function hasFilters(filters: TransactionFilterState): boolean {
  return filters.accountId !== '' || filters.categoryId !== '' || filters.search !== '';
}

/**
 * The month a row belongs to, `'YYYY-MM'`.
 *
 * A substring rather than a `Date`, for the same reason `bookingDate` is stored as text:
 * a booking date has no zone, and `new Date('2025-09-01')` is UTC midnight — which is
 * September or August depending on where the browser is standing. The rule itself is
 * core's `monthOfDate`, because the budgets report and the API need the same one.
 */
export function monthOf(transaction: TransactionPayload): string {
  return monthOfDate(transaction.bookingDate);
}

/** The months the rows actually cover, newest first. A history has holes. */
export function monthsOf(transactions: readonly TransactionPayload[]): readonly string[] {
  const months = new Set(transactions.map(monthOf));
  return [...months].sort().reverse();
}

/**
 * What „Ohne Kategorie“ means everywhere it is counted (plan 08, decision 5): booked rows,
 * money in or out, that no rule and no hand has given a category.
 *
 * A fact about the scope, not about the view, which is why it takes rows and not the
 * filtered list: a number that moves while the user narrows the list cannot answer "how
 * much is left". Vorgemerkt rows are not counted — the API refuses to categorize them
 * until they book (`TRANSACTION_PENDING`), so counting them would promise work that
 * cannot be done. The nav badge, the list's chip and its „Ohne Kategorie“ filter, and the
 * Überblick card all follow this, which is what keeps their numbers the same.
 *
 * @param month `'YYYY-MM'` to count one month; omitted or `'all'` for every month
 */
export function uncategorizedRows(
  transactions: readonly TransactionPayload[],
  { month }: { readonly month?: string } = {},
): readonly TransactionPayload[] {
  return transactions.filter(
    (row) =>
      row.categoryId === null &&
      row.status === 'booked' &&
      (month === undefined || month === 'all' || monthOf(row) === month),
  );
}

/** A row with its haystacks, normalized once per load rather than once per keystroke. */
export interface SearchableTransaction {
  readonly row: TransactionPayload;
  /** Payee and purpose, normalized together. */
  readonly text: string;
  /** The IBAN without its groups, so a typed `DE89 3704 …` finds a stored `de89370400…`. */
  readonly iban: string;
}

/**
 * The haystacks, built once for a loaded list.
 *
 * `?? ''` rather than a bare template literal: both fields are `string | null`, and
 * interpolating a null would put the literal `"null"` into the haystack, where a search
 * for `null` would find every blank row.
 */
export function searchableOf(
  transactions: readonly TransactionPayload[],
): readonly SearchableTransaction[] {
  return transactions.map((row) => ({
    row,
    text: normalize(`${row.counterpartyName ?? ''} ${row.purpose ?? ''}`),
    iban: normalizeIban(row.counterpartyIban),
  }));
}

/** The country code and the first check digit — as much of an IBAN as is unambiguous. */
const IBAN_NEEDLE = /^[a-z]{2}\d/u;

/** `'all'` (`ALL_MONTHS`) or `''` = every month. */
function matchesMonth(row: TransactionPayload, month: string): boolean {
  return month === '' || month === 'all' || monthOf(row) === month;
}

function matchesCategory(row: TransactionPayload, categoryId: string): boolean {
  if (categoryId === '') {
    return true;
  }
  if (categoryId === UNCATEGORIZED) {
    // The rows the chip counts (`uncategorizedRows`): vorgemerkt ones wait until they book.
    return row.categoryId === null && row.status === 'booked';
  }
  return row.categoryId === categoryId;
}

/** Month **and** category **and** search. Takes the pairs, returns the rows. */
export function filterTransactions(
  searchable: readonly SearchableTransaction[],
  filters: TransactionFilterState,
  month: string,
): readonly TransactionPayload[] {
  /*
   * Two needles from one typed string, because one haystack cannot serve both. `normalize`
   * keeps single spaces, so a typed `DE89 3704 0044 …` never `includes`-matches the stored
   * `de89370400440532013000`; normalizing the needle with `normalizeIban` instead would
   * strip the space out of `miete oktober` and stop it matching a purpose. Both are
   * computed once for the pass rather than once per row.
   */
  const needle = normalize(filters.search);
  const spaceless = normalizeIban(filters.search);
  /*
   * And the IBAN haystack is consulted only for a needle that looks like the start of
   * one — two letters and a digit. Without that gate `de` matches every German IBAN and
   * `44` matches most of them, and the row appears with nothing in it that the user can
   * see matching: the table renders no IBAN column.
   */
  const ibanNeedle = IBAN_NEEDLE.test(spaceless) ? spaceless : '';

  return searchable
    .filter(
      (candidate) =>
        matchesMonth(candidate.row, month) &&
        matchesCategory(candidate.row, filters.categoryId) &&
        (needle === '' ||
          candidate.text.includes(needle) ||
          (ibanNeedle !== '' && candidate.iban.includes(ibanNeedle))),
    )
    .map(({ row }) => row);
}
