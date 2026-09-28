import { expect, type Page, test } from '@playwright/test';

import { withFixture } from './support';

const stepper = (page: Page) => page.getByRole('button', { name: /^Monat wählen/u });

test.describe('the month in the URL', () => {
  test('[ and ] step it, and the back button undoes a step', async ({ page }) => {
    await withFixture(page);
    // The old address still works, and keeps the month.
    await page.goto('/budgets?m=2025-09');
    await expect(page).toHaveURL(/\/\?m=2025-09$/u);
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
    await withFixture(page);
    await page.goto('/budgets?m=2014-03');

    await page.getByRole('navigation').getByRole('link', { name: 'Umsätze' }).click();

    await expect(page).toHaveURL(/\/transactions\?m=2014-03$/u);
    await expect(stepper(page)).toHaveText('März 2014');
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('has a bottom bar, „Mehr“ for the rest, and no sideways scroll', async ({ page }) => {
    await withFixture(page);

    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
    await expect(nav.getByRole('link', { name: 'Regeln' })).toBeVisible();
    await nav.getByRole('button', { name: 'Mehr' }).click();
    await expect(page.getByRole('group', { name: 'Sprache' })).toBeVisible();
    await page.keyboard.press('Escape');

    for (const path of ['/', '/transactions', '/rules']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, path).toBeLessThanOrEqual(390);
    }
  });
});
