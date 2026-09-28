import { type TransactionPayload } from '@household-budget/core';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { listAccounts, listCategories, listTransactions } from '../api/client';
import { useHousehold } from './context';
import { HouseholdProvider } from './HouseholdProvider';

function row(id: string, overrides: Partial<TransactionPayload> = {}): TransactionPayload {
  return {
    id,
    bookingDate: '2025-09-22',
    valueDate: null,
    amountCents: -1000,
    currency: 'EUR',
    status: 'booked',
    counterpartyName: 'Müller GmbH',
    counterpartyIban: null,
    purpose: null,
    bookingText: null,
    bankCategory: null,
    categoryId: null,
    categoryLockedAt: null,
    ...overrides,
  };
}

let stored: Record<string, TransactionPayload[]> = {};

const ACCOUNTS = [
  { id: 'acc-1', iban: 'DE89370400440532013000', name: 'Giro' },
  { id: 'acc-2', iban: 'DE02120300000000202051', name: 'Tagesgeld' },
];

vi.mock('../api/client', () => ({
  listAccounts: vi.fn(() => Promise.resolve(ACCOUNTS)),
  listCategories: vi.fn(() => Promise.resolve([])),
  listRules: () => Promise.resolve([]),
  listTransactions: vi.fn((accountId: string) => Promise.resolve(stored[accountId] ?? [])),
}));

/** What two pages would each read from the one household. */
function Probe() {
  const { transactions, replaceTransaction, reload, error } = useHousehold();
  return (
    <>
      <output aria-label="error">{error === undefined ? '' : String(error.cause)}</output>
      <output aria-label="rows">
        {transactions === undefined
          ? 'loading'
          : transactions.map((t) => `${t.id}:${t.categoryId ?? '-'}`).join(',')}
      </output>
      <button
        type="button"
        onClick={() => {
          replaceTransaction(row('t-1', { categoryId: 'cat-wohnen' }));
        }}
      >
        assign
      </button>
      <button type="button" onClick={reload}>
        reload
      </button>
    </>
  );
}

const rows = () => screen.getByRole('status', { name: 'rows' });

describe('HouseholdProvider', () => {
  it('keeps a failure of one request when the accounts answer after it', async () => {
    vi.mocked(listCategories).mockRejectedValueOnce(new Error('categories down'));
    // The accounts answer last, after the failure has landed.
    vi.mocked(listAccounts).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(ACCOUNTS);
          }, 10);
        }),
    );
    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );

    await waitFor(() => {
      expect(rows()).not.toHaveTextContent('loading');
    });
    expect(screen.getByRole('status', { name: 'error' })).toHaveTextContent('categories down');
  });

  it('holds every account’s rows once each has answered', async () => {
    stored = { 'acc-1': [row('t-1')], 'acc-2': [row('t-2')] };
    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );

    await waitFor(() => {
      expect(rows()).toHaveTextContent('t-1:-,t-2:-');
    });
  });

  it('replaces one row everywhere it is read, without a reload', async () => {
    stored = { 'acc-1': [row('t-1')], 'acc-2': [] };
    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );
    await waitFor(() => {
      expect(rows()).toHaveTextContent('t-1:-');
    });
    vi.mocked(listTransactions).mockClear();

    act(() => {
      screen.getByRole('button', { name: 'assign' }).click();
    });

    expect(rows()).toHaveTextContent('t-1:cat-wohnen');
    expect(listTransactions).not.toHaveBeenCalled();
  });

  it('shows what an import added after a reload', async () => {
    stored = { 'acc-1': [row('t-1')], 'acc-2': [] };
    render(
      <HouseholdProvider>
        <Probe />
      </HouseholdProvider>,
    );
    await waitFor(() => {
      expect(rows()).toHaveTextContent('t-1:-');
    });

    stored = { 'acc-1': [row('t-1'), row('t-new')], 'acc-2': [] };
    act(() => {
      screen.getByRole('button', { name: 'reload' }).click();
    });

    await waitFor(() => {
      expect(rows()).toHaveTextContent('t-1:-,t-new:-');
    });
  });
});
