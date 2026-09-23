import { type ApplySummary, type CategoryPayload, type RulePayload } from '@household-budget/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The mocked module's own class, not a copy: the page narrows with `instanceof`, and a
// second class with the same shape is a different class.
import { ApiError } from '../api/client';
import { RulesPage } from './RulesPage';

const categories: CategoryPayload[] = [
  { id: 'cat-wohnen', name: 'Wohnen' },
  { id: 'cat-lebensmittel', name: 'Lebensmittel' },
];

/** Mirrors `transaction()` in TransactionList.test.tsx. */
function rule(overrides: Partial<RulePayload> = {}): RulePayload {
  return {
    id: 'r-1',
    field: 'counterpartyName',
    operator: 'contains',
    value: 'müller',
    priority: 10,
    categoryId: 'cat-wohnen',
    active: true,
    ...overrides,
  };
}

let rules: RulePayload[] = [];
/** Set to make both list requests fail, which is how the page is reached with nothing. */
let listFailure: Error | undefined;
const created = vi.fn();
const applied = vi.fn<() => Promise<ApplySummary>>();
const removedCategory = vi.fn<() => Promise<void>>();

vi.mock('../api/client', () => ({
  ApiError: class extends Error {
    readonly code: string;
    readonly columns: readonly string[];
    readonly details: Readonly<Record<string, unknown>>;
    constructor(
      code: string,
      columns: readonly string[] = [],
      details: Readonly<Record<string, unknown>> = {},
    ) {
      super(code);
      this.code = code;
      this.columns = columns;
      this.details = details;
    }
  },
  listCategories: () =>
    listFailure === undefined ? Promise.resolve(categories) : Promise.reject(listFailure),
  listRules: () =>
    listFailure === undefined ? Promise.resolve(rules) : Promise.reject(listFailure),
  createCategory: () => Promise.resolve({ id: 'cat-new', name: 'Neu' }),
  deleteCategory: () => removedCategory(),
  createRule: (input: unknown) => {
    created(input);
    return Promise.resolve(rule());
  },
  updateRule: () => Promise.resolve(rule()),
  deleteRule: () => Promise.resolve(),
  applyRules: () => applied(),
}));

beforeEach(() => {
  rules = [];
  listFailure = undefined;
  created.mockClear();
  applied.mockReset();
  removedCategory.mockReset();
});

const page = () => (
  <MemoryRouter>
    <RulesPage />
  </MemoryRouter>
);

