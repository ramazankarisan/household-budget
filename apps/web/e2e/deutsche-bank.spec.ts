import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { ledgerRow, plain } from './support';

/** The export as Deutsche Bank ships it: UTF-8 with BOM, LF, seven preamble lines, a footer. */
const DEUTSCHE_BANK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/deutsche-bank.csv',
);

/**
 * A second bank, end to end: the header decides the parser, not the user. Runs in its own
 * Playwright project after every other spec (see playwright.config.ts), because it adds a
 * second account and rows in another month to the e2e.db the Sparkasse specs count on.
 */
test('imports a Deutsche Bank export into its own account', async ({ page }) => {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Importieren' }).click();
  const dialog = page.getByRole('dialog', { name: 'CSV importieren' });

  await dialog.getByRole('button', { name: 'Konto anlegen' }).click();
  await dialog.getByLabel('IBAN').fill('DE91100000000123456789');
  await dialog.getByLabel('Bezeichnung').fill('Deutsche Bank Giro');
  await dialog.getByRole('button', { name: 'Anlegen' }).click();

  await dialog.getByLabel('CSV-Datei auswählen').setInputFiles(DEUTSCHE_BANK);

  await expect(dialog.getByText(/8 importiert/u)).toBeVisible();
  await expect(dialog.getByText('Deutsche Bank', { exact: true })).toBeVisible();
  await expect(dialog.getByText('utf-8', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen' }).click();

  await page.goto('/transactions?m=2026-09');
  // UTF-8 bytes → TextDecoder → SQLite → JSON → DOM, with a bare quote the bank never escapes.
  await expect(ledgerRow(page, 'Hotel "Nord" GmbH')).toBeVisible();
  const amount = await ledgerRow(page, 'Müller GmbH')
    .getByText(/832,90/u)
    .textContent();
  expect(plain(amount ?? '')).toBe('-832,90 €');
  await expect(ledgerRow(page, 'REWE Markt GmbH')).toHaveCount(2);
});
