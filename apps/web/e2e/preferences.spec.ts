import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Page, test } from '@playwright/test';

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/sparkasse-camt-18.csv',
);

/** `-832,90 €` separates the amount from the € with U+00A0, not a space. */
const plain = (text: string): string => text.replaceAll('\u00a0', ' ');

/** MUI's `background.default`, which CssBaseline paints on `body`, in each scheme. */
const LIGHT_BACKGROUND = 'rgb(255, 255, 255)';
const DARK_BACKGROUND = 'rgb(18, 18, 18)';

/**
 * The two preferences in the shared header. Each test starts from a fresh browser context,
 * so empty storage is a first visit.
 */
test.describe('theme', () => {
  test.use({ colorScheme: 'light' });

  for (const path of ['/', '/rules']) {
    test(`switches to dark and keeps it across a reload, on ${path}`, async ({ page }) => {
      await page.goto(path);
      const body = page.locator('body');

      await expect(body).toHaveCSS('background-color', LIGHT_BACKGROUND);
      await page.getByRole('button', { name: 'Dunkles Design' }).click();
      await expect(body).toHaveCSS('background-color', DARK_BACKGROUND);

      // `noSsr` reads the stored scheme on the first render; the assertion retries anyway,
      // since the page is still loading when it starts.
      await page.reload();
      await expect(body).toHaveCSS('background-color', DARK_BACKGROUND);
      await expect(page.getByRole('button', { name: 'Helles Design' })).toBeVisible();
    });
  }
});

test.describe('theme on a dark OS', () => {
  test.use({ colorScheme: 'dark' });

  test('follows the OS on a first visit', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('body')).toHaveCSS('background-color', DARK_BACKGROUND);
    await expect(page.getByRole('button', { name: 'Helles Design' })).toBeVisible();
  });
});

/**
 * An account with the fixture's rows in it. The other specs share this database and may
 * have done it already; re-importing the same file is a no-op by design.
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

  if ((await page.getByRole('cell', { name: 'Müller GmbH' }).count()) === 0) {
    await page.getByLabel('CSV-Datei auswählen').setInputFiles(FIXTURE);
    await expect(page.getByText(/importiert/)).toBeVisible();
  }
  await expect(page.getByRole('cell', { name: 'Müller GmbH' })).toBeVisible();
}

test.describe('language', () => {
  test('switches every word without a reload, keeps amounts and dates German, and persists', async ({
    page,
  }) => {
    await withTransactions(page);
    const nav = page.getByRole('navigation');

    await expect(nav.getByRole('link', { name: 'Umsätze' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'CSV importieren' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');

    await page.getByRole('button', { name: 'EN', exact: true }).click();

    await expect(nav.getByRole('link', { name: 'Transactions' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Import CSV' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    // Words switch; the statement's numbers do not (plan 07, decision 1).
    const row = page.getByRole('row').filter({ hasText: 'Müller GmbH' });
    await expect(row.getByRole('cell').first()).toHaveText(/^\d{2}\.\d{2}\.\d{4}$/u);
    const amount = await row.getByRole('cell', { name: /832,90/ }).textContent();
    expect(plain(amount ?? '')).toBe('-832,90 €');

    // The other two pages speak it too, reached by the (English) nav.
    await nav.getByRole('link', { name: 'Rules' }).click();
    await expect(page.getByRole('button', { name: 'Apply rules' })).toBeVisible();
    const wohnen = page.getByText('Wohnen', { exact: true });
    if (!(await wohnen.first().isVisible())) {
      await page.getByLabel('Name').fill('Wohnen');
      await page.getByRole('button', { name: 'Add category' }).click();
    }
    await page.getByRole('button', { name: 'Add rule' }).click();
    await expect(page.getByRole('combobox', { name: 'Operator' })).toHaveText('contains');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await nav.getByRole('link', { name: 'Budgets' }).click();
    await expect(page.getByText('Spending by category', { exact: true })).toBeVisible();
    await expect(page.getByText(/ of (—|\d)/u)).toBeVisible();

    await nav.getByRole('link', { name: 'Transactions' }).click();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Import CSV' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.getByRole('button', { name: 'DE', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'CSV importieren' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Umsätze' })).toBeVisible();
  });
});
