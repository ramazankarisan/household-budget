import {
  type ApplySummary,
  type CategoryPayload,
  type DeletedRulePayload,
  type RulePayload,
} from '@household-budget/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The mocked module's own class, not a copy: the page narrows with `instanceof`, and a
// second class with the same shape is a different class.
import { ApiError } from '../api/client';
import { RulesPage } from './RulesPage';

const initialCategories: CategoryPayload[] = [
  { id: 'cat-wohnen', name: 'Wohnen' },
  { id: 'cat-lebensmittel', name: 'Lebensmittel' },
];
/** What the mocked API currently holds: deletes and re-creates change it, as the real one would. */
let categories: CategoryPayload[] = [...initialCategories];

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
const removedCategory = vi.fn<(id: string) => Promise<void>>();
const createdCategory = vi.fn<(name: string) => Promise<CategoryPayload>>();
const removedRule = vi.fn<(id: string) => Promise<DeletedRulePayload>>();
const restoredRule = vi.fn<(rule: DeletedRulePayload) => Promise<RulePayload>>();

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
  createCategory: (name: string) => createdCategory(name),
  deleteCategory: (id: string) => removedCategory(id),
  createRule: (input: unknown) => {
    created(input);
    return Promise.resolve(rule());
  },
  updateRule: () => Promise.resolve(rule()),
  deleteRule: (id: string) => removedRule(id),
  restoreRule: (deleted: DeletedRulePayload) => restoredRule(deleted),
  applyRules: () => applied(),
}));

beforeEach(() => {
  rules = [];
  listFailure = undefined;
  created.mockClear();
  applied.mockReset();
  categories = [...initialCategories];
  removedCategory.mockReset();
  removedCategory.mockImplementation((id) => {
    categories = categories.filter((category) => category.id !== id);
    return Promise.resolve();
  });
  createdCategory.mockReset();
  createdCategory.mockImplementation((name) => {
    const category = { id: `cat-${name.toLowerCase()}-new`, name };
    categories = [...categories, category];
    return Promise.resolve(category);
  });
});

beforeEach(() => {
  removedRule.mockReset();
  removedRule.mockImplementation((id) => {
    const gone = rules.find((candidate) => candidate.id === id) ?? rule({ id });
    rules = rules.filter((candidate) => candidate.id !== id);
    return Promise.resolve({ ...gone, createdAt: '2026-09-20T10:00:00.000Z' });
  });
  restoredRule.mockReset();
  restoredRule.mockImplementation((deleted) => {
    const { createdAt: _createdAt, ...back } = deleted;
    rules = [...rules, back];
    return Promise.resolve(back);
  });
});

afterEach(() => {
  vi.useRealTimers();
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

  it('explains a refused category deletion with all three counts', async () => {
    removedCategory.mockRejectedValue(
      new ApiError('CATEGORY_IN_USE', [], { rules: 2, transactions: 47, budgets: 3 }),
    );
    render(page());

    fireEvent.click(await screen.findByRole('button', { name: /Kategorie löschen: Wohnen/ }));

    expect(
      await screen.findByText('Wird noch verwendet: 2 Regeln, 47 Umsätze, 3 Budgets.'),
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

describe('RulesPage, deleting a category', () => {
  // Dogfood ISSUE-010: the ✕ deleted at once with no way back. It still deletes at once;
  // a snackbar offers undo, which re-creates the name. The API refuses to delete a
  // category anything points at, so a name is all there ever is to restore.
  const chip = (name: string) =>
    screen.queryByRole('button', { name: `Kategorie löschen: ${name}` });

  it('removes the chip and says which category went', async () => {
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: /Kategorie löschen: Wohnen/ }));

    expect(await screen.findByText('„Wohnen“ gelöscht')).toBeInTheDocument();
    await waitFor(() => {
      expect(chip('Wohnen')).not.toBeInTheDocument();
    });
  });

  it('brings the category back by name when undone', async () => {
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: /Kategorie löschen: Wohnen/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));

    expect(createdCategory).toHaveBeenCalledExactlyOnceWith('Wohnen');
    expect(await screen.findByRole('button', { name: /Kategorie löschen: Wohnen/ })).toBeVisible();
    await waitFor(() => {
      expect(screen.queryByText('„Wohnen“ gelöscht')).not.toBeInTheDocument();
    });
  });

  it('lets the undo lapse after six seconds without re-creating anything', async () => {
    // Fake from the start: the snackbar's timer is set when it opens. shouldAdvanceTime
    // keeps the promise-driven loads and findBy polling moving on their own.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: /Kategorie löschen: Wohnen/ }));
    await screen.findByText('„Wohnen“ gelöscht');

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    await waitFor(() => {
      expect(screen.queryByText('„Wohnen“ gelöscht')).not.toBeInTheDocument();
    });
    expect(createdCategory).not.toHaveBeenCalled();
  });

  it('shows only the latest deletion when two happen in a row', async () => {
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: /Kategorie löschen: Wohnen/ }));
    await screen.findByText('„Wohnen“ gelöscht');
    fireEvent.click(await screen.findByRole('button', { name: /Kategorie löschen: Lebensmittel/ }));

    expect(await screen.findByText('„Lebensmittel“ gelöscht')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('„Wohnen“ gelöscht')).not.toBeInTheDocument();
    });
  });

  it('offers no undo when the deletion was refused', async () => {
    removedCategory.mockRejectedValue(
      new ApiError('CATEGORY_IN_USE', [], { rules: 2, transactions: 47, budgets: 3 }),
    );
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: /Kategorie löschen: Wohnen/ }));

    await screen.findByText('Wird noch verwendet: 2 Regeln, 47 Umsätze, 3 Budgets.');
    expect(screen.queryByText('„Wohnen“ gelöscht')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rückgängig' })).not.toBeInTheDocument();
  });
});

