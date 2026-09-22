import { type AccountPayload, type TransactionPayload } from '@household-budget/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountPage } from './AccountPage';

const ACCOUNTS: AccountPayload[] = [
  { id: 'acc-1', iban: 'DE89370400440532013000', name: 'Giro' },
  { id: 'acc-2', iban: 'DE02120300000000202051', name: 'Tagesgeld' },
];

/** One deferred load per account, so the test decides in which order they come back. */
const pending = new Map<string, (rows: TransactionPayload[]) => void>();

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  listAccounts: () => Promise.resolve(ACCOUNTS),
  createAccount: () => Promise.reject(new Error('not used here')),
  uploadImport: () => Promise.reject(new Error('not used here')),
  listTransactions: (accountId: string) =>
    new Promise<TransactionPayload[]>((resolve) => {
      pending.set(accountId, resolve);
    }),
}));

function row(id: string, counterpartyName: string): TransactionPayload {
  return {
    id,
    bookingDate: '2025-09-22',
    valueDate: '2025-09-22',
    amountCents: -1000,
    currency: 'EUR',
    status: 'booked',
    counterpartyName,
    purpose: 'Einkauf',
    bookingText: 'KARTENZAHLUNG',
    bankCategory: null,
  };
}

beforeEach(() => {
  pending.clear();
});

describe('AccountPage', () => {
  it('drops a load that only arrives after the account was switched', async () => {
    // The first account's rows must never appear under the second account's name, however
    // late its response is. Clearing the table on switch is not enough on its own.
    render(<AccountPage />);

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
