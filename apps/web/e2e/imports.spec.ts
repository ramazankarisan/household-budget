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

test('the newest upload can be removed, and „Rückgängig“ brings it back', async ({ page }) => {
  await withFixture(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Importe' }).click();
  const uploads = page.getByRole('list', { name: 'Bisherige Importe' }).getByRole('listitem');
  const newest = uploads.first();
  const remove = /^Import „sparkasse-camt-18\.csv“ entfernen$/u;
  // Newest first: an older upload may own rows a later file skipped, so only the top one offers it.
  await expect(uploads.last().getByRole('button', { name: remove })).toHaveCount(0);

  await newest.getByRole('button', { name: remove }).click();

  await expect(page.getByText('Import „sparkasse-camt-18.csv“ entfernt')).toBeVisible();
  await expect(newest).toContainText('Entfernt');
  await expect(newest.getByRole('button', { name: remove })).toHaveCount(0);

  await page.getByRole('button', { name: 'Rückgängig' }).click();

  await expect(newest).not.toContainText('Entfernt');
  await expect(newest.getByRole('button', { name: remove })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Umsätze' }).click();
  await expect(ledgerRow(page, 'Müller GmbH')).toBeVisible();
});
