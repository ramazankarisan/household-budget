import { expect, test } from '@playwright/test';

import { ledgerRow, withFixture } from './support';

/**
 * The list narrowed in a real browser: the search that SQLite could not have run, the
 * month stepper built from the rows the API actually returned, and the count chip as the
 * way into the uncategorized ones.
 *
 * Nothing here asserts an absolute number of rows. Other specs categorize rows in this
 * same database, and a CI retry re-runs files against whatever the failed attempt left
 * behind — so every assertion is about which rows are on screen relative to each other.
 */
test.describe.serial('the transactions list', () => {
  test.beforeEach(async ({ page }) => {
    await withFixture(page);
  });

  test('finds MÜLLER GmbH by typing müller in lower case', async ({ page }) => {
    // The whole reason the search runs in JavaScript: `LIKE '%müller%'` does not match
    // this row on the SQLite this app ships with.
    await page.getByLabel('Suche').fill('müller');

    await expect(ledgerRow(page, 'Müller GmbH')).toBeVisible();
    await expect(ledgerRow(page, 'REWE SAGT DANKE; FILIALE 42')).toHaveCount(0);

    await page.getByRole('button', { name: 'Suche löschen' }).click();
    await expect(ledgerRow(page, 'REWE SAGT DANKE; FILIALE 42').first()).toBeVisible();
  });

  test('searches a purpose across the line break the bank put in it', async ({ page }) => {
    await page.getByLabel('Suche').fill('miete oktober hauptstraße');

    await expect(ledgerRow(page, 'Hausverwaltung Süd GmbH')).toBeVisible();
    await expect(ledgerRow(page, 'Müller GmbH')).toHaveCount(0);
  });

  test('shows one month at a time, and only the months the account has', async ({ page }) => {
    // The fixture's stray 2014 row is the point: a history has holes, and September is
    // not a range that contains March 2014.
    await expect(ledgerRow(page, 'Versicherung Nord AG')).toBeVisible();

    await page.getByRole('button', { name: /^Monat wählen/u }).click();
    await expect(page.getByRole('menuitem', { name: 'März 2014' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'September 2025' }).click();

    await expect(ledgerRow(page, 'Versicherung Nord AG')).toHaveCount(0);
    await expect(ledgerRow(page, 'Müller GmbH')).toBeVisible();
  });

  test('groups the statement by day, newest first', async ({ page }) => {
    const days = await page.getByRole('main').getByRole('heading', { level: 3 }).allInnerTexts();

    expect(days.length).toBeGreaterThan(1);
    expect(days[days.length - 1]).toMatch(/2014$/u);
  });

  test('the count chip opens exactly the rows it counts', async ({ page }) => {
    const chip = page.getByRole('button', { name: 'Nur Umsätze ohne Kategorie zeigen' });
    // Whether anything is uncategorized depends on what the other specs did to this
    // database, so the chip is only exercised when it is there to exercise.
    test.skip((await chip.count()) === 0, 'every row in this database is already categorized');

    const counted = Number(/^\d+/.exec((await chip.innerText()).trim())?.[0] ?? '0');
    await chip.click();

    // The chip counts what can be categorized — booked rows — and the filter shows exactly those.
    const rows = page.getByRole('main').getByRole('listitem');
    await expect(rows).toHaveCount(counted);
    await expect(rows.filter({ hasText: 'vorgemerkt' })).toHaveCount(0);
    // Every row on screen is one of them: nothing categorized slipped through.
    await expect(rows.filter({ hasText: 'Ohne Kategorie' })).toHaveCount(await rows.count());
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the ledger fits without scrolling sideways', async ({ page }) => {
    await withFixture(page);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
  });
});
