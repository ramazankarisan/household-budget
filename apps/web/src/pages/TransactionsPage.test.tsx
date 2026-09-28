import {
  type AccountPayload,
  type ImportBatchPayload,
  type TransactionPayload,
} from '@household-budget/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listTransactions, restoreImport, undoImport, uploadImport } from '../api/client';
import { HouseholdProvider } from '../household/HouseholdProvider';
import i18n from '../locales/i18n';
import { ImportDialog } from './import/ImportDialog';
import { ImportsPage } from './ImportsPage';
import { TransactionsPage } from './TransactionsPage';

let accounts: AccountPayload[] = [];
let stored: Record<string, TransactionPayload[]> = {};

/** Every category write, still unanswered, so a test can decide when and how it lands. */
const writes: {
  readonly transactionId: string;
  readonly categoryId: string | null;
  readonly resolve: (updated: TransactionPayload) => void;
  readonly reject: (cause: unknown) => void;
}[] = [];

const BATCHES: ImportBatchPayload[] = [
  {
    id: 'b-2',
    accountId: 'acc-1',
    fileName: 'september.csv',
    encoding: 'windows-1252',
    dialect: 'sparkasse-camt',
    importedAt: '2025-09-20T10:00:00.000Z',
    rowsParsed: 9,
    rowsImported: 0,
    rowsSkipped: 8,
    rowsRestored: 0,
    rowsFailed: 0,
    undoneAt: null,
  },
];
let batches: ImportBatchPayload[] = BATCHES;

vi.mock('../api/client', () => ({
  ApiError: class ApiError extends Error {},
  listAccounts: () => Promise.resolve(accounts),
  createAccount: vi.fn((iban: string, name: string) =>
    Promise.resolve({ id: 'acc-new', iban, name }),
  ),
  listCategories: () => Promise.resolve([{ id: 'cat-wohnen', name: 'Wohnen', colorIndex: 0 }]),
  listRules: () => Promise.resolve([]),
  // Counted: "narrowing issues no request" is a claim about how many times this was called.
  listTransactions: vi.fn((accountId: string) => Promise.resolve(stored[accountId] ?? [])),
  listImports: () => Promise.resolve(batches),
  undoImport: vi.fn((batchId: string) =>
    Promise.resolve({ ...BATCHES[0], id: batchId, undoneAt: '2025-09-21T10:00:00.000Z' }),
  ),
  restoreImport: vi.fn((batchId: string) =>
    Promise.resolve({ ...BATCHES[0], id: batchId, undoneAt: null }),
  ),
  createCategory: (name: string) => Promise.resolve({ id: `cat-${name}`, name, colorIndex: 1 }),
  uploadImport: vi.fn(() =>
    Promise.resolve({
      batchId: 'b-3',
      parsed: 1,
      imported: 1,
      skipped: 0,
      restored: 0,
      pendingReplaced: 0,
      categorized: 0,
      failed: [],
      failedCount: 0,
      encoding: 'utf-8',
      dialect: 'sparkasse-camt',
    }),
  ),
  setTransactionCategory: (transactionId: string, categoryId: string | null) =>
    new Promise<TransactionPayload>((resolve, reject) => {
      writes.push({ transactionId, categoryId, resolve, reject });
    }),
}));

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

const GIRO: AccountPayload = { id: 'acc-1', iban: 'DE89370400440532013000', name: 'Giro' };
const TAGESGELD: AccountPayload = {
  id: 'acc-2',
  iban: 'DE02120300000000202051',
  name: 'Tagesgeld',
};

const SEPTEMBER = row('t-1', 'Müller GmbH');
const OLD = row('t-2', 'Versicherung AG', { bookingDate: '2014-03-24' });

beforeEach(() => {
  accounts = [GIRO];
  stored = {};
  batches = BATCHES;
  writes.length = 0;
  vi.mocked(listTransactions).mockClear();
  vi.mocked(uploadImport).mockClear();
});

