import { expect, test } from '@playwright/test';

import { FIXTURE, ledgerRow, plain } from './support';

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
    await page.goto('/transactions');

    // The first spec to run meets an empty database: the page offers an account first.
    await page.getByRole('main').getByRole('button', { name: 'Konto anlegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'CSV importieren' });
    await dialog.getByLabel('IBAN').fill('DE89370400440532013000');
    await dialog.getByLabel('Bezeichnung').fill('Giro');
    await dialog.getByRole('button', { name: 'Anlegen' }).click();

    await dialog.getByLabel('CSV-Datei auswählen').setInputFiles(FIXTURE);

    await expect(dialog.getByText(/8 importiert/)).toBeVisible();
    // A surprise utf-8 here would mean the bank changed its export format.
    await expect(dialog.getByText('windows-1252')).toBeVisible();
    await dialog.getByRole('button', { name: 'Schließen' }).click();

    // The umlaut survived cp1252 bytes → TextDecoder → SQLite → JSON → the DOM.
    await expect(ledgerRow(page, 'Müller GmbH')).toBeVisible();
    await expect(page.getByText(/Hauptstraße 12/)).toBeVisible();

    const amount = await ledgerRow(page, 'Müller GmbH')
      .getByText(/832,90/)
      .textContent();
    expect(plain(amount ?? '')).toBe('-832,90 €');

    // The pending row is shown and labelled, not hidden.
    await expect(page.getByRole('main').getByText('vorgemerkt', { exact: true })).toBeVisible();

    // Two genuinely distinct purchases, not one collapsed row.
    await expect(ledgerRow(page, 'REWE SAGT DANKE; FILIALE 42')).toHaveCount(2);
  });

  test('a second upload of the same file imports nothing and says so', async ({ page }) => {
    await page.goto('/transactions');
    await page.getByRole('button', { name: 'Importieren' }).click();
    const dialog = page.getByRole('dialog', { name: 'CSV importieren' });

    await dialog.getByLabel('CSV-Datei auswählen').setInputFiles(FIXTURE);

    await expect(dialog.getByText(/0 importiert/)).toBeVisible();
    await expect(dialog.getByText('Diese Datei wurde bereits einmal hochgeladen.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Schließen' }).click();
    await expect(ledgerRow(page, 'REWE SAGT DANKE; FILIALE 42')).toHaveCount(2);
  });
});
