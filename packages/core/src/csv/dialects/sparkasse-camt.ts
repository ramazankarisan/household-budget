/**
 * Sparkasse CSV-CAMT (V8). Header on line 1, `;`-delimited, Windows-1252.
 *
 * Two column counts exist in the wild: 17 (ending at `Info`) and 18 (ending at
 * `Kategorie`). Columns are matched by name, so one descriptor covers both.
 * Format research: `docs/research/01-csv-import.md`.
 */
import { parseGermanAmount, parseGermanDate } from '../fields.js';
import type { BookingStatus } from '../transaction.js';
import type { BankDialect } from './types.js';

export const sparkasseCamt: BankDialect = {
  id: 'sparkasse-camt',
  /** Two tokens are enough to recognise a Sparkasse header and cheap to scan for. */
  headerMarkers: ['Auftragskonto', 'Betrag'],
  /** `Kategorie` is not one: the 17-column shape does not carry it. */
  requiredColumns: ['Auftragskonto', 'Buchungstag', 'Betrag', 'Waehrung', 'Info'],
  accountIban: { from: 'column', column: 'Auftragskonto' },
  columns: {
    bookingDate: 'Buchungstag',
    valueDate: 'Valutadatum',
    bookingText: 'Buchungstext',
    purpose: 'Verwendungszweck',
    creditorId: 'Glaeubiger ID',
    mandateRef: 'Mandatsreferenz',
    endToEndRef: 'Kundenreferenz (End-to-End)',
    counterpartyName: 'Beguenstigter/Zahlungspflichtiger',
    counterpartyIban: 'Kontonummer/IBAN',
    counterpartyBic: 'BIC (SWIFT-Code)',
    amount: 'Betrag',
    currency: 'Waehrung',
    bankCategory: 'Kategorie',
  },
  status: {
    column: 'Info',
    /** The only two `Info` values attested in a V8 export. */
    byValue: new Map<string, BookingStatus>([
      ['Umsatz gebucht', 'booked'],
      ['Umsatz vorgemerkt', 'pending'],
    ]),
  },
  delimiter: ';',
  parseAmount: parseGermanAmount,
  parseDate: parseGermanDate,
};
