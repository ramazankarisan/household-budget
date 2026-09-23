import {
  type AccountPayload,
  type BudgetPayload,
  type TransactionPayload,
} from '@household-budget/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listBudgets, listTransactions } from '../api/client';
import { BudgetsPage } from './BudgetsPage';

const ACCOUNTS: AccountPayload[] = [
  { id: 'acc-1', iban: 'DE89370400440532013000', name: 'Giro' },
  { id: 'acc-2', iban: 'DE02120300000000202051', name: 'Tagesgeld' },
];

/** One deferred transactions load per account, answered when the test says so. */
const loads = new Map<string, (rows: TransactionPayload[]) => void>();
/** One deferred budgets load per month. */
const budgetLoads = new Map<string, (rows: BudgetPayload[]) => void>();
/** Every budget write, unanswered until the test decides how it lands. */
const writes: {
  readonly month: string;
  readonly categoryId: string;
  readonly amountCents: number;
  readonly resolve: (saved: BudgetPayload) => void;
  readonly reject: (cause: unknown) => void;
}[] = [];

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  listAccounts: () => Promise.resolve(ACCOUNTS),
  listCategories: () =>
    Promise.resolve([
      { id: 'cat-essen', name: 'Lebensmittel' },
      { id: 'cat-wohnen', name: 'Wohnen' },
    ]),
  // Counted: "a month switch refetches nothing but that month's limits" is a claim about
  // how many times this was called.
  listTransactions: vi.fn(
    (accountId: string) =>
      new Promise<TransactionPayload[]>((resolve) => {
        loads.set(accountId, resolve);
      }),
  ),
  listBudgets: vi.fn(
    (month: string) =>
      new Promise<BudgetPayload[]>((resolve) => {
        budgetLoads.set(month, resolve);
      }),
  ),
  setBudget: (month: string, categoryId: string, amountCents: number) =>
    new Promise<BudgetPayload>((resolve, reject) => {
      writes.push({ month, categoryId, amountCents, resolve, reject });
    }),
  clearBudget: () => Promise.resolve(),
}));

