import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { FIXTURE, ledgerRow, withFixture } from './support';

/**
 * Importing from anywhere: the history of what went up, and a file dropped on any page.
 * The fixture is already stored by the time this runs, so each upload here is the no-op
 * re-import — it changes no row the other specs look at, and it is still a batch.
 */
test('lists past imports, newest first, with what each brought', async ({ page }) => {
  await withFixture(page);

  await page.getByRole('navigation').getByRole('link', { name: 'Importe' }).click();

  const history = page.getByRole('list', { name: 'Bisherige Importe' });
  await expect(history).toBeVisible();
  const first = history.getByRole('listitem').first();
  await expect(first).toContainText('sparkasse-camt-18.csv');
  await expect(first).toContainText(/\d+ neu · \d+ übersprungen/u);
  await expect(first).toContainText('windows-1252');
});

test('a file dropped on any page opens the import with it', async ({ page }) => {
  await withFixture(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Regeln' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Importe' }).click();
  const history = page.getByRole('list', { name: 'Bisherige Importe' });
  await expect(history).toBeVisible();
  const before = await history.getByRole('listitem').count();

  // A real drag from the desktop cannot be scripted; the same events with the same file can.
  const bytes = readFileSync(FIXTURE).toString('base64');
  const transfer = await page.evaluateHandle((base64) => {
    const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([data], 'sparkasse-camt-18.csv', { type: 'text/csv' }));
    return dt;
  }, bytes);
  await page.dispatchEvent('main', 'dragenter', { dataTransfer: transfer });
  await expect(page.getByText('Datei loslassen zum Importieren')).toBeVisible();
  await page.dispatchEvent('main', 'drop', { dataTransfer: transfer });

  const dialog = page.getByRole('dialog', { name: 'CSV importieren' });
  await expect(dialog.getByText(/0 importiert/u)).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen' }).click();

  // The history is reloaded with the household: the new batch is on it without a reload.
  await expect(history.getByRole('listitem')).toHaveCount(before + 1);
});

test('an upload can be removed, and „Rückgängig“ brings its rows back', async ({ page }) => {
  await withFixture(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Importe' }).click();
  // The oldest upload is the one that brought the fixture's rows; later ones were no-ops.
  const oldest = page.getByRole('list', { name: 'Bisherige Importe' }).getByRole('listitem').last();
  await expect(oldest).toContainText(/[1-9]\d* neu/u);

  await oldest.getByRole('button', { name: 'Import „sparkasse-camt-18.csv“ entfernen' }).click();

  await expect(page.getByText('Import „sparkasse-camt-18.csv“ entfernt')).toBeVisible();
  await expect(oldest).toContainText('Entfernt');
  await expect(oldest.getByRole('button', { name: /entfernen$/u })).toHaveCount(0);

  await page.getByRole('button', { name: 'Rückgängig' }).click();

  await expect(oldest).not.toContainText('Entfernt');
  await page.getByRole('navigation').getByRole('link', { name: 'Umsätze' }).click();
  await expect(ledgerRow(page, 'Müller GmbH')).toBeVisible();
});
