import { expect, test } from '@playwright/test';

import { ledgerRow, plain, withFixture } from './support';

/** `background.default` (DESIGN.md `bg.canvas`), which CssBaseline paints on `body`. */
const LIGHT_BACKGROUND = 'rgb(246, 245, 241)';
const DARK_BACKGROUND = 'rgb(15, 18, 17)';

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

test.describe('language', () => {
  test('switches every word without a reload, keeps amounts German, and persists', async ({
    page,
  }) => {
    await withFixture(page);
    const nav = page.getByRole('navigation');

    await expect(nav.getByRole('link', { name: 'Umsätze' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Umsätze' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');

    await page.getByRole('button', { name: 'EN', exact: true }).click();

    await expect(nav.getByRole('link', { name: 'Transactions' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Transactions' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    // Words switch; the statement's numbers do not (plan 07, decision 1).
    const row = ledgerRow(page, 'Müller GmbH');
    const amount = await row.getByText(/832,90/).textContent();
    expect(plain(amount ?? '')).toBe('-832,90 €');
    // The day a row sits under is words, and they follow the language.
    await expect(page.getByRole('main').getByRole('heading', { level: 3 }).first()).toHaveText(
      /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d+ \w+ \d{4}/u,
    );

    // The other two pages speak it too, reached by the (English) nav.
    await nav.getByRole('link', { name: 'Rules' }).click();
    await expect(page.getByRole('button', { name: 'Apply rules' })).toBeVisible();
    const wohnen = page.getByText('Wohnen', { exact: true });
    if (!(await wohnen.first().isVisible())) {
      await page.getByLabel('Name').fill('Wohnen');
      await page.getByRole('button', { name: 'Add category' }).click();
    }
    const composer = page.getByRole('region', { name: 'New rule' });
    await expect(composer.getByRole('combobox', { name: 'Operator' })).toHaveText('contains');

    await nav.getByRole('link', { name: 'Overview' }).click();
    await expect(page.getByRole('heading', { name: 'Budgets by category' })).toBeVisible();
    await expect(page.getByRole('figure', { name: 'Trend' })).toBeVisible();
    await expect(page.getByText(/ of (—|\d)/u)).toBeVisible();

    await nav.getByRole('link', { name: 'Transactions' }).click();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Transactions' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.getByRole('button', { name: 'DE', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Umsätze' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Umsätze' })).toBeVisible();
  });
});
