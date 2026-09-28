import { expect, type Page, test } from '@playwright/test';

import { withFixture, withWohnen } from './support';

/** The number the Sortieren badge shows, read off its link's name: `Sortieren (4)`. */
async function badge(page: Page): Promise<number> {
  const link = page.getByRole('navigation').getByRole('link', { name: /^Sortieren/u });
  const name = (await link.getAttribute('aria-label')) ?? '';
  return Number(/\((\d+)\)/u.exec(name)?.[1] ?? '0');
}

test('sorts a row with a number key, and takes it back with Z', async ({ page }) => {
  await withFixture(page);
  await withWohnen(page);
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
    await withFixture(page);
    await withWohnen(page);
    await page.goto('/inbox');

    await expect(page.getByRole('heading', { level: 1, name: 'Sortieren' })).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
  });
});
