import {
  type CategoryPayload,
  type RulePayload,
  type TransactionPayload,
} from '@household-budget/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyRules, createRule, setTransactionCategory } from '../api/client';
import { HouseholdProvider } from '../household/HouseholdProvider';
import { CategoryMenu } from '../ui/CategoryMenu';
import { InboxPage } from './InboxPage';

const CATEGORIES: CategoryPayload[] = [
  { id: 'cat-abos', name: 'Abos', colorIndex: 0 },
  { id: 'cat-essen', name: 'Lebensmittel', colorIndex: 1 },
  { id: 'cat-wohnen', name: 'Wohnen', colorIndex: 2 },
];

function row(id: string, overrides: Partial<TransactionPayload> = {}): TransactionPayload {
  return {
    id,
    bookingDate: '2025-09-22',
    valueDate: null,
    amountCents: -1099,
    currency: 'EUR',
    status: 'booked',
    counterpartyName: 'PayPal Europe S.à r.l.',
    counterpartyIban: null,
    purpose: 'SPOTIFY AB',
    bookingText: null,
    bankCategory: null,
    categoryId: null,
    categoryLockedAt: null,
    ...overrides,
  };
}

let stored: TransactionPayload[] = [];
const rules: RulePayload[] = [];

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  listAccounts: () =>
    Promise.resolve([{ id: 'acc-1', iban: 'DE89370400440532013000', name: 'Giro' }]),
  listCategories: () => Promise.resolve(CATEGORIES),
  listRules: () => Promise.resolve(rules),
  listTransactions: () => Promise.resolve(stored),
  setTransactionCategory: vi.fn((id: string, categoryId: string | null) => {
    stored = stored.map((one) => (one.id === id ? { ...one, categoryId } : one));
    const updated = stored.find((one) => one.id === id);
    return updated === undefined ? Promise.reject(new Error('gone')) : Promise.resolve(updated);
  }),
  createCategory: vi.fn((name: string) =>
    Promise.resolve({ id: `cat-${name.toLowerCase()}`, name, colorIndex: 3 }),
  ),
  createRule: vi.fn(() => Promise.resolve({})),
  applyRules: vi.fn(() => Promise.resolve({ evaluated: 0, assigned: 0, cleared: 0, locked: 0 })),
}));

const page = () => (
  <MemoryRouter initialEntries={['/inbox']}>
    <HouseholdProvider>
      <InboxPage />
    </HouseholdProvider>
  </MemoryRouter>
);

beforeEach(() => {
  vi.mocked(setTransactionCategory).mockClear();
  vi.mocked(createRule).mockClear();
  vi.mocked(applyRules).mockClear();
});

describe('InboxPage', () => {
  it('shows one unsorted row at a time, and never a vorgemerkt one', async () => {
    stored = [
      row('t-1', { counterpartyName: 'Erste GmbH', bookingDate: '2025-09-22' }),
      row('t-2', { counterpartyName: 'Zweite GmbH', bookingDate: '2025-09-01' }),
      row('t-3', { counterpartyName: 'Vorgemerkt AG', status: 'pending' }),
    ];
    render(page());

    expect(await screen.findByRole('article', { name: 'Erste GmbH' })).toBeInTheDocument();
    expect(screen.getByText('0 von 2')).toBeInTheDocument();
    expect(screen.queryByText('Vorgemerkt AG')).toBeNull();
  });

  it('sorts the row with a number key, and offers the rule that would have', async () => {
    stored = [row('t-1')];
    render(page());
    await screen.findByRole('article');

    fireEvent.keyDown(window, { key: '1' });

    await waitFor(() => {
      expect(setTransactionCategory).toHaveBeenCalledWith('t-1', 'cat-abos');
    });
    const proposal = await screen.findByRole('region', { name: 'Regel daraus machen?' });
    expect(within(proposal).getByRole('textbox', { name: 'Suchbegriff' })).toHaveValue('paypal');
  });

  it('ignores number keys while a field has focus', async () => {
    stored = [row('t-1'), row('t-2', { counterpartyName: 'Zweite GmbH' })];
    render(page());
    await screen.findByRole('article');
    fireEvent.keyDown(window, { key: '1' });
    const value = await screen.findByRole('textbox', { name: 'Suchbegriff' });
    vi.mocked(setTransactionCategory).mockClear();

    fireEvent.keyDown(value, { key: '2' });

    expect(setTransactionCategory).not.toHaveBeenCalled();
  });

  it('creates the rule and runs every rule when asked, with R', async () => {
    stored = [row('t-1')];
    render(page());
    await screen.findByRole('article');
    fireEvent.keyDown(window, { key: '1' });
    await screen.findByRole('region', { name: 'Regel daraus machen?' });

    fireEvent.keyDown(window, { key: 'r' });

    await waitFor(() => {
      expect(applyRules).toHaveBeenCalledOnce();
    });
    expect(createRule).toHaveBeenCalledWith({
      field: 'counterpartyName',
      operator: 'contains',
      value: 'paypal',
      categoryId: 'cat-abos',
      active: true,
    });
  });

  it('takes the last one back with Z', async () => {
    stored = [row('t-1'), row('t-2', { counterpartyName: 'Zweite GmbH' })];
    render(page());
    await screen.findByRole('article');
    fireEvent.keyDown(window, { key: '1' });
    await waitFor(() => {
      expect(setTransactionCategory).toHaveBeenCalledTimes(1);
    });
    fireEvent.keyDown(window, { key: 'Escape' });

    fireEvent.keyDown(window, { key: 'z' });

    await waitFor(() => {
      expect(setTransactionCategory).toHaveBeenLastCalledWith('t-1', null);
    });
  });

  it('opens every category with M, past the ninth', async () => {
    stored = [row('t-1')];
    render(page());
    await screen.findByRole('article');

    fireEvent.keyDown(window, { key: 'm' });

    expect(await screen.findByRole('menu', { name: 'Kategorie wählen' })).toBeInTheDocument();
  });

  it('says so when everything is sorted', async () => {
    stored = [row('t-1', { categoryId: 'cat-abos' })];
    render(page());

    expect(await screen.findByText('Alles sortiert.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zum Überblick' })).toHaveAttribute('href', '/');
  });
});

describe('CategoryMenu', () => {
  function menu(onPick = vi.fn(), onCreate = vi.fn()) {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    render(
      <CategoryMenu
        anchorEl={anchor}
        onClose={vi.fn()}
        categories={CATEGORIES}
        currentId="cat-wohnen"
        onPick={onPick}
        onCreate={onCreate}
      />,
    );
    return { onPick, onCreate };
  }

  it('narrows as you type, whatever the case, and picks the first with Enter', () => {
    const { onPick } = menu();
    const search = screen.getByRole('textbox', { name: 'Kategorie suchen' });

    fireEvent.change(search, { target: { value: 'LEBEN' } });
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toContain(
      'Lebensmittel1',
    );
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(onPick).toHaveBeenCalledWith('cat-essen');
  });

  it('offers a new category for a name that does not exist', () => {
    const { onCreate } = menu();

    fireEvent.change(screen.getByRole('textbox', { name: 'Kategorie suchen' }), {
      target: { value: 'Kinder' },
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Neue Kategorie „Kinder“' }));

    expect(onCreate).toHaveBeenCalledWith('Kinder');
  });

  it('can take the category away again', () => {
    const { onPick } = menu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Kategorie entfernen' }));

    expect(onPick).toHaveBeenCalledWith(null);
  });
});
