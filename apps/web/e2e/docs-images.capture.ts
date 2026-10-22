import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type APIRequestContext, type Page, test } from '@playwright/test';

import {
  bookings,
  budgetMonths,
  DEMO_ACCOUNT_NAME,
  DEMO_FILE_NAME,
  DEMO_IBAN,
  DEMO_SETUP,
} from '../src/demo/household';

/**
 * Regenerates the README's screenshots and its animated demo: `pnpm docs:images`.
 *
 * Not part of the suite: a `.capture.ts` file, run only by the `docs-images` project, which
 * exists only with `CAPTURE=1`. The data is the synthetic six-month Sparkasse household the
 * hosted demo also loads (`src/demo/household.ts`), written out as a CSV here: never a real
 * statement, and never written to `fixtures/` or committed — the images are the only output.
 */

const IMAGES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/images');
/** The day the export is taken: fixed, so the images only change when the UI does. */
const EXPORT_DAY = { year: 2026, month: 10, day: 20 };

const HEADER =
  'Auftragskonto;"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";' +
  '"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";' +
  '"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";' +
  '"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info";"Kategorie"';

function amount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100).toLocaleString('de-DE');
  return `${sign}${euros},${String(abs % 100).padStart(2, '0')}`;
}

function demoCsv(): string {
  const quote = (value: string) => `"${value}"`;
  const lines = bookings(EXPORT_DAY).map((row) => {
    // `2026-10-20` → `20.10.26`, as the bank writes it.
    const date = row.date.slice(2).split('-').reverse().join('.');
    return [
      DEMO_IBAN,
      ...[
        date,
        date,
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
    ].join(';');
  });
  return [HEADER, ...lines].join('\r\n') + '\r\n';
}

async function seedRulesAndBudgets(request: APIRequestContext): Promise<void> {
  for (const [name, keywords, limit] of DEMO_SETUP) {
    const category = (await (await request.post('/api/categories', { data: { name } })).json()) as {
      id: string;
    };
    for (const value of keywords) {
      await request.post('/api/rules', {
        data: { field: 'counterpartyName', operator: 'contains', value, categoryId: category.id },
      });
    }
    for (const m of budgetMonths(EXPORT_DAY)) {
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
  const csv = testInfo.outputPath(DEMO_FILE_NAME);
  writeFileSync(csv, demoCsv());

  // 1. First run, then the import: account, file, result.
  await page.goto('/');
  await frame(page, frames, framesDir);
  await page.getByRole('button', { name: 'Importieren' }).click();
  const dialog = page.getByRole('dialog', { name: 'CSV importieren' });
  await dialog.getByLabel('IBAN').fill(DEMO_IBAN);
  await dialog.getByLabel('Bezeichnung').fill(DEMO_ACCOUNT_NAME);
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
  await expect(page.getByText(DEMO_FILE_NAME)).toBeVisible();
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
