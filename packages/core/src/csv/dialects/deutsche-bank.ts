/**
 * Deutsche Bank Umsatzanzeige, the current export (2024 onwards; Postbank's platform).
 * UTF-8 with BOM, LF, `;`, never quoted. Seven preamble lines naming the own IBAN, the
 * header on line 8, one `Kontostand` footer line. No status column: vorgemerkte Umsätze
 * are not exported at all. `Betrag` is signed; `Soll`/`Haben` repeat it and are ignored.
 *
 * The older export (own platform, until about 2024) is deliberately not recognised: it
 * leaves `Betrag` empty and names no IBAN. Its header says `IBAN` where this one says
 * `IBAN / Kontonummer`, which is why that is a marker — an old file then fails as
 * `HEADER_NOT_FOUND` instead of importing as one row error per line.
 * Format research: `docs/research/07-deutsche-bank-csv.md`.
 */
import { parseGermanAmount, parseGermanDate } from '../fields.js';
import type { BankDialect } from './types.js';

export const deutscheBank: BankDialect = {
  id: 'deutsche-bank',
  headerMarkers: ['Buchungstag', 'Umsatzart', 'Begünstigter / Auftraggeber', 'IBAN / Kontonummer'],
  requiredColumns: ['Buchungstag', 'Betrag', 'Währung'],
  accountIban: { from: 'preamble', label: 'IBAN' },
  columns: {
    bookingDate: 'Buchungstag',
    valueDate: 'Wert',
    bookingText: 'Umsatzart',
    counterpartyName: 'Begünstigter / Auftraggeber',
    purpose: 'Verwendungszweck',
    counterpartyIban: 'IBAN / Kontonummer',
    counterpartyBic: 'BIC',
    endToEndRef: 'Kundenreferenz',
    mandateRef: 'Mandatsreferenz',
    creditorId: 'Gläubiger ID',
    amount: 'Betrag',
    currency: 'Währung',
  },
  footerMarker: 'Kontostand',
  delimiter: ';',
  neverQuoted: true,
  // `D.M.YYYY` without leading zeros, and trailing-zero truncation (`750`, `-100,8`) —
  // both already what the Sparkasse parsers accept.
  parseAmount: parseGermanAmount,
  parseDate: parseGermanDate,
};
