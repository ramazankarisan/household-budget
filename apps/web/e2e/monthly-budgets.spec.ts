import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Page, test } from '@playwright/test';

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/sparkasse-camt-18.csv',
);

/** `875,07 €` separates the amount from the € with U+00A0, not a space. */
const plain = (text: string): string => text.replaceAll('\u00a0', ' ');

/**
 * The report end to end: rows imported and categorized through the real API, summed by
 * `monthlyReport` in the browser, a limit written through `PUT /api/budgets` and read
 * back as the word "über".
 *
 * Named `monthly-budgets` rather than `budgets` for the order it runs in. The suite is one
 * worker over one database, files in name order, and `import.spec.ts` asserts it is the
 * first to create the account and upload the fixture — a spec sorting before it would
 * take that from it.
 *
 * Self-seeding to the state `docs/research/04-monthly-budgets.md` §4 measured: the
 * `müller → Wohnen` rule applied, and one of the two identical REWE card payments set to
 * Wohnen by hand — which is exactly what `rules.spec.ts` does, on the same row, when it
 * runs after this. Every step is conditional, so a retry against a half-seeded database
 * converges on the same state rather than doubling it.
 */
test.describe.serial('monthly budgets', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page);
  });

  test('September 2025 against a limit on Wohnen', async ({ page }) => {
    await page.getByRole('link', { name: 'Budgets' }).click();

    await page.getByLabel('Monat').click();
    await expect(page.getByRole('option', { name: 'März 2014' })).toBeVisible();
    await page.getByRole('option', { name: 'September 2025' }).click();

    const wohnen = page.getByRole('row').filter({ hasText: 'Wohnen' });
    await expect(wohnen).toContainText('875,07');

    const field = page.getByRole('textbox', { name: 'Budget Wohnen' });
    await field.fill('700');
    await field.press('Enter');
    await expect(field).toHaveValue('700,00');

    // The word, not the colour: that is what reaches someone who cannot see the red.
    await expect(wohnen).toHaveAccessibleName(/175,07\s€ über/);
    expect(plain(await wohnen.innerText())).toContain('175,07 € über');

    // The salary sits in this bucket and changes none of it.
    const uncategorized = page.getByRole('row').filter({ hasText: 'Ohne Kategorie' });
    expect(plain(await uncategorized.innerText())).toContain('1.510,67 €');
    expect(plain(await uncategorized.innerText())).toContain('19,00 €');
    await expect(uncategorized.getByRole('textbox')).toHaveCount(0);

    await expect(page.getByText(/von 700,00/)).toHaveText(
      /^2\.385,74\s€ von 700,00\s€ · 1\.685,74\s€ über/,
    );

    // The month drawn once, from the same report: present because September has spending.
    const chart = page.getByRole('figure', { name: 'Ausgaben nach Kategorie' });
    await expect(chart).toBeVisible();
    await expect(chart.locator('rect.MuiBarChart-element').first()).toBeVisible();

    // The limit is stored, not only drawn: a reload reads it back from the API.
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Budget Wohnen' })).toHaveValue('700,00');
  });

  test('the uncategorized row opens exactly the rows it summed', async ({ page }) => {
    await page.getByRole('link', { name: 'Budgets' }).click();

    await page
      .getByRole('row')
      .filter({ hasText: 'Ohne Kategorie' })
      .getByRole('button', { name: 'Ohne Kategorie' })
      .click();

    await expect(page).toHaveURL(/\/$/u);
    await expect(page.getByLabel('Monat')).toHaveText('September 2025');
    await expect(page.getByRole('cell', { name: 'Hausverwaltung Süd GmbH' })).toBeVisible();
    // Another month, and a categorized row of this one: neither is in the bucket.
    await expect(page.getByRole('cell', { name: 'Versicherung Nord AG' })).toHaveCount(0);
    await expect(page.getByRole('cell', { name: 'Müller GmbH' })).toHaveCount(0);
  });
});

/** The account, the fixture, `Wohnen`, the `müller` rule applied, and one REWE row by hand. */
async function seed(page: Page): Promise<void> {
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

  // Read off the row's text rather than its select: until a category exists, the cell is
  // read-only text and there is no combobox to ask.
  const muellerRow = page.getByRole('row').filter({ hasText: 'Müller GmbH' });
  if ((await muellerRow.filter({ hasText: 'Wohnen' }).count()) === 0) {
    await page.getByRole('link', { name: 'Regeln' }).click();
    await expect(page.getByRole('heading', { name: 'Kategorien' })).toBeVisible();

    const wohnen = page.getByText('Wohnen', { exact: true });
    if (!(await wohnen.first().isVisible())) {
      await page.getByLabel('Name').fill('Wohnen');
      await page.getByRole('button', { name: 'Kategorie anlegen' }).click();
    }
    await expect(wohnen.first()).toBeVisible();

    const keyword = page.getByRole('cell', { name: 'müller', exact: true });
    if ((await keyword.count()) === 0) {
      await page.getByRole('button', { name: 'Regel anlegen' }).click();
      await page.getByLabel('Suchbegriff').fill('müller');
      await page.getByRole('button', { name: 'Speichern' }).click();
    }
    await expect(keyword).toHaveCount(1);

    await page.getByRole('button', { name: 'Regeln anwenden' }).click();
    await expect(page.getByText(/zugeordnet/)).toBeVisible();

    await page.getByRole('link', { name: 'Umsätze' }).click();
    await expect(muellerRow.getByRole('combobox')).toHaveText('Wohnen');
  }

  const reweRow = page.getByRole('row').filter({ hasText: 'REWE SAGT DANKE; FILIALE 42' }).first();
  if ((await reweRow.filter({ hasText: 'Wohnen' }).count()) === 0) {
    await reweRow.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Wohnen' }).click();
  }
  await expect(reweRow.getByLabel('von Hand gesetzt — Regeln ändern das nicht')).toBeVisible();
}
