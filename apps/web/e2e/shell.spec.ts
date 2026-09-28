import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Page, test } from '@playwright/test';

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/sparkasse-camt-18.csv',
);

/**
 * An account with the fixture's rows. The other specs share this database and may have
 * done it already; re-importing the same file is a no-op by design.
 */
async function withTransactions(page: Page): Promise<void> {
  await page.goto('/');
  const createAccount = page.getByRole('heading', { name: 'Konto anlegen' });
  await expect(
    createAccount.or(page.getByRole('heading', { name: 'CSV importieren' })),
  ).toBeVisible();

  if (await createAccount.isVisible()) {
    await page.getByLabel('IBAN').fill('DE89370400440532013000');
    await page.getByLabel('Bezeichnung').fill('Giro');
    await page.getByRole('button', { name: 'Anlegen' }).click();
  }
  await page.getByLabel('CSV-Datei auswählen').setInputFiles(FIXTURE);
  await expect(page.getByText(/importiert/u)).toBeVisible();
}

const stepper = (page: Page) => page.getByRole('button', { name: /^Monat wählen/u });

test.describe('the month in the URL', () => {
  test('[ and ] step it, and the back button undoes a step', async ({ page }) => {
    await withTransactions(page);
    await page.goto('/budgets?m=2025-09');
    await expect(stepper(page)).toHaveText('September 2025');

    // The fixture's months are September 2025 and March 2014, nothing between.
    await page.keyboard.press('[');
    await expect(page).toHaveURL(/\?m=2014-03$/u);
    await expect(stepper(page)).toHaveText('März 2014');

    await page.keyboard.press(']');
    await expect(page).toHaveURL(/\?m=2025-09$/u);

    await page.goBack();
    await expect(stepper(page)).toHaveText('März 2014');
  });

  test('travels with the nav', async ({ page }) => {
    await withTransactions(page);
    await page.goto('/budgets?m=2014-03');

    await page.getByRole('navigation').getByRole('link', { name: 'Umsätze' }).click();

    await expect(page).toHaveURL(/\/\?m=2014-03$/u);
    await expect(stepper(page)).toHaveText('März 2014');
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('has a bottom bar, „Mehr“ for the rest, and no sideways scroll', async ({ page }) => {
    await withTransactions(page);

    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
    await expect(nav.getByRole('link', { name: 'Regeln' })).toBeVisible();
    await nav.getByRole('button', { name: 'Mehr' }).click();
    await expect(page.getByRole('group', { name: 'Sprache' })).toBeVisible();
    await page.keyboard.press('Escape');

    for (const path of ['/', '/rules', '/budgets']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, path).toBeLessThanOrEqual(390);
    }
  });
});
