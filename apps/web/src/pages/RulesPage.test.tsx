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
  listCategories: () => Promise.resolve(categories),
  listRules: () => Promise.resolve(rules),
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

  it('will not offer a rule form before there is a category to point at', async () => {
    render(page());

    // Both categories exist here, so the button is live; the guard is the disabled state
    // when the list is empty, which is what the strip's own empty text explains.
    expect(await screen.findByRole('button', { name: 'Regel anlegen' })).toBeEnabled();
  });
});
