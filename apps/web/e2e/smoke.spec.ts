import { expect, test } from '@playwright/test';

/**
 * The one smoke test: the page loads and renders what the API returned.
 *
 * Passing proves the whole chain is wired — core's describeHello(), the Nest controller, the
 * Vite proxy and the React render. Failing means one of those links is broken, which is
 * exactly the class of break unit tests cannot see.
 */
test('the page loads and shows the hello response from the API', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Household Budget' })).toBeVisible();

  /*
   * Assert on the message, not on `db: ok`. HelloService degrades to db: "unavailable"
   * instead of throwing when the SQLite probe fails, so asserting the database chip would
   * make this test fail for a reason it is not meant to police.
   */
  await expect(page.getByText(/hello from api/)).toBeVisible();

  // The error branch must not be what rendered.
  await expect(page.getByRole('alert')).toBeHidden();
});
