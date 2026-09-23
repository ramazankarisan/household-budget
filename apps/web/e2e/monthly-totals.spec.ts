import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Page, test } from '@playwright/test';

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/sparkasse-camt-18.csv',
);

/**
 * `1.510,67 €` → 151067. The cents stay integers, the way the report keeps them. The
 * Gebucht column is money out as a positive figure, so there is no sign to read, and `\s`
 * already covers the U+00A0 between the amount and the €.
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
 * headline on `/budgets` matched against sums worked out by hand from the CSV.
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
    await importFixture(page);
    await page.getByRole('link', { name: 'Budgets' }).click();
    // The list has a `Monat` select too: wait for this page's table before asking for one.
    await expect(page.getByRole('columnheader', { name: 'Gebucht' })).toBeVisible();
  });

  test('September 2025 adds up to what the fixture says', async ({ page }) => {
    await chooseMonth(page, 'September 2025');

    const headline = page.getByText(/ von /u);
    await expect(headline).toHaveText(/^2\.385,74\s€ von /u);
    await expect(headline).toHaveText(/19,00\s€ vorgemerkt$/u);

    // The rows are the headline split up: however the other specs categorized them, the
    // Gebucht column still sums to the same figure. The headline above has already waited
    // for this render.
    const booked = await page
      .locator('tbody')
      .getByRole('row')
      .evaluateAll((rows) => rows.map((row) => row.children[1]?.textContent ?? ''));
    expect(booked.reduce((sum, cell) => sum + centsOf(cell), 0)).toBe(238_574);
  });

  test('March 2014 holds only the stray row', async ({ page }) => {
    await chooseMonth(page, 'März 2014');

    await expect(page.getByText(/ von /u)).toHaveText(/^1\.143,41\s€ von /u);
  });
});

/**
 * The account and the upload, each only when it is not already there — the other specs
 * share this database. A repeated upload is not a no-op: it replaces every pending row
 * with a fresh one, dropping any category set on it by hand, and restores booked rows the
 * user deleted. So the file goes up once, never on every test.
 */
async function importFixture(page: Page): Promise<void> {
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

async function chooseMonth(page: Page, name: string): Promise<void> {
  await page.getByLabel('Monat').click();
  await page.getByRole('option', { name }).click();
  await expect(page.getByLabel('Monat')).toHaveText(name);
}
