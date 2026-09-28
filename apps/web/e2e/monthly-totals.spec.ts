import { expect, type Page, test } from '@playwright/test';

import { withFixture } from './support';

/**
 * The first amount in `text`, `1.510,67 €` → 151067. The cents stay integers, the way the
 * report keeps them. A row's first figure is its booked money out as a positive amount, so
 * there is no sign to read, and `\s` covers the U+00A0 between the amount and the €.
 */
function centsOf(text: string): number {
  const match = /([\d.]+),(\d{2})\s€/u.exec(text);
  if (match === null) {
    throw new Error(`not an amount: ${text}`);
  }
  const [, euros = '', cents = ''] = match;
  return Number(euros.replaceAll('.', '')) * 100 + Number(cents);
}

/**
 * The fixture's totals on the dashboard: a file uploaded in the browser, then the month
 * headline on Überblick matched against sums worked out by hand from the CSV.
 *
 * September 2025, money out only: 832,90 + 2 × 42,17 + 1.150,00 + 128,50 + 190,00 =
 * 2.385,74 € booked, plus the 19,00 € vorgemerkt row kept apart. The 2.450,00 € salary is
 * money in and counts toward nothing — were it counted, the sum would be off by exactly
 * that. March 2014 is the one stray row, 1.143,41 €.
 *
 * Every figure here is chosen to hold whatever the other specs did to this shared
 * database: a total does not move when a row changes category, and the budget half of
 * the headline, which `monthly-budgets.spec.ts` sets, is left out of every assertion.
 * Named to sort after `import.spec.ts`, which must be the first to upload the fixture.
 */
test.describe.serial('monthly totals', () => {
  test.beforeEach(async ({ page }) => {
    await withFixture(page);
    await page.getByRole('link', { name: 'Überblick' }).click();
    await expect(page.getByRole('heading', { name: 'Budgets nach Kategorie' })).toBeVisible();
  });

  test('September 2025 adds up to what the fixture says', async ({ page }) => {
    await chooseMonth(page, 'September 2025');

    const headline = page.getByText(/ von /u);
    await expect(headline).toHaveText(/^2\.385,74\s€ von /u);
    await expect(headline).toHaveText(/19,00\s€ vorgemerkt$/u);

    // The rows are the headline split up: however the other specs categorized them, the
    // booked amount each row starts its figures with still sums to the same total. The
    // headline above has already waited for this render.
    const booked = await page
      .getByRole('list', { name: 'Budgets nach Kategorie' })
      .getByRole('listitem')
      .allInnerTexts();
    expect(booked.reduce((sum, text) => sum + centsOf(text), 0)).toBe(238_574);
  });

  test('March 2014 holds only the stray row', async ({ page }) => {
    await chooseMonth(page, 'März 2014');

    await expect(page.getByText(/ von /u)).toHaveText(/^1\.143,41\s€ von /u);
  });
});

async function chooseMonth(page: Page, name: string): Promise<void> {
  const stepper = page.getByRole('button', { name: /^Monat wählen/u });
  await stepper.click();
  await page.getByRole('menuitem', { name }).click();
  await expect(stepper).toHaveText(name);
}
