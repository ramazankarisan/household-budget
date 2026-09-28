import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Locator, type Page } from '@playwright/test';

/** The primary synthetic export: Windows-1252, CRLF, 9 rows, one of them vorgemerkt. */
export const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/sparkasse-camt-18.csv',
);

/** `-832,90 €` separates the amount from the € with U+00A0, not a space. */
export const plain = (text: string): string => text.replaceAll(' ', ' ');

/** A row of the ledger holding `text` — its counterparty, its purpose, anything on it. */
export function ledgerRow(page: Page, text: string): Locator {
  return page.getByRole('main').getByRole('listitem').filter({ hasText: text });
}

/** The row's category pill — a button, named after the category it shows. */
export function categoryPill(row: Locator): Locator {
  return row.getByRole('button', { name: /^Kategorie:/u });
}

/** Opens the row's category menu and picks `name` from it. */
export async function pickCategory(page: Page, row: Locator, name: string): Promise<void> {
  await categoryPill(row).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${name}`, 'u') }).click();
}

/** Waits for `/transactions` to show what it has: the empty state or the list. */
async function listReady(page: Page): Promise<'no-account' | 'empty' | 'rows'> {
  const main = page.getByRole('main');
  const noAccount = main.getByRole('button', { name: 'Konto anlegen' });
  const empty = main.getByText(/^Noch keine Umsätze/u);
  const rows = main.getByRole('combobox', { name: 'Kategorie filtern' });
  await expect(noAccount.or(empty).or(rows)).toBeVisible();
  if (await noAccount.isVisible()) {
    return 'no-account';
  }
  return (await rows.isVisible()) ? 'rows' : 'empty';
}

/**
 * Uploads the fixture through the import dialog, creating the Giro account first when there
 * is none, and closes the dialog once the result is on screen. Returns that result's text.
 */
export async function importFixture(page: Page): Promise<string> {
  const state = await listReady(page);
  if (state === 'no-account') {
    await page.getByRole('main').getByRole('button', { name: 'Konto anlegen' }).click();
  } else {
    await page.getByRole('button', { name: 'Importieren' }).click();
  }
  const dialog = page.getByRole('dialog', { name: 'CSV importieren' });
  if (await dialog.getByRole('textbox', { name: 'IBAN' }).isVisible()) {
    await dialog.getByLabel('IBAN').fill('DE89370400440532013000');
    await dialog.getByLabel('Bezeichnung').fill('Giro');
    await dialog.getByRole('button', { name: 'Anlegen' }).click();
  }
  await dialog.getByLabel('CSV-Datei auswählen').setInputFiles(FIXTURE);
  const summary = dialog.getByText(/importiert/u);
  await expect(summary).toBeVisible();
  const text = await summary.innerText();
  await dialog.getByRole('button', { name: 'Schließen' }).click();
  await expect(dialog).toBeHidden();
  return text;
}

/**
 * An account with the fixture's rows in it, on `/transactions`. The specs share one
 * database, and a repeated upload is not a no-op — it replaces the vorgemerkt rows and
 * drops a category set on one — so the file goes up only when its rows are missing.
 */
export async function withFixture(page: Page): Promise<void> {
  await page.goto('/transactions');
  if ((await listReady(page)) !== 'rows' || (await ledgerRow(page, 'Müller GmbH').count()) === 0) {
    await importFixture(page);
  }
  await expect(ledgerRow(page, 'Müller GmbH')).toBeVisible();
}

/** A `Wohnen` category, created on `/rules` if it is not there yet. Leaves the page on `/rules`. */
export async function withWohnen(page: Page): Promise<void> {
  await page.getByRole('navigation').getByRole('link', { name: 'Regeln' }).click();
  const panel = page.getByRole('region', { name: 'Kategorien' });
  await expect(panel).toBeVisible();
  const wohnen = panel.getByText('Wohnen', { exact: true });
  if ((await wohnen.count()) === 0) {
    await panel.getByLabel('Name').fill('Wohnen');
    await panel.getByRole('button', { name: 'Kategorie anlegen' }).click();
  }
  await expect(wohnen).toBeVisible();
}
