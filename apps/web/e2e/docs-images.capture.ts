import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type APIRequestContext, type Page, test } from '@playwright/test';

/**
 * Regenerates the README's screenshots and its animated demo: `pnpm docs:images`.
 *
 * Not part of the suite: a `.capture.ts` file, run only by the `docs-images` project, which
 * exists only with `CAPTURE=1`. The data is a synthetic six-month Sparkasse export built
 * below, never a real statement, and never written to `fixtures/` or committed — the images
 * are the only output.
 */

const IMAGES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/images');
const IBAN = 'DE89370400440532013000';

const HEADER =
  'Auftragskonto;"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";' +
  '"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";' +
  '"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";' +
  '"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info";"Kategorie"';

interface Booking {
  readonly date: string;
  readonly text: string;
  readonly purpose: string;
  readonly payee: string;
  readonly cents: number;
}

/** Deterministic, so the images only change when the UI does. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/** May to October 2026, up to the 20th of the last month: what an export on that day holds. */
function bookings(): Booking[] {
  const next = random(7);
  const rows: Booking[] = [];
  const add = (
    month: number,
    day: number,
    text: string,
    purpose: string,
    payee: string,
    cents: number,
  ) => {
    if (month === 10 && day > 20) {
      return;
    }
    rows.push({
      date: `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.26`,
      text,
      purpose,
      payee,
      cents,
    });
  };
  for (let month = 5; month <= 10; month += 1) {
    add(month, 1, 'DAUERAUFTRAG', 'Miete Hauptstraße 12', 'Hausverwaltung Süd GmbH', -115_000);
    add(month, 3, 'LASTSCHRIFT', 'Abschlag Strom', 'Stadtwerke Musterstadt', -8_400);
    add(month, 5, 'LASTSCHRIFT', 'Mobilfunk', 'Telekom Deutschland GmbH', -3_995);
    add(month, 8, 'LASTSCHRIFT', 'Abo', 'Netflix International B.V.', -1_399);
    // Written out the way SEPA text often is: the rule `Bäckerei` still finds it.
    for (const day of [2, 6, 9, 13, 16, 20, 23, 27]) {
      add(
        month,
        day,
        'KARTENZAHLUNG',
        'Einkauf Lebensmittel',
        'REWE SAGT DANKE',
        -(3_500 + Math.round(next() * 5_000)),
      );
      if (next() < 0.6) {
        add(
          month,
          day,
          'KARTENZAHLUNG',
          'Einkauf',
          'BAECKEREI SCHMIDT',
          -(450 + Math.round(next() * 900)),
        );
      }
    }
    add(
      month,
      11,
      'KARTENZAHLUNG',
      'Tanken',
      'Aral Station 0815',
      -(5_500 + Math.round(next() * 2_500)),
    );
    add(
      month,
      18,
      'KARTENZAHLUNG',
      'Restaurant',
      'Trattoria Da Marco',
      -(3_800 + Math.round(next() * 4_000)),
    );
    if (month % 2 === 0) {
      add(
        month,
        21,
        'SEPA-UEBERWEISUNG',
        'Fahrkarte',
        'DB Fernverkehr AG',
        -(4_990 + Math.round(next() * 6_000)),
      );
    }
    add(
      month,
      15,
      'KARTENZAHLUNG',
      'Apotheke',
      'Stern-Apotheke',
      -(1_200 + Math.round(next() * 2_000)),
    );
    add(month, 27, 'LOHN/GEHALT', 'Gehalt', 'Beispiel AG', 295_000);
  }
  return rows.sort((a, b) =>
    b.date.split('.').reverse().join().localeCompare(a.date.split('.').reverse().join()),
  );
}

function amount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100).toLocaleString('de-DE');
  return `${sign}${euros},${String(abs % 100).padStart(2, '0')}`;
}

function demoCsv(): string {
  const quote = (value: string) => `"${value}"`;
  const lines = bookings().map((row) =>
    [
      IBAN,
      ...[
        row.date,
        row.date,
        row.text,
        row.purpose,
        '',
        '',
        '',
        '',
        '',
        '',
        row.payee,
        '',
        '',
        amount(row.cents),
        'EUR',
        'Umsatz gebucht',
        '',
      ].map(quote),
    ].join(';'),
  );
  return [HEADER, ...lines].join('\r\n') + '\r\n';
}

/** Category name → [rules typed as the user knows the payee, monthly limit in cents]. */
const SETUP: ReadonlyArray<readonly [string, readonly string[], number]> = [
  ['Wohnen', ['Hausverwaltung', 'Stadtwerke'], 125_000],
  ['Lebensmittel', ['REWE', 'Bäckerei'], 50_000],
  ['Verträge', ['Telekom', 'Netflix'], 6_000],
  ['Mobilität', ['Aral', 'DB Fernverkehr'], 15_000],
  ['Freizeit', ['Trattoria'], 6_000],
  ['Gesundheit', ['Apotheke'], 3_000],
];

