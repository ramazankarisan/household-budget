import { normalize, normalizeIban, type TransactionPayload } from '@household-budget/core';

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

/** `''` means "every month"; otherwise `'YYYY-MM'`. */
export interface TransactionFilterState {
  readonly month: string;
  /** `''` = every category, `UNCATEGORIZED` = rows with none, else a category id. */
  readonly categoryId: string;
  readonly search: string;
}

/**
 * Not a category id and never mistakable for one: every id here is a cuid, which is
 * lower-case alphanumeric and 25 characters long.
 */
export const UNCATEGORIZED = 'uncategorized';

export const NO_FILTERS: TransactionFilterState = { month: '', categoryId: '', search: '' };

/** True while anything is narrowing the list — what tells the two empty states apart. */
export function hasFilters(filters: TransactionFilterState): boolean {
  return filters.month !== '' || filters.categoryId !== '' || filters.search !== '';
}

/**
 * The month a row belongs to, `'YYYY-MM'`.
 *
 * A substring rather than a `Date`, for the same reason `bookingDate` is stored as text:
 * a booking date has no zone, and `new Date('2025-09-01')` is UTC midnight — which is
 * September or August depending on where the browser is standing.
 */
export function monthOf(transaction: TransactionPayload): string {
  return transaction.bookingDate.slice(0, 7);
}

/** The months the rows actually cover, newest first. A history has holes. */
export function monthsOf(transactions: readonly TransactionPayload[]): readonly string[] {
  const months = new Set(transactions.map(monthOf));
  return [...months].sort().reverse();
}

/**
 * Every live row with no category, pending included.
 *
 * A fact about the account, not about the view, which is why it takes the whole array and
 * not the filtered one: a number that moves while the user narrows the list cannot answer
 * "how much is left". Pending rows count because they are on screen — a count that
 * disagreed with the table under it would be read as a bug, even though a pending row
 * cannot be categorized by hand until it books.
 */
export function uncategorizedCount(transactions: readonly TransactionPayload[]): number {
  return transactions.filter((transaction) => transaction.categoryId === null).length;
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

function matchesMonth(row: TransactionPayload, month: string): boolean {
  return month === '' || monthOf(row) === month;
}

function matchesCategory(row: TransactionPayload, categoryId: string): boolean {
  if (categoryId === '') {
    return true;
  }
  if (categoryId === UNCATEGORIZED) {
    return row.categoryId === null;
  }
  return row.categoryId === categoryId;
}

/** Month **and** category **and** search. Takes the pairs, returns the rows. */
export function filterTransactions(
  searchable: readonly SearchableTransaction[],
  filters: TransactionFilterState,
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
        matchesMonth(candidate.row, filters.month) &&
        matchesCategory(candidate.row, filters.categoryId) &&
        (needle === '' ||
          candidate.text.includes(needle) ||
          (ibanNeedle !== '' && candidate.iban.includes(ibanNeedle))),
    )
    .map(({ row }) => row);
}
