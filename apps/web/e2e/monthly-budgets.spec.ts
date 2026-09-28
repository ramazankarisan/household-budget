import { expect, type Page, test } from '@playwright/test';

import { categoryPill, ledgerRow, pickCategory, plain, withFixture, withWohnen } from './support';

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
    await page.getByRole('link', { name: 'Überblick' }).click();
    // Every page has a „Monat wählen“ button. Until Überblick has rendered, the one on
    // screen is still Umsätze's, and on a slow CPU the click opens that menu — which then
    // unmounts with its page, so the menu item below detaches mid-click.
    await expect(page.getByRole('heading', { level: 1, name: 'Überblick' })).toBeVisible();

    await page.getByRole('button', { name: /^Monat wählen/u }).click();
    await expect(page.getByRole('menuitem', { name: 'März 2014' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'September 2025' }).click();

    const rows = page.getByRole('list', { name: 'Budgets nach Kategorie' }).getByRole('listitem');
    const wohnen = rows.filter({ hasText: 'Wohnen' });
    await expect(wohnen).toContainText('875,07');

    await page.getByRole('button', { name: 'Budgets bearbeiten' }).click();
    const field = page.getByRole('textbox', { name: 'Budget Wohnen' });
    await field.fill('700');
    await field.press('Enter');
    await expect(field).toHaveValue('700,00');
    await page.getByRole('button', { name: 'Fertig' }).click();

    // The word, not the colour: that is what reaches someone who cannot see the red.
    await expect(page.getByRole('img', { name: /^Wohnen: .*175,07\s€ über$/u })).toBeVisible();
    expect(plain(await wohnen.innerText())).toContain('175,07 € über');

    // The salary is money in and changes none of the bucket.
    const uncategorized = rows.filter({ hasText: 'Ohne Kategorie' });
    expect(plain(await uncategorized.innerText())).toContain('1.510,67 €');
    expect(plain(await uncategorized.innerText())).toContain('19,00 €');
    await expect(uncategorized.getByRole('textbox')).toHaveCount(0);

    await expect(page.getByText(/von 700,00/)).toHaveText(
      /^2\.385,74\s€ von 700,00\s€ · 1\.685,74\s€ über/,
    );

    // The trend reads the same months, and draws the limit as a line.
    await expect(page.getByRole('figure', { name: 'Verlauf' })).toBeVisible();

    // The limit is stored, not only drawn: a reload reads it back from the API.
    await page.reload();
    await expect(page.getByRole('img', { name: /^Wohnen: .*von 700,00\s€/u })).toBeVisible();
  });

  test('„Ohne Kategorie“ leads to the list of those rows, on the same month', async ({ page }) => {
    await page.getByRole('link', { name: 'Überblick' }).click();

    await page
      .getByRole('list', { name: 'Budgets nach Kategorie' })
      .getByRole('listitem')
      .filter({ hasText: 'Ohne Kategorie' })
      .getByRole('link', { name: 'Anzeigen' })
      .click();

    await expect(page).toHaveURL(/\/transactions\?m=2025-09&c=uncategorized$/u);
    await expect(page.getByRole('heading', { level: 1, name: 'Umsätze' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Monat wählen/u })).toHaveText('September 2025');
    // March 2014's stray row is another month: never on screen here.
    const rows = page.getByRole('main').getByRole('listitem');
    await expect(rows.first()).toBeVisible();
    await expect(rows.filter({ hasText: 'Versicherung Nord AG' })).toHaveCount(0);
    await expect(rows.filter({ hasNotText: 'Ohne Kategorie' })).toHaveCount(0);
  });
});

/** The account, the fixture, `Wohnen`, the `müller` rule applied, and one REWE row by hand. */
async function seed(page: Page): Promise<void> {
  await withFixture(page);

  // Read off the row's pill rather than a menu: it names the category it shows.
  const muellerRow = ledgerRow(page, 'Müller GmbH');
  if ((await categoryPill(muellerRow).innerText()).trim() !== 'Wohnen') {
    await withWohnen(page);

    const keyword = page
      .getByRole('list', { name: 'Regeln' })
      .getByText('„müller“', { exact: true });
    if ((await keyword.count()) === 0) {
      const composer = page.getByRole('region', { name: 'Neue Regel' });
      await composer.getByLabel('Suchbegriff').fill('müller');
      await composer.getByRole('combobox', { name: 'Kategorie' }).click();
      await page.getByRole('option', { name: 'Wohnen' }).click();
      await composer.getByRole('button', { name: 'Regel anlegen' }).click();
    }
    await expect(keyword).toHaveCount(1);

    await page.getByRole('button', { name: 'Regeln anwenden' }).click();
    await expect(page.getByText(/zugeordnet/)).toBeVisible();

    await page.getByRole('navigation').getByRole('link', { name: 'Umsätze' }).click();
    await expect(categoryPill(muellerRow)).toHaveText('Wohnen');
  }

  const reweRow = ledgerRow(page, 'REWE SAGT DANKE; FILIALE 42').first();
  if ((await categoryPill(reweRow).innerText()).trim() !== 'Wohnen') {
    await pickCategory(page, reweRow, 'Wohnen');
  }
  await expect(reweRow.getByLabel('von Hand gesetzt — Regeln ändern das nicht')).toBeVisible();
}