async function seedRulesAndBudgets(request: APIRequestContext): Promise<void> {
  const month = '2026-10';
  for (const [name, keywords, limit] of SETUP) {
    const category = (await (await request.post('/api/categories', { data: { name } })).json()) as {
      id: string;
    };
    for (const value of keywords) {
      await request.post('/api/rules', {
        data: { field: 'counterpartyName', operator: 'contains', value, categoryId: category.id },
      });
    }
    for (const m of ['2026-08', '2026-09', month]) {
      await request.put(`/api/budgets/${m}/${category.id}`, { data: { amountCents: limit } });
    }
  }
  await request.post('/api/rules/apply');
}

/** One frame of the demo: the page as it stands, for `img2webp`. */
async function frame(page: Page, frames: string[], dir: string): Promise<void> {
  const path = resolve(dir, `${String(frames.length).padStart(2, '0')}.png`);
  await page.screenshot({ path });
  frames.push(path);
}

/** The frames as one animated WebP, each held for 1.6 s; skipped where img2webp is missing. */
function animate(frames: readonly string[]): void {
  try {
    execFileSync('img2webp', [
      '-loop',
      '0',
      '-lossy',
      '-q',
      '75',
      '-d',
      '1600',
      ...frames,
      '-o',
      resolve(IMAGES, 'demo.webp'),
    ]);
  } catch {
    console.warn('img2webp not found (brew install webp): demo.webp not updated');
  }
}

test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });

test('captures the README images', async ({ page, request }, testInfo) => {
  mkdirSync(IMAGES, { recursive: true });
  const framesDir = testInfo.outputPath('frames');
  mkdirSync(framesDir, { recursive: true });
  const frames: string[] = [];
  const csv = testInfo.outputPath('Umsaetze-2026.csv');
  writeFileSync(csv, demoCsv());

  // 1. First run, then the import: account, file, result.
  await page.goto('/');
  await frame(page, frames, framesDir);
  await page.getByRole('button', { name: 'Importieren' }).click();
  const dialog = page.getByRole('dialog', { name: 'CSV importieren' });
  await dialog.getByLabel('IBAN').fill(IBAN);
  await dialog.getByLabel('Bezeichnung').fill('Giro');
  await dialog.getByRole('button', { name: 'Anlegen' }).click();
  await dialog.getByLabel('CSV-Datei auswählen').setInputFiles(csv);
  await expect(dialog.getByText(/importiert/u)).toBeVisible();
  await frame(page, frames, framesDir);
  await dialog.getByRole('button', { name: 'Schließen' }).click();

  // 2. Nothing sorted yet.
  await page.getByRole('navigation').getByRole('link', { name: 'Umsätze' }).click();
  await expect(page.getByRole('main').getByRole('listitem').first()).toBeVisible();
  await frame(page, frames, framesDir);

  // 3. Rules and limits, then the month answered.
  await seedRulesAndBudgets(request);
  await page.getByRole('navigation').getByRole('link', { name: 'Regeln' }).click();
  await page.reload();
  await expect(page.getByRole('list', { name: 'Regeln' })).toBeVisible();
  await page.getByRole('region', { name: 'Neue Regel' }).getByLabel('Suchbegriff').fill('Apotheke');
  await frame(page, frames, framesDir);
  await page.screenshot({ path: resolve(IMAGES, 'rules.png') });
  await page.getByRole('region', { name: 'Neue Regel' }).getByLabel('Suchbegriff').fill('');

  await page.getByRole('navigation').getByRole('link', { name: 'Überblick' }).click();
  await expect(page.getByRole('figure', { name: 'Verlauf' })).toBeVisible();
  await frame(page, frames, framesDir);
  await page.screenshot({ path: resolve(IMAGES, 'overview.png') });

  await page.getByRole('navigation').getByRole('link', { name: 'Umsätze' }).click();
  await expect(page.getByRole('main').getByRole('listitem').first()).toBeVisible();
  await page.screenshot({ path: resolve(IMAGES, 'transactions.png') });
  await page.getByRole('navigation').getByRole('link', { name: 'Importe' }).click();
  await expect(page.getByText('Umsaetze-2026.csv')).toBeVisible();
  await page.screenshot({ path: resolve(IMAGES, 'imports.png') });

  // 4. The same month in dark, in English, and on a phone.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByRole('figure', { name: 'Verlauf' })).toBeVisible();
  await page.screenshot({ path: resolve(IMAGES, 'overview-dark.png') });
  await frame(page, frames, framesDir);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Budgets by category' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  // Reloaded so the theme settles on light again before the shot, not mid-transition.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Budgets by category' })).toBeVisible();
  await page.screenshot({ path: resolve(IMAGES, 'overview-mobile-en.png') });

  animate(frames);
});