async function withRows(rows: TransactionPayload[], entry = '/transactions'): Promise<void> {
  stored = { 'acc-1': rows, ...stored };
  render(
    <MemoryRouter initialEntries={[entry]}>
      <HouseholdProvider>
        <TransactionsPage />
      </HouseholdProvider>
    </MemoryRouter>,
  );
  await screen.findByRole('combobox', { name: 'Kategorie filtern' });
}

/** A row of the ledger, by its counterparty. */
const rowOf = (name: string) => screen.queryByRole('listitem', { name });

function chooseMonth(label: string): void {
  fireEvent.click(screen.getByRole('button', { name: /^Monat wählen/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
}

describe('TransactionsPage, the ledger', () => {
  it('groups rows by day, newest first, and says what went out that day', async () => {
    await withRows([
      row('a', 'REWE', { bookingDate: '2025-09-18', amountCents: -5412 }),
      row('b', 'DB', { bookingDate: '2025-09-18', amountCents: -4990 }),
      row('c', 'Arbeitgeber', { bookingDate: '2025-09-15', amountCents: 324000 }),
    ]);

    const days = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(days).toEqual(['Donnerstag, 18. September 2025', 'Montag, 15. September 2025']);
    expect(
      screen.getByRole('region', { name: 'Donnerstag, 18. September 2025' }),
    ).toHaveTextContent(/Ausgaben -104,02\s€/u);
    expect(within(rowOf('Arbeitgeber') as HTMLElement).getByText(/\+3\.240,00/u)).toBeVisible();
  });

  it('marks a vorgemerkt row and offers no category for it', async () => {
    await withRows([row('p', 'Ärzte GmbH', { status: 'pending' })]);

    const pending = rowOf('Ärzte GmbH') as HTMLElement;
    expect(within(pending).getByText('vorgemerkt')).toBeVisible();
    expect(within(pending).queryByRole('button', { name: /^Kategorie/ })).toBeNull();
  });

  it('sets a category from the pill, holds the row until the server answers, then locks it', async () => {
    await withRows([SEPTEMBER]);

    fireEvent.click(screen.getByRole('button', { name: 'Kategorie: Ohne Kategorie' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Wohnen/ }));

    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    expect(writes[0]).toMatchObject({ transactionId: 't-1', categoryId: 'cat-wohnen' });
    expect(screen.getByRole('button', { name: 'Kategorie: Ohne Kategorie' })).toBeDisabled();

    writes[0]?.resolve({
      ...SEPTEMBER,
      categoryId: 'cat-wohnen',
      categoryLockedAt: '2026-09-23T08:00:00.000Z',
    });

    expect(
      await screen.findByRole('img', { name: 'von Hand gesetzt — Regeln ändern das nicht' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kategorie: Wohnen' })).toBeEnabled();
  });

  it('says so when the write is refused, and gives the row back', async () => {
    await withRows([SEPTEMBER]);

    fireEvent.click(screen.getByRole('button', { name: 'Kategorie: Ohne Kategorie' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Wohnen/ }));
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    writes[0]?.reject(new Error('Kategorie nicht gefunden'));

    expect(
      await screen.findByText('Anfrage fehlgeschlagen: Kategorie nicht gefunden'),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Kategorie: Ohne Kategorie' })).toBeEnabled();
    });
  });
});

describe('TransactionsPage, narrowing', () => {
  it('narrows by month without asking the server again', async () => {
    await withRows([SEPTEMBER, OLD]);
    expect(rowOf('Versicherung AG')).not.toBeNull();

    chooseMonth('September 2025');

    await waitFor(() => {
      expect(rowOf('Versicherung AG')).toBeNull();
    });
    expect(rowOf('Müller GmbH')).not.toBeNull();
    expect(vi.mocked(listTransactions)).toHaveBeenCalledTimes(1);
  });

  it('searches the rows it already has, whatever the case', async () => {
    await withRows([SEPTEMBER, OLD]);

    fireEvent.change(screen.getByRole('textbox', { name: 'Suche' }), {
      target: { value: 'müller' },
    });

    await waitFor(() => {
      expect(rowOf('Versicherung AG')).toBeNull();
    });
    expect(rowOf('Müller GmbH')).not.toBeNull();
  });

  it('counts the account and month, not the view, and only rows that can be sorted', async () => {
    await withRows([SEPTEMBER, OLD, row('p', 'Vorgemerkt AG', { status: 'pending' })]);
    expect(screen.getByText('2 ohne Kategorie')).toBeInTheDocument();

    chooseMonth('September 2025');
    expect(screen.getByText('1 ohne Kategorie')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Suche' }), {
      target: { value: 'nichts passt' },
    });
    expect(screen.getByText('1 ohne Kategorie')).toBeInTheDocument();
  });

  it('says a filter matched nothing rather than inviting another import', async () => {
    await withRows([SEPTEMBER]);

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Kategorie filtern' }));
    fireEvent.click(screen.getByRole('option', { name: 'Wohnen' }));

    expect(await screen.findByText('Keine Umsätze für diese Auswahl.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(rowOf('Müller GmbH')).not.toBeNull();
  });

  it('drops a row out of the Ohne Kategorie filter the moment it is categorized', async () => {
    await withRows([SEPTEMBER, row('t-3', 'REWE Filiale 7', { categoryId: 'cat-wohnen' })]);

    fireEvent.click(screen.getByRole('button', { name: /Nur Umsätze ohne Kategorie zeigen/ }));
    await waitFor(() => {
      expect(rowOf('REWE Filiale 7')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Kategorie: Ohne Kategorie' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Wohnen/ }));
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    writes[0]?.resolve({ ...SEPTEMBER, categoryId: 'cat-wohnen', categoryLockedAt: 'x' });

    await waitFor(() => {
      expect(rowOf('Müller GmbH')).toBeNull();
    });
    expect(screen.getByText('Alle kategorisiert')).toBeInTheDocument();
  });

  it('shows every account by default, and narrows to one', async () => {
    accounts = [GIRO, TAGESGELD];
    stored = { 'acc-2': [row('t-9', 'Stadtwerke', { bookingDate: '2023-05-02' })] };
    await withRows([SEPTEMBER]);

    expect(rowOf('Stadtwerke')).not.toBeNull();
    expect(within(rowOf('Stadtwerke') as HTMLElement).getByText(/Tagesgeld/)).toBeVisible();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Konto filtern' }));
    fireEvent.click(screen.getByRole('option', { name: /^Giro/ }));

    await waitFor(() => {
      expect(rowOf('Stadtwerke')).toBeNull();
    });
    expect(rowOf('Müller GmbH')).not.toBeNull();
  });

  it('lands already narrowed when another page links here', async () => {
    accounts = [GIRO, TAGESGELD];
    stored = {
      'acc-2': [row('t-8', 'Ärzte GmbH'), row('t-7', 'Müller GmbH', { categoryId: 'cat-wohnen' })],
    };
    await withRows([row('t-1', 'Giro-Zeile')], '/transactions?m=2025-09&c=uncategorized&a=acc-2');

    await waitFor(() => {
      expect(rowOf('Ärzte GmbH')).not.toBeNull();
    });
    expect(rowOf('Müller GmbH')).toBeNull();
    expect(rowOf('Giro-Zeile')).toBeNull();
  });
});

describe('TransactionsPage, in English', () => {
  it('switches its words without a reload', async () => {
    await withRows([SEPTEMBER]);

    await act(async () => {
      await i18n.changeLanguage('en');
    });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Transactions' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Category: Uncategorized' })).toBeInTheDocument();
  });
});

describe('ImportDialog', () => {
  function dialog(props: { file?: File; newAccount?: boolean } = {}) {
    render(
      <MemoryRouter>
        <HouseholdProvider>
          <ImportDialog open onClose={vi.fn()} {...props} />
        </HouseholdProvider>
      </MemoryRouter>,
    );
  }

  it('asks for no account when there is only one', async () => {
    dialog();

    expect(await screen.findByLabelText('CSV-Datei auswählen')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Konto' })).toBeNull();
  });

  it('asks which account when there are several', async () => {
    accounts = [GIRO, TAGESGELD];
    dialog();

    expect(await screen.findByRole('combobox', { name: 'Konto' })).toBeInTheDocument();
  });

  it('creates an account first when there is none', async () => {
    accounts = [];
    dialog();

    fireEvent.change(await screen.findByRole('textbox', { name: 'IBAN' }), {
      target: { value: 'DE89370400440532013000' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Bezeichnung' }), {
      target: { value: 'Giro' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

    expect(await screen.findByLabelText('CSV-Datei auswählen')).toBeInTheDocument();
  });

  it('uploads a dropped file once, as soon as it opens', async () => {
    const file = new File(['x'], 'september.csv', { type: 'text/csv' });
    dialog({ file });

    await waitFor(() => {
      expect(uploadImport).toHaveBeenCalledOnce();
    });
    expect(uploadImport).toHaveBeenCalledWith('acc-1', file);
  });

  it('with several accounts, uploads a dropped file only into the one picked, and once', async () => {
    accounts = [GIRO, TAGESGELD];
    const file = new File(['x'], 'september.csv', { type: 'text/csv' });
    dialog({ file });

    const picker = await screen.findByRole('combobox', { name: 'Konto' });
    expect(screen.getByText('In welches Konto gehört „september.csv“?')).toBeInTheDocument();
    expect(uploadImport).not.toHaveBeenCalled();

    const pick = (name: string) => {
      fireEvent.mouseDown(picker);
      fireEvent.click(screen.getByRole('option', { name: new RegExp(`^${name}`, 'u') }));
    };
    pick('Tagesgeld');
    await waitFor(() => {
      expect(uploadImport).toHaveBeenCalledOnce();
    });
    expect(uploadImport).toHaveBeenCalledWith('acc-2', file);

    // Elsewhere and back again: an empty panel each time, never the same file again.
    pick('Giro');
    pick('Tagesgeld');
    expect(await screen.findByLabelText('CSV-Datei auswählen')).toBeInTheDocument();
    expect(uploadImport).toHaveBeenCalledOnce();
  });
});

describe('ImportsPage', () => {
  it('lists every upload, a no-op one included, with its account', async () => {
    render(
      <MemoryRouter>
        <HouseholdProvider>
          <ImportsPage />
        </HouseholdProvider>
      </MemoryRouter>,
    );

    const list = await screen.findByRole('list', { name: 'Bisherige Importe' });
    expect(list).toHaveTextContent('september.csv');
    expect(list).toHaveTextContent('0 neu · 8 übersprungen · 0 wiederhergestellt · 0 fehlerhaft');
    await waitFor(() => {
      expect(list).toHaveTextContent('Giro');
    });
  });

  it('removes an upload at once and offers „Rückgängig“, which restores it', async () => {
    render(
      <MemoryRouter>
        <HouseholdProvider>
          <ImportsPage />
        </HouseholdProvider>
      </MemoryRouter>,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Import „september.csv“ entfernen' }),
    );

    expect(await screen.findByText('Import „september.csv“ entfernt')).toBeInTheDocument();
    expect(undoImport).toHaveBeenCalledWith('b-2');

    fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));

    await waitFor(() => {
      expect(restoreImport).toHaveBeenCalledWith('b-2');
    });
    expect(screen.queryByText('Import „september.csv“ entfernt')).not.toBeInTheDocument();
  });

  it('marks a removed upload and offers no second removal', async () => {
    batches = BATCHES.map((batch) => ({ ...batch, undoneAt: '2025-09-21T10:00:00.000Z' }));
    render(
      <MemoryRouter>
        <HouseholdProvider>
          <ImportsPage />
        </HouseholdProvider>
      </MemoryRouter>,
    );

    const list = await screen.findByRole('list', { name: 'Bisherige Importe' });
    expect(list).toHaveTextContent('Entfernt');
    expect(within(list).queryByRole('button', { name: /entfernen$/u })).not.toBeInTheDocument();
  });
});
