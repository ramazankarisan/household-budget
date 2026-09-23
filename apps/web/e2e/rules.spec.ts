import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/sparkasse-camt-18.csv',
);

/**
 * Categorization end to end: a rule written in the browser, matched in `packages/core`,
 * written by Prisma and rendered back on the transaction it claimed.
 *
 * The keyword is `müller` in lower case against a `Müller GmbH` payee stored from
 * Windows-1252 bytes. That is the case SQLite cannot do — `LIKE '%müller%'` misses
 * `MÜLLER GmbH` on this build — so this spec is the proof the in-JavaScript matcher is
 * wired all the way through rather than only unit-tested.
 *
 * Serial and in one file: every case here depends on the account and the import the
 * first one creates.
 */
test.describe.serial('categorization rules', () => {
  test('a rule written in the browser categorizes an imported transaction', async ({ page }) => {
    await page.goto('/');

    /*
     * The account may already exist: the import spec runs against this same database and
     * creates it. Whichever spec gets there first, this one needs an account with the
     * fixture in it — and re-importing the same file is a no-op by design, so asking for
     * it unconditionally is safe.
     */
    const createAccount = page.getByRole('heading', { name: 'Konto anlegen' });
    await expect(
      createAccount.or(page.getByRole('heading', { name: 'CSV importieren' })),
    ).toBeVisible();

    if (await createAccount.isVisible()) {
      await page.getByLabel('IBAN').fill('DE89370400440532013000');
      await page.getByLabel('Bezeichnung').fill('Giro');
      await page.getByRole('button', { name: 'Anlegen' }).click();
    }

    await page.getByLabel('CSV-Datei auswählen').setInputFiles(FIXTURE);
    await expect(page.getByText(/importiert/)).toBeVisible();

    await page.getByRole('link', { name: 'Regeln' }).click();
    await expect(page.getByRole('heading', { name: 'Kategorien' })).toBeVisible();

    /*
     * Both of these are asked for only when they are not already there. A retry — CI runs
     * with two — re-runs the whole serial file against the database the failed attempt
     * left behind, and a second `müller` rule would make the cell locator match twice and
     * fail on strict mode, hiding whatever actually broke behind a locator error.
     */
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
    const muellerRow = page.getByRole('row').filter({ hasText: 'Müller GmbH' });
    await expect(muellerRow.getByRole('combobox')).toHaveText('Wohnen');
  });

  test('a category set by hand survives the next apply', async ({ page }) => {
    await page.goto('/');

    const reweRow = page
      .getByRole('row')
      .filter({ hasText: 'REWE SAGT DANKE; FILIALE 42' })
      .first();
    await reweRow.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Wohnen' }).click();

    // The lock is what tells the user this row is now theirs, not the engine's.
    await expect(reweRow.getByLabel('von Hand gesetzt — Regeln ändern das nicht')).toBeVisible();

    await page.getByRole('link', { name: 'Regeln' }).click();
    await page.getByRole('button', { name: 'Regeln anwenden' }).click();
    await expect(page.getByText(/1 manuell/)).toBeVisible();

    await page.getByRole('link', { name: 'Umsätze' }).click();
    const afterApply = page
      .getByRole('row')
      .filter({ hasText: 'REWE SAGT DANKE; FILIALE 42' })
      .first();
    await expect(afterApply.getByRole('combobox')).toHaveText('Wohnen');
    await expect(afterApply.getByLabel('von Hand gesetzt — Regeln ändern das nicht')).toBeVisible();
  });
});
