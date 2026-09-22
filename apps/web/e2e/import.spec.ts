import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/sparkasse-camt-18.csv',
);

/** `-832,90 €` separates the amount from the € with U+00A0, not a space. */
const plain = (text: string): string => text.replaceAll('\u00a0', ' ');

/**
 * The whole slice, end to end: a Windows-1252 file picked in a browser, decoded in the
 * API, stored in SQLite and rendered back. No unit test covers that path — core cannot
 * decode bytes and the API never renders.
 *
 * Serial, and in one file: the second case is "upload the same file again", which only
 * means anything after the first one ran.
 */
test.describe.serial('CSV import', () => {
  test('imports a Sparkasse export and shows the transactions', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('heading', { name: 'Konto anlegen' }).waitFor();
    await page.getByLabel('IBAN').fill('DE89370400440532013000');
    await page.getByLabel('Bezeichnung').fill('Giro');
    await page.getByRole('button', { name: 'Anlegen' }).click();

    await page.getByLabel('CSV-Datei auswählen').setInputFiles(FIXTURE);

    await expect(page.getByText(/8 importiert/)).toBeVisible();
    // A surprise utf-8 here would mean the bank changed its export format.
    await expect(page.getByText('windows-1252')).toBeVisible();

    // The umlaut survived cp1252 bytes → TextDecoder → SQLite → JSON → the DOM.
    await expect(page.getByRole('cell', { name: 'Müller GmbH' })).toBeVisible();
    await expect(page.getByText('Hauptstraße 12')).toBeVisible();

    const amount = await page.getByRole('cell', { name: /832,90/ }).textContent();
    expect(plain(amount ?? '')).toBe('-832,90 €');

    // The pending row is shown and labelled, not hidden.
    await expect(page.getByLabel('vorgemerkt')).toBeVisible();

    // Two genuinely distinct purchases, not one collapsed row.
    await expect(page.getByRole('cell', { name: 'REWE SAGT DANKE; FILIALE 42' })).toHaveCount(2);
  });

  test('a second upload of the same file imports nothing and says so', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel('CSV-Datei auswählen').setInputFiles(FIXTURE);

    await expect(page.getByText(/0 importiert/)).toBeVisible();
    await expect(page.getByText('Diese Datei wurde bereits einmal hochgeladen.')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'REWE SAGT DANKE; FILIALE 42' })).toHaveCount(2);
  });
});
