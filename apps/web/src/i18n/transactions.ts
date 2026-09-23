import { type Locale } from './importErrors';

/**
 * Every string the transactions list shows, in both languages.
 *
 * The posture `importErrors.ts` and `rules.ts` already have: German by default, English
 * available and tested, `locale: Locale = 'de'` as the whole mechanism. The column
 * headers move here rather than staying inline above a translated toolbar — wording that
 * only exists in one language is the drift this file exists to stop.
 */
interface TransactionsText {
  readonly month: string;
  readonly allMonths: string;
  /** The filter select's accessible name — deliberately not `columns.category`. */
  readonly filterCategory: string;
  readonly allCategories: string;
  readonly uncategorized: string;
  /** The count chip's accessible name: what clicking it does, not what it says. */
  readonly showUncategorized: string;
  readonly search: string;
  readonly clearSearch: string;
  readonly resetFilters: string;
  readonly noTransactions: string;
  readonly noMatches: string;
  readonly columns: {
    readonly date: string;
    readonly counterparty: string;
    readonly purpose: string;
    readonly category: string;
    readonly amount: string;
  };
}

const TEXT: Record<Locale, TransactionsText> = {
  de: {
    month: 'Monat',
    allMonths: 'Alle Monate',
    filterCategory: 'Kategorie filtern',
    allCategories: 'Alle Kategorien',
    uncategorized: 'Ohne Kategorie',
    showUncategorized: 'Nur Umsätze ohne Kategorie zeigen',
    search: 'Suche',
    clearSearch: 'Suche löschen',
    resetFilters: 'Filter zurücksetzen',
    noTransactions: 'Noch keine Umsätze. Importieren Sie einen CSV-Export.',
    noMatches: 'Keine Umsätze für diese Auswahl.',
    columns: {
      date: 'Datum',
      counterparty: 'Empfänger',
      purpose: 'Zweck',
      category: 'Kategorie',
      amount: 'Betrag',
    },
  },
  en: {
    month: 'Month',
    allMonths: 'All months',
    filterCategory: 'Filter by category',
    allCategories: 'All categories',
    uncategorized: 'Uncategorized',
    showUncategorized: 'Show only transactions without a category',
    search: 'Search',
    clearSearch: 'Clear search',
    resetFilters: 'Reset filters',
    noTransactions: 'No transactions yet. Import a CSV export.',
    noMatches: 'No transactions match this selection.',
    columns: {
      date: 'Date',
      counterparty: 'Payee',
      purpose: 'Purpose',
      category: 'Category',
      amount: 'Amount',
    },
  },
};

export function transactionsText(locale: Locale = 'de'): TransactionsText {
  return TEXT[locale];
}

const UNCATEGORIZED_COUNT: Record<Locale, (count: number) => string> = {
  de: (count) => (count === 0 ? 'Alle kategorisiert' : `${String(count)} ohne Kategorie`),
  en: (count) => (count === 0 ? 'All categorized' : `${String(count)} uncategorized`),
};

/**
 * How much of the account still has no category, in one chip.
 *
 * A function rather than a label the page concatenates, for `describeApplySummary`'s
 * reason: zero is a different sentence, not the same sentence with a 0 in it, and a page
 * assembling the German half is how the English half goes missing.
 */
export function describeUncategorized(count: number, locale: Locale = 'de'): string {
  return UNCATEGORIZED_COUNT[locale](count);
}
