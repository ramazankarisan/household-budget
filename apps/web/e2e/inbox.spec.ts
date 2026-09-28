import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Page, test } from '@playwright/test';

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/sparkasse-camt-18.csv',
);

/**
 * An account with the fixture's rows and a category to sort into. The other specs share
 * this database; each step only runs when what it makes is missing.
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
  await expect(page.getByRole('heading', { name: 'Kategorien' })).toBeVisible();
  const wohnen = page.getByText('Wohnen', { exact: true });
  if (!(await wohnen.first().isVisible())) {
    await page.getByLabel('Name').fill('Wohnen');
    await page.getByRole('button', { name: 'Kategorie anlegen' }).click();
  }
  await expect(wohnen.first()).toBeVisible();
}

/** The number the Sortieren badge shows, read off its link's name: `Sortieren (4)`. */
async function badge(page: Page): Promise<number> {
  const link = page.getByRole('navigation').getByRole('link', { name: /^Sortieren/u });
  const name = (await link.getAttribute('aria-label')) ?? '';
  return Number(/\((\d+)\)/u.exec(name)?.[1] ?? '0');
}

test('sorts a row with a number key, and takes it back with Z', async ({ page }) => {
  await seed(page);
  await page
    .getByRole('navigation')
    .getByRole('link', { name: /^Sortieren/u })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sortieren' })).toBeVisible();

  const before = await badge(page);
  test.skip(before === 0, 'every row in this database is already sorted');
  const card = page.getByRole('article');
  const first = await card.getAttribute('aria-label');

  await page.keyboard.press('1');

  // The proposal, with its reach counted before anything is saved.
  const proposal = page.getByRole('region', { name: 'Regel daraus machen?' });
  await expect(proposal).toBeVisible();
  await expect(proposal.getByRole('status')).toHaveText(/^trifft \d+/u);
  await expect.poll(() => badge(page)).toBe(before - 1);
  await expect(card).not.toHaveAttribute('aria-label', first ?? '');

  // Leave the database as the other specs expect it.
  await page.keyboard.press('Escape');
  await page.keyboard.press('z');
  await expect.poll(() => badge(page)).toBe(before);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('fits without scrolling sideways', async ({ page }) => {
    await seed(page);
    await page.goto('/inbox');

    await expect(page.getByRole('heading', { level: 1, name: 'Sortieren' })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
  });
});
