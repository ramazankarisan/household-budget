import {
  type AccountPayload,
  type BudgetPayload,
  type TransactionPayload,
} from '@household-budget/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listBudgets, listTransactions } from '../api/client';
import { HouseholdProvider } from '../household/HouseholdProvider';
import i18n from '../locales/i18n';
import { OverviewPage } from './OverviewPage';

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
  listRules: () => Promise.resolve([]),
  listCategories: () =>
    Promise.resolve([
      { id: 'cat-essen', name: 'Lebensmittel', colorIndex: 0 },
      { id: 'cat-wohnen', name: 'Wohnen', colorIndex: 1 },
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
  row({ amountCents: -87507, categoryId: 'cat-wohnen', counterpartyName: 'Hausverwaltung' }),
  row({ amountCents: -151067 }),
  row({ amountCents: -1900, status: 'pending' }),
  row({ amountCents: 245000, counterpartyName: 'Beispiel AG' }),
  row({ bookingDate: '2014-03-24', amountCents: -114341 }),
];

/** Where a link to the list lands, and with which search. */
function ListProbe() {
  const location = useLocation();
  return <output aria-label="list search">{location.search}</output>;
}

const app = (entry = '/') => (
  <MemoryRouter initialEntries={[entry]}>
    <HouseholdProvider>
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/transactions" element={<ListProbe />} />
      </Routes>
    </HouseholdProvider>
  </MemoryRouter>
);

/** `Intl` puts U+00A0 between the amount and the €. */
const plain = (text: string | null): string => (text ?? '').replaceAll('\u00a0', ' ');

/** A category's row: every row is a list item that starts with its name. */
const rowOf = (name: string) =>
  screen
    .getAllByRole('listitem')
    .find((element) => element.textContent.includes(name)) as HTMLElement;

/** A category's bar, whose name is the sentence the bar shows. */
const barOf = (name: string) => screen.getByRole('img', { name: new RegExp(`^${name}:`) });

/** The month stepper's label button; its name carries the month shown. */
const monthButton = (label = 'Monat wählen') =>
  screen.getByRole('button', { name: new RegExp(`^${label}`) });

function openMonths(label = 'Monat wählen'): string[] {
  fireEvent.click(monthButton(label));
  return screen.getAllByRole('menuitem').map((item) => item.textContent);
}

function chooseMonth(name: string): void {
  fireEvent.click(monthButton());
  fireEvent.click(screen.getByRole('menuitem', { name }));
}

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

/**
 * Renders the page with every account loaded and September's limits answered — in edit
 * mode when asked, where each limit is a field.
 */
async function withGiro(
  budgets: BudgetPayload[] = [],
  { tagesgeld = [], editing = false }: { tagesgeld?: TransactionPayload[]; editing?: boolean } = {},
): Promise<void> {
  render(app());
  await answerAccounts(GIRO_ROWS, tagesgeld);
  await waitFor(() => {
    expect(budgetLoads.has('2025-09')).toBe(true);
  });
  budgetLoads.get('2025-09')?.(budgets);
  await screen.findByRole('button', { name: 'Budgets bearbeiten' });
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Budgets bearbeiten' })).toBeEnabled();
  });
  if (editing) {
    fireEvent.click(screen.getByRole('button', { name: 'Budgets bearbeiten' }));
    await screen.findByRole('textbox', { name: 'Budget Wohnen' });
  }
}

