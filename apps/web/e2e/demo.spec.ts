import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import { build } from 'vite';

import { categoryPill, ledgerRow } from './support';

/**
 * The hosted demo (plan 12), against `vite preview` of `build:demo` — the files GitHub Pages
 * serves. The real UI over the in-memory client: no request may leave for `/api`, because
 * there is no API behind this build and there must never need to be one.
 *
 * Its own project with its own server; relative paths resolve under `/household-budget/`.
 */
const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The other half of the promise: the real app's build must not carry the demo. The import
 * rule in `.dependency-cruiser.cjs` cannot see the Vite plugin that does the swap, so this
 * builds the real app and reads what it would ship.
 */
test('the real build has neither the demo client nor its banner', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'household-budget-real-'));
  try {
    await build({ root: WEB_ROOT, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    const assets = join(outDir, 'assets');
    const code = readdirSync(assets)
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFileSync(join(assets, name), 'utf8'))
      .join('\n');
    expect(code).toContain('/api');
    expect(code).not.toContain('demo-tx-');
    // The banner's link; its words live in the locales, which every build carries.
    expect(code).not.toContain('#run-it-locally');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test.describe('hosted demo', () => {
  const apiCalls: string[] = [];

  test.beforeEach(({ page }) => {
    apiCalls.length = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.includes('/api/')) {
        apiCalls.push(request.url());
      }
    });
  });

  test.afterEach(() => {
    expect(apiCalls).toEqual([]);
  });

  test('opens on a month already answered, with the banner', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByText('Erfundene Beispieldaten', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Budgets nach Kategorie' })).toBeVisible();
  });

  test('a deep link loads its page', async ({ page }) => {
    // `vite preview` falls back to index.html by itself; GitHub Pages serves 404.html.
    expect(existsSync(join(WEB_ROOT, 'dist/demo/404.html'))).toBe(true);
    await page.goto('rules');
    await expect(page.getByRole('list', { name: 'Regeln' })).toBeVisible();
  });

  test('a rule written here categorizes in the browser', async ({ page }) => {
    await page.goto('rules');
    const composer = page.getByRole('region', { name: 'Neue Regel' });
    await composer.getByLabel('Suchbegriff').fill('Beispiel AG');
    await composer.getByRole('combobox', { name: 'Kategorie' }).click();
    await page.getByRole('option', { name: 'Freizeit' }).click();
    await composer.getByRole('button', { name: 'Regel anlegen' }).click();
    await page.getByRole('button', { name: 'Regeln anwenden' }).click();
    await expect(page.getByText(/zugeordnet/u)).toBeVisible();

    await page.getByRole('navigation').getByRole('link', { name: 'Umsätze' }).click();
    await expect(categoryPill(ledgerRow(page, 'Beispiel AG').first())).toHaveText('Freizeit');
  });

  test('an upload is refused with a sentence, not a network error', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('button', { name: 'Importieren' }).click();
    const dialog = page.getByRole('dialog', { name: 'CSV importieren' });
    await dialog.getByLabel('CSV-Datei auswählen').setInputFiles({
      name: 'statement.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('x'),
    });
    await expect(dialog.getByText(/Die Demo liest keine Dateien/u)).toBeVisible();
  });
});
