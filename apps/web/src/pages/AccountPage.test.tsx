import { type AccountPayload, type TransactionPayload } from '@household-budget/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listTransactions } from '../api/client';
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
  // A `vi.fn`, not a plain arrow: "changing a filter issues no request" is a claim about
  // how many times this was called, and a plain arrow cannot be counted.
  listTransactions: vi.fn(
    (accountId: string) =>
      new Promise<TransactionPayload[]>((resolve) => {
        pending.set(accountId, resolve);
      }),
  ),
}));

/** The page renders the app's nav, and `NavLink` needs a router around it. */
const page = () => (
  <MemoryRouter>
    <AccountPage />
  </MemoryRouter>
);

function row(
  id: string,
  counterpartyName: string,
  overrides: Partial<TransactionPayload> = {},
): TransactionPayload {
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
    ...overrides,
  };
}

beforeEach(() => {
  pending.clear();
  writes.length = 0;
  vi.mocked(listTransactions).mockClear();
});

/** Renders the page and answers the first account's load with the rows given. */
async function withRows(rows: TransactionPayload[]): Promise<void> {
  render(page());
  await waitFor(() => {
    expect(pending.has('acc-1')).toBe(true);
  });
  pending.get('acc-1')?.(rows);
  await screen.findByRole('combobox', { name: 'Monat' });
}

function chooseOption(name: string, option: string | RegExp): void {
  fireEvent.mouseDown(screen.getByRole('combobox', { name }));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

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

describe('AccountPage, filtering', () => {
  const SEPTEMBER = row('t-1', 'Müller GmbH');
  const OLD = row('t-2', 'Versicherung AG', { bookingDate: '2014-03-24' });

  it('narrows the table without asking the server again', async () => {
    // The rows are already here. A filter that fetched would also undo the in-place
    // replacement `changeCategory` exists to keep.
    await withRows([SEPTEMBER, OLD]);
    expect(screen.getByRole('cell', { name: 'Versicherung AG' })).toBeInTheDocument();

    chooseOption('Monat', 'September 2025');

    await waitFor(() => {
      expect(screen.queryByRole('cell', { name: 'Versicherung AG' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('cell', { name: 'Müller GmbH' })).toBeInTheDocument();
    expect(vi.mocked(listTransactions)).toHaveBeenCalledOnce();
  });

  it('searches the rows it already has, one keystroke at a time', async () => {
    await withRows([SEPTEMBER, OLD]);

    // Lower case against a capital Ü: the case the database cannot fold, typed into the
    // page that can.
    fireEvent.change(screen.getByRole('textbox', { name: 'Suche' }), {
      target: { value: 'müller' },
    });

    await waitFor(() => {
      expect(screen.queryByRole('cell', { name: 'Versicherung AG' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('cell', { name: 'Müller GmbH' })).toBeInTheDocument();
    expect(vi.mocked(listTransactions)).toHaveBeenCalledOnce();
  });

  it('counts the account, not the view', async () => {
    // The number answers "how much is left to do". One that moved as the user narrowed
    // the list could not.
    await withRows([SEPTEMBER, OLD]);
    expect(screen.getByText('2 ohne Kategorie')).toBeInTheDocument();

    chooseOption('Monat', 'September 2025');

    expect(screen.getByText('2 ohne Kategorie')).toBeInTheDocument();
  });

  it('says a filter matched nothing rather than inviting another import', async () => {
    await withRows([SEPTEMBER]);

    // A combination no row satisfies: September has rows, Wohnen has rows elsewhere,
    // and together they have none. "Import a CSV export" is wrong advice here.
    chooseOption('Kategorie filtern', 'Wohnen');

    expect(await screen.findByText('Keine Umsätze für diese Auswahl.')).toBeInTheDocument();
    expect(screen.queryByText(/Noch keine Umsätze/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(await screen.findByRole('cell', { name: 'Müller GmbH' })).toBeInTheDocument();
  });

  it('drops a row out of the Ohne Kategorie filter the moment it is categorized', async () => {
    await withRows([SEPTEMBER, row('t-3', 'REWE Filiale 7', { categoryId: 'cat-wohnen' })]);
    expect(screen.getByText('1 ohne Kategorie')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Nur Umsätze ohne Kategorie zeigen/ }));
    await waitFor(() => {
      expect(screen.queryByRole('cell', { name: 'REWE Filiale 7' })).not.toBeInTheDocument();
    });

    chooseWohnen();
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    writes[0]?.resolve({
      ...SEPTEMBER,
      categoryId: 'cat-wohnen',
      categoryLockedAt: '2026-09-23T08:00:00.000Z',
    });

    // The row leaves the filter it no longer belongs to, and the count falls with it —
    // the same event, which is why neither is cached separately.
    await waitFor(() => {
      expect(screen.queryByRole('cell', { name: 'Müller GmbH' })).not.toBeInTheDocument();
    });
    expect(screen.getByText('Alle kategorisiert')).toBeInTheDocument();
  });

  it('forgets the filters when the account changes', async () => {
    // September 2025 against an account whose history ends in 2023 shows an empty table,
    // which reads as a bug rather than as a filter.
    await withRows([SEPTEMBER, OLD]);
    chooseOption('Monat', 'September 2025');
    fireEvent.click(screen.getByRole('button', { name: /Nur Umsätze ohne Kategorie zeigen/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Suche' }), {
      target: { value: 'müller' },
    });

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Konto' }));
    fireEvent.click(screen.getByRole('option', { name: /Tagesgeld/ }));

    await waitFor(() => {
      expect(pending.has('acc-2')).toBe(true);
    });
    pending.get('acc-2')?.([row('t-9', 'Stadtwerke', { bookingDate: '2023-05-02' })]);

    expect(await screen.findByRole('cell', { name: 'Stadtwerke' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Monat' })).toHaveTextContent('Alle Monate');
    expect(screen.getByRole('combobox', { name: 'Kategorie filtern' })).toHaveTextContent(
      'Alle Kategorien',
    );
    expect(screen.getByRole('textbox', { name: 'Suche' })).toHaveValue('');
  });

  it('lands already narrowed when the budgets page sends the user here', async () => {
    // The uncategorized row on /budgets hands over its account, month and bucket through
    // router state — the rows it counted, not the first account's rows for every month.
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/',
            state: { accountId: 'acc-2', month: '2025-09', categoryId: 'uncategorized' },
          },
        ]}
      >
        <AccountPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(pending.has('acc-2')).toBe(true);
    });
    expect(pending.has('acc-1')).toBe(false);
    pending.get('acc-2')?.([
      row('t-1', 'Ärzte GmbH'),
      row('t-2', 'Müller GmbH', { categoryId: 'cat-wohnen' }),
      row('t-3', 'Versicherung Nord AG', { bookingDate: '2014-03-24' }),
    ]);

    expect(await screen.findByRole('cell', { name: 'Ärzte GmbH' })).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'Müller GmbH' })).toBeNull();
    expect(screen.queryByRole('cell', { name: 'Versicherung Nord AG' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Monat' })).toHaveTextContent('September 2025');
    expect(screen.getByRole('combobox', { name: 'Kategorie filtern' })).toHaveTextContent(
      'Ohne Kategorie',
    );
  });
});
