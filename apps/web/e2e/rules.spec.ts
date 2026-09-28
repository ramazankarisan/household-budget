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
    await page.goto('/transactions');

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
     * left behind, and a second `müller` rule would make the keyword locator match twice and
     * fail on strict mode, hiding whatever actually broke behind a locator error.
     */
    const wohnen = page.getByText('Wohnen', { exact: true });
    if (!(await wohnen.first().isVisible())) {
      await page.getByLabel('Name').fill('Wohnen');
      await page.getByRole('button', { name: 'Kategorie anlegen' }).click();
    }
    await expect(wohnen.first()).toBeVisible();

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

    await page.getByRole('link', { name: 'Umsätze' }).click();
    const muellerRow = page.getByRole('row').filter({ hasText: 'Müller GmbH' });
    await expect(muellerRow.getByRole('combobox')).toHaveText('Wohnen');
  });

  test('a category set by hand survives the next apply', async ({ page }) => {
    await page.goto('/transactions');

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

  test('the order is changed by dragging and by Alt+↑, and saved', async ({ page }) => {
    await page.goto('/rules');
    const composer = page.getByRole('region', { name: 'Neue Regel' });
    const list = page.getByRole('list', { name: 'Regeln' });
    // Two rules that match nothing, so no other spec's rows move; removed at the end.
    for (const value of ['e2e-eins', 'e2e-zwei']) {
      if ((await list.getByText(`„${value}“`, { exact: true }).count()) === 0) {
        await composer.getByLabel('Suchbegriff').fill(value);
        await composer.getByRole('button', { name: 'Regel anlegen' }).click();
        await expect(list.getByText(`„${value}“`, { exact: true })).toBeVisible();
      }
    }
    const order = async () =>
      (await list.getByRole('listitem').allInnerTexts())
        .map((text) => /„(e2e-[a-z]+)“/u.exec(text)?.[1])
        .filter((value) => value !== undefined);
    await expect.poll(order).toEqual(['e2e-eins', 'e2e-zwei']);

    // Drag the second above the first by its handle.
    const handle = page.getByRole('button', { name: 'Ziehen, um zu verschieben: e2e-zwei' });
    const target = page.getByRole('button', { name: 'Ziehen, um zu verschieben: e2e-eins' });
    const from = await handle.boundingBox();
    const to = await target.boundingBox();
    if (from === null || to === null) {
      throw new Error('handles not on screen');
    }
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, to.y + 2, { steps: 12 });
    await page.mouse.up();
    await expect.poll(order).toEqual(['e2e-zwei', 'e2e-eins']);

    // Stored, not only shown.
    await page.reload();
    await expect.poll(order).toEqual(['e2e-zwei', 'e2e-eins']);

    // And back with the keyboard, on the focused row.
    await page.getByRole('button', { name: 'Nach oben: e2e-eins' }).focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(order).toEqual(['e2e-eins', 'e2e-zwei']);

    for (const value of ['e2e-eins', 'e2e-zwei']) {
      await page.getByRole('button', { name: `Regel löschen: ${value}` }).click();
      await expect(list.getByText(`„${value}“`, { exact: true })).toHaveCount(0);
    }
  });
});