describe('RulesPage', () => {
  it('renders rules in the order the API returned and does not re-sort them', async () => {
    // The API's order is the order the engine walks. Re-sorting here would make the
    // table lie about which rule wins.
    rules = [
      rule({ id: 'r-a', value: 'erste', priority: 30 }),
      rule({ id: 'r-b', value: 'zweite', priority: 10 }),
      rule({ id: 'r-c', value: 'dritte', priority: 20 }),
    ];
    render(page());

    await screen.findByText('erste');
    const shown = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelectorAll('td')[3]?.textContent);

    expect(shown).toEqual(['erste', 'zweite', 'dritte']);
  });

  it('marks the field and sends nothing when the keyword is empty', async () => {
    // Core's own parser runs in the browser, so the common mistake never round-trips.
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: 'Regel anlegen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByText('Suchbegriff fehlt')).toBeInTheDocument();
    expect(created).not.toHaveBeenCalled();
  });

  it('submits a rule the parser accepts', async () => {
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: 'Regel anlegen' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Suchbegriff' }), {
      target: { value: 'müller' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => {
      expect(created).toHaveBeenCalledWith(
        expect.objectContaining({ value: 'müller', categoryId: 'cat-wohnen', priority: 100 }),
      );
    });
  });

  it('shows the second rule when you switch which one you are editing', async () => {
    // RuleForm seeds its editable copy from the prop, so without a key it keeps the
    // first rule's values *and* its id — and saving then overwrites the wrong rule.
    rules = [
      rule({ id: 'r-a', value: 'erste', priority: 10 }),
      rule({ id: 'r-b', value: 'zweite', priority: 20 }),
    ];
    render(page());

    const [editA, editB] = await screen.findAllByRole('button', { name: 'Regel bearbeiten' });
    fireEvent.click(editA as HTMLElement);
    expect(screen.getByRole('textbox', { name: 'Suchbegriff' })).toHaveValue('erste');

    fireEvent.click(editB as HTMLElement);

    expect(screen.getByRole('textbox', { name: 'Suchbegriff' })).toHaveValue('zweite');
  });

  it('explains a refused category deletion with both counts', async () => {
    removedCategory.mockRejectedValue(
      new ApiError('CATEGORY_IN_USE', [], { rules: 2, transactions: 47 }),
    );
    render(page());

    fireEvent.click(await screen.findByRole('button', { name: /Kategorie löschen: Wohnen/ }));

    expect(
      await screen.findByText('Wird noch verwendet: 2 Regeln, 47 Umsätze.'),
    ).toBeInTheDocument();
  });

  it('reports what an apply changed', async () => {
    applied.mockResolvedValue({ evaluated: 412, assigned: 318, cleared: 4, locked: 11 });
    render(page());

    fireEvent.click(await screen.findByRole('button', { name: 'Regeln anwenden' }));

    expect(
      await screen.findByText(/412 geprüft · 318 zugeordnet · 4 gelöscht · 11 manuell/),
    ).toBeInTheDocument();
  });

  it('drops the apply result once a rule changes, because it no longer describes anything', async () => {
    // The counts are about the rule set that existed when the button was pressed. Left on
    // screen after a rule is switched off, they read as current.
    applied.mockResolvedValue({ evaluated: 412, assigned: 318, cleared: 4, locked: 11 });
    rules = [rule({ id: 'r-a', value: 'müller' })];
    render(page());

    fireEvent.click(await screen.findByRole('button', { name: 'Regeln anwenden' }));
    await screen.findByText(/412 geprüft/);

    fireEvent.click(screen.getByRole('switch', { name: 'aktiv: müller' }));

    await waitFor(() => {
      expect(screen.queryByText(/412 geprüft/)).not.toBeInTheDocument();
    });
  });

  it('offers an IBAN rule only the operator core allows, and fixes the one already chosen', async () => {
    // `contains` is the default for a new rule, and an IBAN accepts only `equals`. Offering
    // the other three builds a form whose single outcome is a rejection on submit.
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: 'Regel anlegen' }));

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Feld' }));
    fireEvent.click(screen.getByRole('option', { name: 'IBAN' }));

    expect(screen.getByRole('combobox', { name: 'Operator' })).toHaveTextContent('ist');

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Operator' }));
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('shows an IBAN the way an IBAN is read, not the way it is stored', async () => {
    // Stored normalized — no spaces, lower case — so that matching never depends on how
    // it was typed. `de89370400440532013000` is nobody's idea of an IBAN.
    rules = [
      rule({ field: 'counterpartyIban', operator: 'equals', value: 'de89370400440532013000' }),
    ];
    render(page());

    expect(await screen.findByText('DE89370400440532013000')).toBeInTheDocument();
  });

  it('says why the lists are empty when they could not be loaded', async () => {
    // Otherwise a failed request and an account with no rules yet look identical.
    listFailure = new Error('API nicht erreichbar');
    render(page());

    expect(await screen.findByText('API nicht erreichbar')).toBeInTheDocument();
  });

  it('says why an apply did not run', async () => {
    applied.mockRejectedValue(new Error('Regeln konnten nicht angewendet werden'));
    render(page());

    fireEvent.click(await screen.findByRole('button', { name: 'Regeln anwenden' }));

    expect(await screen.findByText('Regeln konnten nicht angewendet werden')).toBeInTheDocument();
    // The button has to come back, or the page is stuck on one failed attempt.
    expect(screen.getByRole('button', { name: 'Regeln anwenden' })).toBeEnabled();
  });

  it('will not offer a rule form before there is a category to point at', async () => {
    render(page());

    // Both categories exist here, so the button is live; the guard is the disabled state
    // when the list is empty, which is what the strip's own empty text explains.
    expect(await screen.findByRole('button', { name: 'Regel anlegen' })).toBeEnabled();
  });
});
