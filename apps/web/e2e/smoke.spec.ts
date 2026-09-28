import { expect, test } from '@playwright/test';

/**
 * The wiring smoke test: the page loads and the API answered.
 *
 * Passing proves the whole chain is connected — the React router, the Vite proxy, the
 * Nest controller and SQLite. Failing means one of those links is broken, which is
 * exactly the class of break unit tests cannot see.
 */
test('the page loads and reaches the API', async ({ page }) => {
  await page.goto('/transactions');

  await expect(page.getByRole('heading', { level: 1, name: 'Umsätze' })).toBeVisible();
  await expect(page.getByRole('navigation').getByText('Haushaltsbuch')).toBeVisible();

  /*
   * Either the way to a first account or the list renders, and neither appears until
   * GET /api/accounts came back — which of the two depends on whether the import spec has
   * already run. The error alert is what renders if the request failed.
   */
  const main = page.getByRole('main');
  await expect(
    main
      .getByRole('button', { name: 'Konto anlegen' })
      .or(main.getByRole('combobox', { name: 'Kategorie filtern' }))
      .or(main.getByText(/^Noch keine Umsätze/u)),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toBeHidden();
});
