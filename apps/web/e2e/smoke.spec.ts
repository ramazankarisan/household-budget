import { expect, test } from '@playwright/test';

/**
 * The wiring smoke test: the page loads and the API answered.
 *
 * Passing proves the whole chain is connected — the React router, the Vite proxy, the
 * Nest controller and SQLite. Failing means one of those links is broken, which is
 * exactly the class of break unit tests cannot see.
 */
test('the page loads and reaches the API', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Household Budget' })).toBeVisible();

  /*
   * Either the create-account form or the import panel renders, and neither appears
   * until GET /api/accounts came back — which of the two depends on whether the import
   * spec has already run. The error alert is what renders if the request failed.
   */
  await expect(
    page
      .getByRole('heading', { name: 'Konto anlegen' })
      .or(page.getByRole('heading', { name: 'CSV importieren' })),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toBeHidden();
});
