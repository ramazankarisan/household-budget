import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/sparkasse-camt-18.csv',
);

/**
 * The list narrowed in a real browser: the search that SQLite could not have run, the
 * month selector built from the rows the API actually returned, and the count chip as the
 * way into the uncategorized ones.
 *
 * Nothing here asserts an absolute number of rows. `rules.spec.ts` categorizes rows in
 * this same database, and a CI retry re-runs both files against whatever the failed
 * attempt left behind — so every assertion is about which rows are on screen relative to
 * each other, never about how many there are in total.
 */
test.describe.serial('the transactions list', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // The account and the import may already be here: the other specs share this
    // database, and re-importing the same file is a no-op by design.
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
  });

  test('finds MÜLLER GmbH by typing müller in lower case', async ({ page }) => {
    // The whole reason the search runs in JavaScript: `LIKE '%müller%'` does not match
    // this row on the SQLite this app ships with.
    await page.getByLabel('Suche').fill('müller');

    await expect(page.getByRole('cell', { name: 'Müller GmbH' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'REWE SAGT DANKE; FILIALE 42' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Suche löschen' }).click();
    await expect(
      page.getByRole('cell', { name: 'REWE SAGT DANKE; FILIALE 42' }).first(),
    ).toBeVisible();
  });

  test('searches a purpose across the line break the bank put in it', async ({ page }) => {
    await page.getByLabel('Suche').fill('miete oktober hauptstraße');

    await expect(page.getByRole('cell', { name: 'Hausverwaltung Süd GmbH' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Müller GmbH' })).toHaveCount(0);
  });

  test('shows one month at a time, and only the months the account has', async ({ page }) => {
    // The fixture's stray 2014 row is the point: a history has holes, and September is
    // not a range that contains March 2014.
    await expect(page.getByRole('cell', { name: 'Versicherung Nord AG' })).toBeVisible();

    await page.getByLabel('Monat').click();
    await expect(page.getByRole('option', { name: 'März 2014' })).toBeVisible();
    await page.getByRole('option', { name: 'September 2025' }).click();

    await expect(page.getByRole('cell', { name: 'Versicherung Nord AG' })).toHaveCount(0);
    await expect(page.getByRole('cell', { name: 'Müller GmbH' })).toBeVisible();
  });

  test('the count chip opens exactly the rows it counts', async ({ page }) => {
    const chip = page.getByRole('button', { name: 'Nur Umsätze ohne Kategorie zeigen' });
    // Whether anything is uncategorized depends on what the other specs did to this
    // database, so the chip is only exercised when it is there to exercise.
    test.skip((await chip.count()) === 0, 'every row in this database is already categorized');

    const counted = Number(/^\d+/.exec((await chip.innerText()).trim())?.[0] ?? '0');
    await chip.click();

    const rows = page.getByRole('row').filter({ hasText: 'Ohne Kategorie' });
    await expect(rows).toHaveCount(counted);
    // Every visible data row is one of them: nothing categorized slipped through.
    await expect(page.getByRole('row')).toHaveCount(counted + 1);
  });
});
