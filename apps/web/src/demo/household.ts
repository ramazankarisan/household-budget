/**
 * The synthetic household behind the README images and the hosted demo (plan 12): six
 * months of one Sparkasse Girokonto, invented from top to bottom. Never a real statement.
 *
 * Plain data and no I/O, so both a Playwright capture in Node and the demo build in the
 * browser can use it: the capture writes it out as a CSV, the demo loads it as rows.
 */

export const DEMO_IBAN = 'DE89370400440532013000';
export const DEMO_ACCOUNT_NAME = 'Giro';
export const DEMO_FILE_NAME = 'Umsaetze-2026.csv';

export interface Booking {
  /** `'YYYY-MM-DD'`. */
  readonly date: string;
  readonly text: string;
  readonly purpose: string;
  readonly payee: string;
  readonly cents: number;
}

/** The last day the export covers. Rows after it in its month are not booked yet. */
export interface ExportDay {
  readonly year: number;
  /** 1–12. */
  readonly month: number;
  readonly day: number;
}

/** Deterministic, so the images only change when the UI does. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/** `'YYYY-MM'` for `offset` months after `year`-`month` (negative goes back). */
export function shiftMonth(year: number, month: number, offset: number): string {
  const index = year * 12 + (month - 1) + offset;
  return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Six months up to and including `end`, newest booking first: what an export on that day holds. */
export function bookings(end: ExportDay): Booking[] {
  const next = random(7);
  const rows: Booking[] = [];
  const lastMonth = shiftMonth(end.year, end.month, 0);

  for (let offset = -5; offset <= 0; offset += 1) {
    const month = shiftMonth(end.year, end.month, offset);
    const add = (day: number, text: string, purpose: string, payee: string, cents: number) => {
      if (month === lastMonth && day > end.day) {
        return;
      }
      rows.push({ date: `${month}-${String(day).padStart(2, '0')}`, text, purpose, payee, cents });
    };
    // Every amount is drawn whether or not its row survives the cut-off, so the same months
    // hold the same amounts on whatever day the export is taken.
    const vary = (base: number, spread: number) => -(base + Math.round(next() * spread));

    add(1, 'DAUERAUFTRAG', 'Miete Hauptstraße 12', 'Hausverwaltung Süd GmbH', -115_000);
    add(3, 'LASTSCHRIFT', 'Abschlag Strom', 'Stadtwerke Musterstadt', -8_400);
    add(5, 'LASTSCHRIFT', 'Mobilfunk', 'Telekom Deutschland GmbH', -3_995);
    add(8, 'LASTSCHRIFT', 'Abo', 'Netflix International B.V.', -1_399);
    // Written out the way SEPA text often is: the rule `Bäckerei` still finds it.
    for (const day of [2, 6, 9, 13, 16, 20, 23, 27]) {
      add(day, 'KARTENZAHLUNG', 'Einkauf Lebensmittel', 'REWE SAGT DANKE', vary(3_500, 5_000));
      if (next() < 0.6) {
        add(day, 'KARTENZAHLUNG', 'Einkauf', 'BAECKEREI SCHMIDT', vary(450, 900));
      }
    }
    add(11, 'KARTENZAHLUNG', 'Tanken', 'Aral Station 0815', vary(5_500, 2_500));
    add(18, 'KARTENZAHLUNG', 'Restaurant', 'Trattoria Da Marco', vary(3_800, 4_000));
    if (Number(month.slice(5)) % 2 === 0) {
      add(21, 'SEPA-UEBERWEISUNG', 'Fahrkarte', 'DB Fernverkehr AG', vary(4_990, 6_000));
    }
    add(15, 'KARTENZAHLUNG', 'Apotheke', 'Stern-Apotheke', vary(1_200, 2_000));
    add(27, 'LOHN/GEHALT', 'Gehalt', 'Beispiel AG', 295_000);
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Category name → [rules typed as the user knows the payee, monthly limit in cents]. A limit
 * of 0 means no limit is set at all, not a limit of nothing.
 */
export const DEMO_SETUP: ReadonlyArray<readonly [string, readonly string[], number]> = [
  ['Wohnen', ['Hausverwaltung', 'Stadtwerke'], 125_000],
  ['Lebensmittel', ['REWE', 'Bäckerei'], 50_000],
  ['Verträge', ['Telekom', 'Netflix'], 6_000],
  ['Mobilität', ['Aral', 'DB Fernverkehr'], 15_000],
  ['Freizeit', ['Trattoria'], 6_000],
  ['Gesundheit', ['Apotheke'], 3_000],
  // No rule on purpose: the salary is sorted by hand, which is where „Immer so“ comes in.
  ['Einkommen', [], 0],
];

/** The months the limits are set for: the export's last three. */
export function budgetMonths(end: ExportDay): string[] {
  return [-2, -1, 0].map((offset) => shiftMonth(end.year, end.month, offset));
}