describe('OverviewPage', () => {
  it('opens on the newest month, and answers it first', async () => {
    await withGiro([{ categoryId: 'cat-wohnen', month: '2025-09', amountCents: 70000 }]);

    expect(monthButton()).toHaveTextContent('September 2025');
    expect(screen.getByText('Ausgegeben im September 2025')).toBeInTheDocument();
    expect(plain(rowOf('Wohnen').textContent)).toContain('175,07 € über');
    expect(plain(screen.getByText(/von 700,00 €/).textContent)).toBe(
      '2.385,74 € von 700,00 € · 1.685,74 € über · 19,00 € vorgemerkt',
    );
  });

  it('says „über“ in the bar’s name as well as its colour', async () => {
    await withGiro([{ categoryId: 'cat-wohnen', month: '2025-09', amountCents: 70000 }]);

    expect(plain(barOf('Wohnen').getAttribute('aria-label'))).toBe(
      'Wohnen: 875,07 € von 700,00 €, 175,07 € über',
    );
    expect(barOf('Wohnen')).toHaveAttribute('data-tone', 'over');
  });

  it('shows vorgemerkt beside the headline, never inside it', async () => {
    await withGiro();

    expect(
      screen.getByText('19,00 € vorgemerkt, nicht mitgezählt', { normalizer: plain }),
    ).toBeInTheDocument();
  });

  it('lists only the months the accounts have, newest first', async () => {
    await withGiro();

    expect(openMonths()).toEqual(['September 2025', 'März 2014']);
  });

  it('re-derives the month from rows already loaded', async () => {
    await withGiro();

    chooseMonth('März 2014');

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
    await withGiro([], { editing: true });

    expect(screen.getByRole('textbox', { name: 'Budget Wohnen' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Budget Lebensmittel' })).toHaveValue('');
    expect(writes).toHaveLength(0);
  });

  it('writes a typed limit and replaces that one limit in place', async () => {
    await withGiro([], { editing: true });

    const field = screen.getByRole('textbox', { name: 'Budget Wohnen' });
    fireEvent.change(field, { target: { value: '700' } });
    fireEvent.blur(field);

    expect(writes).toMatchObject([
      { month: '2025-09', categoryId: 'cat-wohnen', amountCents: 70000 },
    ]);
    writes[0]?.resolve({ categoryId: 'cat-wohnen', month: '2025-09', amountCents: 70000 });

    await waitFor(() => {
      expect(plain(barOf('Wohnen').getAttribute('aria-label'))).toContain('175,07 € über');
    });
    // Nothing was reloaded to learn it.
    expect(listBudgets).toHaveBeenCalledOnce();
  });

  it('surfaces a failed write in the one alert and keeps the previous number', async () => {
    await withGiro([{ categoryId: 'cat-wohnen', month: '2025-09', amountCents: 70000 }], {
      editing: true,
    });

    const field = screen.getByRole('textbox', { name: 'Budget Wohnen' });
    fireEvent.change(field, { target: { value: '900' } });
    fireEvent.blur(field);
    writes[0]?.reject(new Error('Netzwerkfehler'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Netzwerkfehler');
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Budget Wohnen' })).toHaveValue('700,00');
    });
    expect(plain(barOf('Wohnen').getAttribute('aria-label'))).toContain('175,07 € über');
  });

  it('measures a household limit against every account, not one of them', async () => {
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

    await waitFor(() => {
      expect(plain(rowOf('Lebensmittel').textContent)).toContain('100,00 € über');
    });
    expect(plain(rowOf('Lebensmittel').textContent)).toContain('800,00 €');
    // No account to pick: a picker would only let the same limit flip between answers.
    expect(screen.queryByRole('combobox', { name: 'Konto' })).toBeNull();
  });

  it('offers every month any account has', async () => {
    await withGiro([], { tagesgeld: [row({ bookingDate: '2024-01-10', amountCents: -5000 })] });

    expect(openMonths()).toEqual(['September 2025', 'Januar 2024', 'März 2014']);
  });

  it('keeps a slow write in one month from locking the same category in another', async () => {
    await withGiro([], { editing: true });

    const field = screen.getByRole('textbox', { name: 'Budget Wohnen' });
    fireEvent.change(field, { target: { value: '700' } });
    fireEvent.blur(field);
    expect(screen.getByRole('textbox', { name: 'Budget Wohnen' })).toBeDisabled();

    // September's PUT is still unanswered when the user moves on.
    chooseMonth('März 2014');
    await waitFor(() => {
      expect(budgetLoads.has('2014-03')).toBe(true);
    });
    budgetLoads.get('2014-03')?.([]);

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Budget Wohnen' })).toBeEnabled();
    });
  });

  it('resets only the field whose write was refused, not the one being typed in', async () => {
    await withGiro([{ categoryId: 'cat-wohnen', month: '2025-09', amountCents: 70000 }], {
      editing: true,
    });

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

  it('leads „Ohne Kategorie“ to the account holding this month’s rows', async () => {
    await withGiro();

    const uncategorized = rowOf('Ohne Kategorie');
    expect(within(uncategorized).queryByRole('textbox')).toBeNull();
    fireEvent.click(within(uncategorized).getByRole('link', { name: 'Anzeigen' }));

    const search = await screen.findByRole('status', { name: 'list search' });
    expect(search).toHaveTextContent('?m=2025-09&c=uncategorized&a=acc-1');
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

    await waitFor(() => {
      expect(rowOf('Ohne Kategorie')).toBeDefined();
    });
    fireEvent.click(within(rowOf('Ohne Kategorie')).getByRole('link', { name: 'Anzeigen' }));

    expect(await screen.findByRole('status', { name: 'list search' })).toHaveTextContent('a=acc-2');
  });

  it('counts what is left to sort, the same way everywhere', async () => {
    // Giro: one booked uncategorized outflow and the salary this month, one in March 2014;
    // the vorgemerkt row cannot be sorted yet and is not counted.
    await withGiro();

    const callout = screen.getByRole('link', { name: /Zu sortieren: 3/ });
    expect(callout).toHaveTextContent('davon 2 im September 2025');
  });

  it('invites an import when no account has anything to report on', async () => {
    render(app());
    await answerAccounts([], []);

    expect(
      await screen.findByText('Noch keine Umsätze. Importieren Sie einen CSV-Export.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zu den Umsätzen' })).toHaveAttribute(
      'href',
      '/transactions',
    );
  });

  it('keeps the page on screen while another month’s limits load', async () => {
    // Dogfood ISSUE-009: a month switch used to swap the whole page for a spinner.
    await withGiro([{ categoryId: 'cat-wohnen', month: '2025-09', amountCents: 70000 }], {
      editing: true,
    });

    chooseMonth('März 2014');
    await waitFor(() => {
      expect(budgetLoads.has('2014-03')).toBe(true);
    });

    // March's limits are still unanswered: stepper, rows and spending are all there.
    expect(monthButton()).toHaveTextContent('März 2014');
    expect(screen.getByText('1.143,41 € ausgegeben', { normalizer: plain })).toBeInTheDocument();
    expect(within(rowOf('Wohnen')).getAllByLabelText('Budgets werden geladen')).toHaveLength(2);
    expect(screen.queryByRole('textbox', { name: 'Budget Wohnen' })).toBeNull();

    budgetLoads.get('2014-03')?.([
      { categoryId: 'cat-wohnen', month: '2014-03', amountCents: 50000 },
    ]);

    expect(await screen.findByRole('textbox', { name: 'Budget Wohnen' })).toHaveValue('500,00');
  });

  it('fetches each month’s limits once, however often it is shown', async () => {
    await withGiro([{ categoryId: 'cat-wohnen', month: '2025-09', amountCents: 70000 }], {
      editing: true,
    });

    chooseMonth('März 2014');
    await waitFor(() => {
      expect(budgetLoads.has('2014-03')).toBe(true);
    });
    budgetLoads.get('2014-03')?.([]);
    await screen.findByText('1.143,41 € von — · kein Budget gesetzt', { normalizer: plain });

    chooseMonth('September 2025');

    // Straight back, with no load in between: the field is there on the next render.
    expect(screen.getByRole('textbox', { name: 'Budget Wohnen' })).toHaveValue('700,00');
    expect(vi.mocked(listBudgets).mock.calls.map(([month]) => month)).toEqual([
      '2025-09',
      '2014-03',
    ]);
  });

  it('keeps a write in the cached month when the user comes back to it', async () => {
    await withGiro([], { editing: true });

    const field = screen.getByRole('textbox', { name: 'Budget Wohnen' });
    fireEvent.change(field, { target: { value: '700' } });
    fireEvent.blur(field);
    writes[0]?.resolve({ categoryId: 'cat-wohnen', month: '2025-09', amountCents: 70000 });
    await waitFor(() => {
      expect(plain(barOf('Wohnen').getAttribute('aria-label'))).toContain('175,07 € über');
    });

    chooseMonth('März 2014');
    await waitFor(() => {
      expect(budgetLoads.has('2014-03')).toBe(true);
    });
    budgetLoads.get('2014-03')?.([]);
    await screen.findByText('1.143,41 € von — · kein Budget gesetzt', { normalizer: plain });

    chooseMonth('September 2025');

    expect(screen.getByRole('textbox', { name: 'Budget Wohnen' })).toHaveValue('700,00');
    expect(listBudgets).toHaveBeenCalledTimes(2);
  });

  it('opens on the month a link names', async () => {
    render(app('/?m=2014-03'));
    await answerAccounts(GIRO_ROWS);

    await waitFor(() => {
      expect(monthButton()).toHaveTextContent('März 2014');
    });
  });
});

describe('OverviewPage, in English', () => {
  it('switches its words and month names without a reload, keeping amounts German', async () => {
    await withGiro([{ categoryId: 'cat-wohnen', month: '2025-09', amountCents: 70000 }]);

    await act(async () => {
      await i18n.changeLanguage('en');
    });

    expect(await screen.findByRole('heading', { name: 'Budgets by category' })).toBeInTheDocument();
    expect(plain(rowOf('Wohnen').textContent)).toContain('175,07 € over');
    expect(plain(screen.getByText(/of 700,00 €/).textContent)).toBe(
      '2.385,74 € of 700,00 € · 1.685,74 € over · 19,00 € pending',
    );
    expect(openMonths('Choose month')).toEqual(['September 2025', 'March 2014']);
  });
});