function row(overrides: Partial<TransactionPayload>): TransactionPayload {
  return {
    id: `t-${String(Math.random())}`,
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

const GIRO_ROWS = [
  row({ amountCents: -87507, categoryId: 'cat-wohnen' }),
  row({ amountCents: -151067 }),
  row({ amountCents: -1900, status: 'pending' }),
  row({ amountCents: 245000, counterpartyName: 'Beispiel AG' }),
  row({ bookingDate: '2014-03-24', amountCents: -114341 }),
];

/** Where the uncategorized row sends the user, and with what. */
function ListProbe() {
  const location = useLocation();
  return <output aria-label="list state">{JSON.stringify(location.state)}</output>;
}

const app = () => (
  <MemoryRouter initialEntries={['/budgets']}>
    <Routes>
      <Route path="/budgets" element={<BudgetsPage />} />
      <Route path="/" element={<ListProbe />} />
    </Routes>
  </MemoryRouter>
);

/** `Intl` puts U+00A0 between the amount and the €. */
const plain = (text: string | null): string => (text ?? '').replaceAll('\u00a0', ' ');

const rowOf = (name: string) =>
  screen.getAllByRole('row').find((element) => element.textContent.includes(name)) as HTMLElement;

beforeEach(() => {
  loads.clear();
  budgetLoads.clear();
  writes.length = 0;
  vi.mocked(listTransactions).mockClear();
  vi.mocked(listBudgets).mockClear();
});

/** Renders the page with Giro's rows loaded and September's limits answered. */
async function withGiro(budgets: BudgetPayload[] = []): Promise<void> {
  render(app());
  await waitFor(() => {
    expect(loads.has('acc-1')).toBe(true);
  });
  loads.get('acc-1')?.(GIRO_ROWS);
  await waitFor(() => {
    expect(budgetLoads.has('2025-09')).toBe(true);
  });
  budgetLoads.get('2025-09')?.(budgets);
  await screen.findByRole('textbox', { name: 'Budget Wohnen' });
}

describe('BudgetsPage', () => {
  it('opens on the newest month the account has', async () => {
    await withGiro([{ categoryId: 'cat-wohnen', month: '2025-09', amountCents: 70000 }]);

    expect(screen.getByRole('combobox', { name: 'Monat' })).toHaveTextContent('September 2025');
    expect(plain(rowOf('Wohnen').textContent)).toContain('175,07 € über');
    expect(plain(screen.getByText(/von 700,00 €/).textContent)).toBe(
      '2.385,74 € von 700,00 € · 1.685,74 € über · 19,00 € vorgemerkt',
    );
  });

  it('lists only the months the account has, newest first', async () => {
    await withGiro();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Monat' }));
    const options = screen.getAllByRole('option').map((option) => option.textContent);

    expect(options).toEqual(['September 2025', 'März 2014']);
  });

  it('re-derives the table for another month without refetching the rows', async () => {
    await withGiro();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Monat' }));
    fireEvent.click(screen.getByRole('option', { name: 'März 2014' }));

    await waitFor(() => {
      expect(budgetLoads.has('2014-03')).toBe(true);
    });
    budgetLoads.get('2014-03')?.([]);

    expect(
      await screen.findByText('1.143,41 € von — · kein Budget gesetzt', { normalizer: plain }),
    ).toBeInTheDocument();
    expect(listTransactions).toHaveBeenCalledOnce();
  });

  it('shows a month with no limits with an empty field on every category', async () => {
    await withGiro();

    expect(screen.getByRole('textbox', { name: 'Budget Wohnen' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Budget Lebensmittel' })).toHaveValue('');
    expect(writes).toHaveLength(0);
  });

  it('writes a typed limit and replaces that one limit in place', async () => {
    await withGiro();

    const field = screen.getByRole('textbox', { name: 'Budget Wohnen' });
    fireEvent.change(field, { target: { value: '700' } });
    fireEvent.blur(field);

    expect(writes).toMatchObject([
      { month: '2025-09', categoryId: 'cat-wohnen', amountCents: 70000 },
    ]);
    writes[0]?.resolve({ categoryId: 'cat-wohnen', month: '2025-09', amountCents: 70000 });

    await waitFor(() => {
      expect(plain(rowOf('Wohnen').textContent)).toContain('175,07 € über');
    });
    // Nothing was reloaded to learn it.
    expect(listBudgets).toHaveBeenCalledOnce();
  });

  it('surfaces a failed write in the one alert and keeps the previous number', async () => {
    await withGiro([{ categoryId: 'cat-wohnen', month: '2025-09', amountCents: 70000 }]);

    const field = screen.getByRole('textbox', { name: 'Budget Wohnen' });
    fireEvent.change(field, { target: { value: '900' } });
    fireEvent.blur(field);
    writes[0]?.reject(new Error('Netzwerkfehler'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Netzwerkfehler');
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Budget Wohnen' })).toHaveValue('700,00');
    });
    expect(plain(rowOf('Wohnen').textContent)).toContain('175,07 € über');
  });

  it('drops the rows of an account the user already left', async () => {
    render(app());
    await waitFor(() => {
      expect(loads.has('acc-1')).toBe(true);
    });

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Konto' }));
    fireEvent.click(screen.getByRole('option', { name: /Tagesgeld/ }));
    await waitFor(() => {
      expect(loads.has('acc-2')).toBe(true);
    });

    // The new account answers first, the abandoned one afterwards — the order that makes
    // a late response overwrite a current one.
    loads.get('acc-2')?.([row({ bookingDate: '2024-01-10', amountCents: -5000 })]);
    loads.get('acc-1')?.(GIRO_ROWS);
    await waitFor(() => {
      expect(budgetLoads.has('2024-01')).toBe(true);
    });
    budgetLoads.get('2024-01')?.([]);

    expect(await screen.findByRole('combobox', { name: 'Monat' })).toHaveTextContent('Januar 2024');
    expect(screen.queryByText(/2\.385,74/, { normalizer: plain })).toBeNull();
  });

  it('opens the list on this account, this month, and only the uncategorized rows', async () => {
    await withGiro();

    const uncategorized = rowOf('Ohne Kategorie');
    expect(within(uncategorized).queryByRole('textbox')).toBeNull();
    fireEvent.click(within(uncategorized).getByRole('button', { name: 'Ohne Kategorie' }));

    const state = await screen.findByRole('status', { name: 'list state' });
    expect(JSON.parse(state.textContent)).toEqual({
      accountId: 'acc-1',
      month: '2025-09',
      categoryId: 'uncategorized',
    });
  });

  it('invites an import when the account has nothing to report on', async () => {
    render(app());
    await waitFor(() => {
      expect(loads.has('acc-1')).toBe(true);
    });
    loads.get('acc-1')?.([]);

    expect(
      await screen.findByText('Noch keine Umsätze. Importieren Sie einen CSV-Export.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zu den Umsätzen' })).toHaveAttribute('href', '/');
  });
});
