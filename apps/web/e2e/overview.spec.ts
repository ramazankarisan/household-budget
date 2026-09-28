import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Page, test } from '@playwright/test';

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/sparkasse-camt-18.csv',
);

/**
 * An account with the fixture's rows and a `Wohnen` category. The other specs share this
 * database and may have done both already; each step only runs when it is missing.
 */
async function seed(page: Page): Promise<void> {
  await page.goto('/transactions');
  const createAccount = page.getByRole('heading', { name: 'Konto anlegen' });
  await expect(
    createAccount.or(page.getByRole('heading', { name: 'CSV importieren' })),
  ).toBeVisible();
  if (await createAccount.isVisible()) {
    await page.getByLabel('IBAN').fill('DE89370400440532013000');
    await page.getByLabel('Bezeichnung').fill('Giro');
    await page.getByRole('button', { name: 'Anlegen' }).click();
  }
  if ((await page.getByRole('cell', { name: 'Müller GmbH' }).count()) === 0) {
    await page.getByLabel('CSV-Datei auswählen').setInputFiles(FIXTURE);
    await expect(page.getByText(/importiert/u)).toBeVisible();
  }

  await page.getByRole('link', { name: 'Regeln' }).click();
  const wohnen = page.getByText('Wohnen', { exact: true });
  await expect(page.getByRole('heading', { name: 'Kategorien' })).toBeVisible();
  if (!(await wohnen.first().isVisible())) {
    await page.getByLabel('Name').fill('Wohnen');
    await page.getByRole('button', { name: 'Kategorie anlegen' }).click();
  }
  await expect(wohnen.first()).toBeVisible();
}

/** The number on the „Zu sortieren“ card. */
async function toSort(page: Page): Promise<number> {
  const card = page.getByRole('link', { name: /Zu sortieren: \d+/u });
  await expect(card).toBeVisible();
  const text = await card.innerText();
  return Number(/Zu sortieren: (\d+)/u.exec(text)?.[1] ?? 'NaN');
}

test('a category set on the list is on Überblick without a reload', async ({ page }) => {
  await seed(page);
  await page.getByRole('link', { name: 'Überblick' }).click();
  const before = await toSort(page);

  await page.getByRole('link', { name: 'Umsätze' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Hausverwaltung Süd GmbH' });
  await row.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Wohnen' }).click();
  await expect(row.getByLabel('von Hand gesetzt — Regeln ändern das nicht')).toBeVisible();

  // Client-side navigation: the household is the same copy the list just changed.
  await page.getByRole('link', { name: 'Überblick' }).click();
  expect(await toSort(page)).toBe(before - 1);

  // Put the row back as the other specs expect it: no category, no lock.
  await page.getByRole('link', { name: 'Umsätze' }).click();
  await row.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Kategorie entfernen' }).click();
  await expect(row.getByLabel('von Hand gesetzt — Regeln ändern das nicht')).toHaveCount(0);
});

test('fits a phone without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Budgets nach Kategorie' })).toBeVisible();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
});
