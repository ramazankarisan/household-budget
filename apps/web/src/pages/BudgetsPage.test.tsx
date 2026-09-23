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

/** Answers every account's load: Giro's rows, and whatever Tagesgeld is given. */
async function answerAccounts(
  giro: TransactionPayload[],
  tagesgeld: TransactionPayload[] = [],
): Promise<void> {
  await waitFor(() => {
    expect(loads.has('acc-1') && loads.has('acc-2')).toBe(true);
  });
  loads.get('acc-1')?.(giro);
  loads.get('acc-2')?.(tagesgeld);
}

/** Renders the page with every account loaded and September's limits answered. */
async function withGiro(
  budgets: BudgetPayload[] = [],
  tagesgeld: TransactionPayload[] = [],
): Promise<void> {
  render(app());
  await answerAccounts(GIRO_ROWS, tagesgeld);
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
    // Once per account, on mount, and never again for a month switch.
    expect(listTransactions).toHaveBeenCalledTimes(ACCOUNTS.length);
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

  it('measures a household limit against every account, not the one on screen', async () => {
    // 400 € from each account against a 700 € limit: each account alone is under it, the
    // household is 100 € over. The limit belongs to the household, so the page says over.
    render(app());
    await answerAccounts(
      [row({ amountCents: -40000, categoryId: 'cat-essen' })],
      [row({ amountCents: -40000, categoryId: 'cat-essen' })],
    );
    await waitFor(() => {
      expect(budgetLoads.has('2025-09')).toBe(true);
    });
    budgetLoads.get('2025-09')?.([
      { categoryId: 'cat-essen', month: '2025-09', amountCents: 70000 },
    ]);

    await screen.findByRole('textbox', { name: 'Budget Lebensmittel' });
    expect(plain(rowOf('Lebensmittel').textContent)).toContain('800,00 €');
    expect(plain(rowOf('Lebensmittel').textContent)).toContain('100,00 € über');
    // No account to pick: a picker would only let the same limit flip between answers.
    expect(screen.queryByRole('combobox', { name: 'Konto' })).toBeNull();
  });

  it('offers every month any account has', async () => {
    await withGiro([], [row({ bookingDate: '2024-01-10', amountCents: -5000 })]);

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Monat' }));
    const options = screen.getAllByRole('option').map((option) => option.textContent);

    expect(options).toEqual(['September 2025', 'Januar 2024', 'März 2014']);
  });

  it('keeps a slow write in one month from locking the same category in another', async () => {
    await withGiro();

    const field = screen.getByRole('textbox', { name: 'Budget Wohnen' });
    fireEvent.change(field, { target: { value: '700' } });
    fireEvent.blur(field);
    expect(screen.getByRole('textbox', { name: 'Budget Wohnen' })).toBeDisabled();

    // September's PUT is still unanswered when the user moves on.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Monat' }));
    fireEvent.click(screen.getByRole('option', { name: 'März 2014' }));
    await waitFor(() => {
      expect(budgetLoads.has('2014-03')).toBe(true);
    });
    budgetLoads.get('2014-03')?.([]);

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Budget Wohnen' })).toBeEnabled();
    });
  });

  it('resets only the field whose write was refused, not the one being typed in', async () => {
    await withGiro([{ categoryId: 'cat-wohnen', month: '2025-09', amountCents: 70000 }]);

    const wohnen = screen.getByRole('textbox', { name: 'Budget Wohnen' });
    fireEvent.change(wohnen, { target: { value: '900' } });
    fireEvent.blur(wohnen);
    // The user has moved on to the next cell before the first answer arrives.
    const essen = screen.getByRole('textbox', { name: 'Budget Lebensmittel' });
    fireEvent.change(essen, { target: { value: '45' } });

    writes[0]?.reject(new Error('Netzwerkfehler'));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Budget Wohnen' })).toHaveValue('700,00');
    });
    expect(screen.getByRole('textbox', { name: 'Budget Lebensmittel' })).toHaveValue('45');
  });

  it('opens the list on the account holding this month’s uncategorized rows', async () => {
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

  it('skips an account with nothing uncategorized that month', async () => {
    // Giro's uncategorized spending is all in March 2014; September's is on Tagesgeld.
    render(app());
    await answerAccounts(
      [
        row({ amountCents: -87507, categoryId: 'cat-wohnen' }),
        row({ bookingDate: '2014-03-24', amountCents: -114341 }),
      ],
      [row({ amountCents: -4217 })],
    );
    await waitFor(() => {
      expect(budgetLoads.has('2025-09')).toBe(true);
    });
    budgetLoads.get('2025-09')?.([]);

    fireEvent.click(
      within(await screen.findByRole('row', { name: /Ohne Kategorie/ })).getByRole('button', {
        name: 'Ohne Kategorie',
      }),
    );

    const state = await screen.findByRole('status', { name: 'list state' });
    expect(JSON.parse(state.textContent)).toMatchObject({ accountId: 'acc-2' });
  });

  it('invites an import when no account has anything to report on', async () => {
    render(app());
    await answerAccounts([], []);

    expect(
      await screen.findByText('Noch keine Umsätze. Importieren Sie einen CSV-Export.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zu den Umsätzen' })).toHaveAttribute('href', '/');
  });
});
