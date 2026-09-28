import {
  type ApplySummary,
  type CategoryPayload,
  type DeletedRulePayload,
  type RulePayload,
} from '@household-budget/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The mocked module's own class, not a copy: the page narrows with `instanceof`, and a
// second class with the same shape is a different class.
import { ApiError } from '../api/client';
import i18n from '../locales/i18n';
import { HouseholdProvider } from '../household/HouseholdProvider';
import { RulesPage } from './RulesPage';

const initialCategories: CategoryPayload[] = [
  { id: 'cat-wohnen', name: 'Wohnen', colorIndex: 0 },
  { id: 'cat-lebensmittel', name: 'Lebensmittel', colorIndex: 0 },
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
const reordered = vi.fn<(ids: readonly string[]) => Promise<RulePayload[]>>();
const updatedCategory =
  vi.fn<(id: string, update: { colorIndex?: number }) => Promise<CategoryPayload>>();

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
  listAccounts: () => Promise.resolve([]),
  listTransactions: () => Promise.resolve([]),
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
  reorderRules: (ids: readonly string[]) => reordered(ids),
  updateCategory: (id: string, update: { colorIndex?: number }) => updatedCategory(id, update),
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
    const category = { id: `cat-${name.toLowerCase()}-new`, name, colorIndex: 0 };
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

beforeEach(() => {
  reordered.mockReset();
  reordered.mockImplementation((ids) => {
    rules = ids.map((id, index) => ({
      ...(rules.find((candidate) => candidate.id === id) ?? rule({ id })),
      priority: (index + 1) * 10,
    }));
    return Promise.resolve(rules);
  });
  updatedCategory.mockReset();
  updatedCategory.mockImplementation((id, update) => {
    categories = categories.map((category) =>
      category.id === id ? { ...category, ...update } : category,
    );
    const updated = categories.find((category) => category.id === id);
    return updated === undefined ? Promise.reject(new Error('gone')) : Promise.resolve(updated);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/** The rules as shown, first to last: each one's keyword. */
async function shownOrder(): Promise<string[]> {
  const list = await screen.findByRole('list', { name: 'Regeln' });
  return within(list)
    .getAllByRole('listitem')
    .map((item) => /„([^“]+)“/u.exec(item.textContent)?.[1] ?? '');
}

/** The page reads categories and rules from the household, which loads them. */
const page = () => (
  <MemoryRouter>
    <HouseholdProvider>
      <RulesPage />
    </HouseholdProvider>
  </MemoryRouter>
);

describe('RulesPage', () => {
  it('renders rules in the order the API returned and does not re-sort them', async () => {
    // The API's order is the order the engine walks. Re-sorting here would make the list
    // lie about which rule wins.
    rules = [
      rule({ id: 'r-a', value: 'erste', priority: 30 }),
      rule({ id: 'r-b', value: 'zweite', priority: 10 }),
      rule({ id: 'r-c', value: 'dritte', priority: 20 }),
    ];
    render(page());

    await screen.findByText('„erste“');
    expect(await shownOrder()).toEqual(['erste', 'zweite', 'dritte']);
  });

  it('marks the field and sends nothing when the keyword is empty', async () => {
    // Core's own parser runs in the browser, so the common mistake never round-trips.
    render(page());
    fireEvent.click(await screen.findByRole('button', { name: 'Regel anlegen' }));

    expect(await screen.findByText('Suchbegriff fehlt')).toBeInTheDocument();
    expect(created).not.toHaveBeenCalled();
  });

  it('submits a rule the parser accepts, without a priority so it is appended', async () => {
    render(page());
    await screen.findByRole('button', { name: 'Regel anlegen' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Suchbegriff' }), {
      target: { value: 'müller' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Regel anlegen' }));

    await waitFor(() => {
      expect(created).toHaveBeenCalledWith(
        expect.objectContaining({ value: 'müller', categoryId: 'cat-wohnen' }),
      );
    });
    expect(created.mock.calls[0]?.[0]).not.toHaveProperty('priority');
  });

  it('previews what a new rule would reach and where it would go', async () => {
    rules = [rule({ id: 'r-a', value: 'erste' })];
    render(page());
    await screen.findByText('„erste“');

    fireEvent.change(screen.getByRole('textbox', { name: 'Suchbegriff' }), {
      target: { value: 'müller' },
    });

    const composer = screen.getByRole('region', { name: 'Neue Regel' });
    expect(within(composer).getByRole('status')).toHaveTextContent('wird Regel 2');
  });

  it('shows the second rule when you switch which one you are editing', async () => {
    // The editor seeds its copy from the rule, so it has to follow a switch of rule rather
    // than keep the first one's values — and saving then overwrites the wrong rule.
    rules = [
      rule({ id: 'r-a', value: 'erste', priority: 10 }),
      rule({ id: 'r-b', value: 'zweite', priority: 20 }),
    ];
    render(page());
    const list = await screen.findByRole('list', { name: 'Regeln' });

    const [editA, editB] = within(list).getAllByRole('button', { name: 'Regel bearbeiten' });
    fireEvent.click(editA as HTMLElement);
    expect(within(list).getByRole('textbox', { name: 'Suchbegriff' })).toHaveValue('erste');

    fireEvent.click(editB as HTMLElement);

    expect(within(list).getByRole('textbox', { name: 'Suchbegriff' })).toHaveValue('zweite');
  });

  it('moves a rule up and saves the whole order as one', async () => {
    rules = [
      rule({ id: 'r-a', value: 'erste', priority: 10 }),
      rule({ id: 'r-b', value: 'zweite', priority: 20 }),
    ];
    render(page());

    fireEvent.click(await screen.findByRole('button', { name: 'Nach oben: zweite' }));

    expect(reordered).toHaveBeenCalledWith(['r-b', 'r-a']);
    await waitFor(async () => {
      expect(await shownOrder()).toEqual(['zweite', 'erste']);
    });
  });

  it('moves a focused rule with Alt and an arrow key', async () => {
    rules = [
      rule({ id: 'r-a', value: 'erste', priority: 10 }),
      rule({ id: 'r-b', value: 'zweite', priority: 20 }),
    ];
    render(page());

    fireEvent.keyDown(await screen.findByRole('button', { name: 'Nach unten: erste' }), {
      key: 'ArrowDown',
      altKey: true,
    });

    expect(reordered).toHaveBeenCalledWith(['r-b', 'r-a']);
  });

  it('puts the old order back when the new one is refused', async () => {
    rules = [
      rule({ id: 'r-a', value: 'erste', priority: 10 }),
      rule({ id: 'r-b', value: 'zweite', priority: 20 }),
    ];
    reordered.mockRejectedValue(new ApiError('RULE_ORDER_INVALID'));
    render(page());

    fireEvent.click(await screen.findByRole('button', { name: 'Nach oben: zweite' }));

    expect(await screen.findByText('Diese Reihenfolge ist ungültig.')).toBeInTheDocument();
    expect(await shownOrder()).toEqual(['erste', 'zweite']);
  });

  it('changes a category’s colour', async () => {
    render(page());

    fireEvent.click(await screen.findByRole('button', { name: 'Farbe ändern: Wohnen' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Farbe 6' }));

    await waitFor(() => {
      expect(updatedCategory).toHaveBeenCalledWith('cat-wohnen', { colorIndex: 5 });
    });
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
    await screen.findByRole('button', { name: 'Regel anlegen' });

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
    expect(screen.queryByText('de89370400440532013000')).toBeNull();
  });

  it('says why the lists are empty when they could not be loaded', async () => {
    // Otherwise a failed request and an account with no rules yet look identical.
    listFailure = new Error('API nicht erreichbar');
    render(page());

    expect(
      await screen.findByText('Anfrage fehlgeschlagen: API nicht erreichbar'),
    ).toBeInTheDocument();
  });

  it('says why an apply did not run', async () => {
    applied.mockRejectedValue(new Error('Regeln konnten nicht angewendet werden'));
    render(page());

    fireEvent.click(await screen.findByRole('button', { name: 'Regeln anwenden' }));

    expect(
      await screen.findByText('Anfrage fehlgeschlagen: Regeln konnten nicht angewendet werden'),
    ).toBeInTheDocument();
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
  // Dogfood ISSUE-010: the delete button deleted at once with no way back. It still deletes at once;
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
  it('keeps the same warning on screen when delete is clicked again', async () => {
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

    expect(await screen.findByText(/Netzwerkfehler/)).toBeInTheDocument();
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

describe('RulesPage, in English', () => {
  it('switches its words without a reload', async () => {
    applied.mockResolvedValue({ evaluated: 412, assigned: 318, cleared: 4, locked: 11 });
    render(page());
    await screen.findByRole('button', { name: 'Regeln anwenden' });

    await act(async () => {
      await i18n.changeLanguage('en');
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Apply rules' }));
    expect(
      await screen.findByText('412 checked · 318 assigned · 4 cleared · 11 set by hand'),
    ).toBeInTheDocument();
  });
});

describe('RulesPage, a message already on screen when the language changes', () => {
  it('rewords the refusal, the snackbar and the page alert rather than leaving them German', async () => {
    removedCategory.mockImplementation((id) =>
      id === 'cat-wohnen'
        ? Promise.reject(
            new ApiError('CATEGORY_IN_USE', [], { rules: 2, transactions: 47, budgets: 3 }),
          )
        : Promise.resolve(),
    );
    render(page());

    fireEvent.click(await screen.findByRole('button', { name: /Kategorie löschen: Wohnen/ }));
    await screen.findByText('Wird noch verwendet: 2 Regeln, 47 Umsätze, 3 Budgets.');
    fireEvent.click(screen.getByRole('button', { name: /Kategorie löschen: Lebensmittel/ }));
    await screen.findByText('„Lebensmittel“ gelöscht');

    await act(async () => {
      await i18n.changeLanguage('en');
    });

    expect(await screen.findByText('"Lebensmittel" deleted')).toBeInTheDocument();
    expect(screen.queryByText('„Lebensmittel“ gelöscht')).not.toBeInTheDocument();
  });

  it('words a coded refusal the UI knows, in the current language', async () => {
    removedCategory.mockRejectedValue(new ApiError('FORBIDDEN_ORIGIN'));
    render(page());

    fireEvent.click(await screen.findByRole('button', { name: /Kategorie löschen: Wohnen/ }));
    expect(
      await screen.findByText('Anfrage abgelehnt: sie kam nicht von dieser Seite.'),
    ).toBeInTheDocument();

    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(
      await screen.findByText('Request refused: it did not come from this page.'),
    ).toBeInTheDocument();
  });
});
