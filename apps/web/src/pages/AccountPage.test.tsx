import { type AccountPayload, type TransactionPayload } from '@household-budget/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountPage } from './AccountPage';

const ACCOUNTS: AccountPayload[] = [
  { id: 'acc-1', iban: 'DE89370400440532013000', name: 'Giro' },
  { id: 'acc-2', iban: 'DE02120300000000202051', name: 'Tagesgeld' },
];

/** One deferred load per account, so the test decides in which order they come back. */
const pending = new Map<string, (rows: TransactionPayload[]) => void>();

/** Every category write, still unanswered, so a test can decide when and how it lands. */
const writes: {
  readonly transactionId: string;
  readonly categoryId: string | null;
  readonly resolve: (updated: TransactionPayload) => void;
  readonly reject: (cause: unknown) => void;
}[] = [];

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  listAccounts: () => Promise.resolve(ACCOUNTS),
  createAccount: () => Promise.reject(new Error('not used here')),
  uploadImport: () => Promise.reject(new Error('not used here')),
  listCategories: () => Promise.resolve([{ id: 'cat-wohnen', name: 'Wohnen' }]),
  setTransactionCategory: (transactionId: string, categoryId: string | null) =>
    new Promise<TransactionPayload>((resolve, reject) => {
      writes.push({ transactionId, categoryId, resolve, reject });
    }),
  listTransactions: (accountId: string) =>
    new Promise<TransactionPayload[]>((resolve) => {
      pending.set(accountId, resolve);
    }),
}));

/** The page renders the app's nav, and `NavLink` needs a router around it. */
const page = () => (
  <MemoryRouter>
    <AccountPage />
  </MemoryRouter>
);

function row(id: string, counterpartyName: string): TransactionPayload {
  return {
    id,
    bookingDate: '2025-09-22',
    valueDate: '2025-09-22',
    amountCents: -1000,
    currency: 'EUR',
    status: 'booked',
    counterpartyName,
    counterpartyIban: null,
    purpose: 'Einkauf',
    bookingText: 'KARTENZAHLUNG',
    bankCategory: null,
    categoryId: null,
    categoryLockedAt: null,
  };
}

beforeEach(() => {
  pending.clear();
  writes.length = 0;
});

/** Renders the page with one booked row on the first account, loaded. */
async function withOneRow(): Promise<void> {
  render(page());
  await waitFor(() => {
    expect(pending.has('acc-1')).toBe(true);
  });
  pending.get('acc-1')?.([row('t-1', 'Müller GmbH')]);
  await screen.findByRole('combobox', { name: 'Kategorie' });
}

function chooseWohnen(): void {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Kategorie' }));
  fireEvent.click(screen.getByRole('option', { name: 'Wohnen' }));
}

const categorySelect = () => screen.getByRole('combobox', { name: 'Kategorie' });

describe('AccountPage', () => {
  it('drops a load that only arrives after the account was switched', async () => {
    // The first account's rows must never appear under the second account's name, however
    // late its response is. Clearing the table on switch is not enough on its own.
    render(page());

    await waitFor(() => {
      expect(pending.has('acc-1')).toBe(true);
    });

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Konto' }));
    fireEvent.click(screen.getByRole('option', { name: /Tagesgeld/ }));

    await waitFor(() => {
      expect(pending.has('acc-2')).toBe(true);
    });

    // The new account answers first, the abandoned one only afterwards — the order that
    // makes a late response overwrite a current one.
    pending.get('acc-2')?.([row('t-2', 'Müller GmbH')]);
    expect(await screen.findByRole('cell', { name: 'Müller GmbH' })).toBeInTheDocument();

    pending.get('acc-1')?.([row('t-1', 'REWE Filiale 7')]);

    await waitFor(() => {
      expect(screen.queryByRole('cell', { name: 'REWE Filiale 7' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('cell', { name: 'Müller GmbH' })).toBeInTheDocument();
  });
});

describe('AccountPage, setting a category by hand', () => {
  it('holds the row while its own write is unanswered, then shows what the server decided', async () => {
    // Both halves of one claim: the cell is read-only until the write lands, and the row
    // it lands on is replaced in place — the lock is the server's timestamp, so it can
    // only appear once the response has.
    await withOneRow();

    chooseWohnen();

    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    expect(writes[0]).toMatchObject({ transactionId: 't-1', categoryId: 'cat-wohnen' });
    expect(categorySelect()).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.queryByLabelText('von Hand gesetzt — Regeln ändern das nicht'),
    ).not.toBeInTheDocument();

    writes[0]?.resolve({
      ...row('t-1', 'Müller GmbH'),
      categoryId: 'cat-wohnen',
      categoryLockedAt: '2026-09-23T08:00:00.000Z',
    });

    expect(
      await screen.findByLabelText('von Hand gesetzt — Regeln ändern das nicht'),
    ).toBeInTheDocument();
    expect(categorySelect()).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('says so when the write is refused, and gives the row back', async () => {
    // A row left disabled forever is a row the user cannot correct, and a refusal with
    // nothing on screen is indistinguishable from a category that simply did not save.
    await withOneRow();

    chooseWohnen();
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    writes[0]?.reject(new Error('Kategorie nicht gefunden'));

    expect(await screen.findByText('Kategorie nicht gefunden')).toBeInTheDocument();
    await waitFor(() => {
      expect(categorySelect()).not.toHaveAttribute('aria-disabled', 'true');
    });
  });
});
