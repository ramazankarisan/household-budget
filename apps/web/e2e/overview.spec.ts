import { expect, type Page, test } from '@playwright/test';

import { ledgerRow, pickCategory, withFixture, withWohnen } from './support';

/** The number on the „Ohne Kategorie“ card, for the shown month; 0 once that month is done. */
async function toSort(page: Page): Promise<number> {
  const card = page.getByRole('link', { name: /Ohne Kategorie: \d+|: alles kategorisiert/u });
  await expect(card).toBeVisible();
  const text = await card.innerText();
  return Number(/Ohne Kategorie: (\d+)/u.exec(text)?.[1] ?? '0');
}

test('a category set on the list is on Überblick without a reload', async ({ page }) => {
  await withFixture(page);
  await withWohnen(page);
  await page.getByRole('link', { name: 'Überblick' }).click();
  const before = await toSort(page);

  await page.getByRole('link', { name: 'Umsätze' }).click();
  const row = ledgerRow(page, 'Hausverwaltung Süd GmbH');
  await pickCategory(page, row, 'Wohnen');
  await expect(row.getByLabel('von Hand gesetzt — Regeln ändern das nicht')).toBeVisible();

  // Client-side navigation: the household is the same copy the list just changed.
  await page.getByRole('link', { name: 'Überblick' }).click();
  expect(await toSort(page)).toBe(before - 1);

  // Put the row back as the other specs expect it: no category, no lock.
  await page.getByRole('link', { name: 'Umsätze' }).click();
  await pickCategory(page, row, 'Kategorie entfernen');
  await expect(row.getByLabel('von Hand gesetzt — Regeln ändern das nicht')).toHaveCount(0);
});

test('fits a phone without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await withFixture(page);
  await withWohnen(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Budgets nach Kategorie' })).toBeVisible();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
});