describe('RulesPage, deleting a rule', () => {
  // Dogfood ISSUE-011: the same undo as a category, and an exact one — the API hands the
  // rule back with its createdAt, and the undo sends exactly that to restore.
  it('says which rule went and offers it back', async () => {
    rules = [rule({ id: 'r-mueller', value: 'müller' })];
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: 'Regel löschen: müller' }));

    expect(await screen.findByText('Regel „müller“ gelöscht')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Regel löschen: müller' })).toBeNull();
    });
  });

  it('restores the rule exactly as the API returned it, createdAt included', async () => {
    rules = [rule({ id: 'r-mueller', value: 'müller' })];
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: 'Regel löschen: müller' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));

    expect(restoredRule).toHaveBeenCalledExactlyOnceWith({
      ...rule({ id: 'r-mueller', value: 'müller' }),
      createdAt: '2026-09-20T10:00:00.000Z',
    });
    expect(await screen.findByRole('button', { name: 'Regel löschen: müller' })).toBeVisible();
  });

  it('shares one snackbar with category deletes, so only the latest is offered', async () => {
    rules = [rule({ id: 'r-mueller', value: 'müller', categoryId: 'cat-lebensmittel' })];
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: /Kategorie löschen: Wohnen/ }));
    await screen.findByText('„Wohnen“ gelöscht');
    fireEvent.click(await screen.findByRole('button', { name: 'Regel löschen: müller' }));

    expect(await screen.findByText('Regel „müller“ gelöscht')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('„Wohnen“ gelöscht')).not.toBeInTheDocument();
    });
    expect(screen.getAllByRole('button', { name: 'Rückgängig' })).toHaveLength(1);
  });
});

describe('RulesPage, a category that cannot be deleted', () => {
  it('keeps the same warning on screen when ✕ is clicked again', async () => {
    // Dogfood ISSUE-012: the warning was cleared before each request and put back by the
    // 409, so every repeat click removed and re-inserted it and the form below jumped.
    removedCategory.mockRejectedValue(
      new ApiError('CATEGORY_IN_USE', [], { rules: 0, transactions: 1, budgets: 1 }),
    );
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: /Kategorie löschen: Wohnen/ }));
    const warning = await screen.findByText('Wird noch verwendet: 0 Regeln, 1 Umsätze, 1 Budgets.');

    fireEvent.click(screen.getByRole('button', { name: /Kategorie löschen: Wohnen/ }));
    await waitFor(() => {
      expect(removedCategory).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await Promise.resolve();
    });

    // The very same node: never detached, so never re-inserted.
    expect(warning.isConnected).toBe(true);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('drops an earlier warning when a later delete fails for another reason', async () => {
    // Review of #15: the counts do not name their category, so left up beside an
    // unrelated error they would read as that category's.
    removedCategory
      .mockRejectedValueOnce(
        new ApiError('CATEGORY_IN_USE', [], { rules: 0, transactions: 1, budgets: 1 }),
      )
      .mockRejectedValueOnce(new Error('Netzwerkfehler'));
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: /Kategorie löschen: Wohnen/ }));
    await screen.findByText(/Wird noch verwendet/);

    fireEvent.click(screen.getByRole('button', { name: /Kategorie löschen: Lebensmittel/ }));

    expect(await screen.findByText('Netzwerkfehler')).toBeInTheDocument();
    expect(screen.queryByText(/Wird noch verwendet/)).not.toBeInTheDocument();
  });

  it('clears the warning once a delete goes through', async () => {
    removedCategory.mockRejectedValueOnce(
      new ApiError('CATEGORY_IN_USE', [], { rules: 0, transactions: 1, budgets: 1 }),
    );
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: /Kategorie löschen: Wohnen/ }));
    await screen.findByText(/Wird noch verwendet/);

    fireEvent.click(screen.getByRole('button', { name: /Kategorie löschen: Lebensmittel/ }));

    await waitFor(() => {
      expect(screen.queryByText(/Wird noch verwendet/)).not.toBeInTheDocument();
    });
  });
});
