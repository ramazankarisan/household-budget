import { type CategoryPayload } from '@household-budget/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NO_FILTERS, type TransactionFilterState, UNCATEGORIZED } from '../filter';
import { TransactionFilters } from './TransactionFilters';

const CATEGORIES: CategoryPayload[] = [
  { id: 'cat-wohnen', name: 'Wohnen', colorIndex: 0 },
  { id: 'cat-essen', name: 'Lebensmittel', colorIndex: 0 },
];

function toolbar(
  overrides: {
    filters?: TransactionFilterState;
    uncategorized?: number;
    onChange?: (filters: TransactionFilterState) => void;
  } = {},
) {
  return (
    <TransactionFilters
      filters={overrides.filters ?? NO_FILTERS}
      categories={CATEGORIES}
      uncategorized={overrides.uncategorized ?? 7}
      onChange={overrides.onChange ?? vi.fn()}
    />
  );
}

describe('TransactionFilters', () => {
  it('offers every category, plus all and none', () => {
    render(toolbar());
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Kategorie filtern' }));

    expect(screen.getByRole('option', { name: 'Alle Kategorien' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Ohne Kategorie' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Wohnen' })).toBeInTheDocument();
  });

  it('does not answer to the name the row selects already use', () => {
    // `CategoryCell` names its combobox "Kategorie" on every row. If this one did too,
    // every page-scoped query for a row's select would match two elements and fail.
    render(toolbar());

    expect(screen.queryByRole('combobox', { name: 'Kategorie' })).not.toBeInTheDocument();
  });

  it('opens the uncategorized rows when the count is clicked', () => {
    const onChange = vi.fn();
    render(toolbar({ onChange }));

    expect(screen.getByText('7 ohne Kategorie')).toBeInTheDocument();
    // The number is in the name as well as on screen: `aria-label` replaces the visible
    // label rather than adding to it, so a chip named only after its action would report
    // everything about itself except the count.
    expect(
      screen.getByRole('button', { name: '7 ohne Kategorie · Nur Umsätze ohne Kategorie zeigen' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Nur Umsätze ohne Kategorie zeigen/ }));

    expect(onChange).toHaveBeenCalledWith({ ...NO_FILTERS, categoryId: UNCATEGORIZED });
  });

  it('keeps the other filters when the count is clicked', () => {
    const onChange = vi.fn();
    const filters = { ...NO_FILTERS, search: 'rewe' };
    render(toolbar({ filters, onChange }));

    fireEvent.click(screen.getByRole('button', { name: /Nur Umsätze ohne Kategorie zeigen/ }));

    expect(onChange).toHaveBeenCalledWith({ ...filters, categoryId: UNCATEGORIZED });
  });

  it('is a statement and not a control once nothing is left', () => {
    render(toolbar({ uncategorized: 0 }));

    expect(screen.getByText('Alle kategorisiert')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Nur Umsätze ohne Kategorie zeigen/ }),
    ).not.toBeInTheDocument();
  });
});

describe('TransactionFilters, the search box', () => {
  it('reports what was typed, keystroke by keystroke', () => {
    const onChange = vi.fn();
    render(toolbar({ onChange }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Suche' }), {
      target: { value: 'müller' },
    });

    expect(onChange).toHaveBeenCalledWith({ ...NO_FILTERS, search: 'müller' });
  });

  it('offers a way to clear it, and only while there is something to clear', () => {
    const onChange = vi.fn();
    const { rerender } = render(toolbar({ onChange }));

    expect(screen.queryByRole('button', { name: 'Suche löschen' })).not.toBeInTheDocument();

    rerender(toolbar({ filters: { ...NO_FILTERS, search: 'rewe' }, onChange }));
    fireEvent.click(screen.getByRole('button', { name: 'Suche löschen' }));

    expect(onChange).toHaveBeenCalledWith({ ...NO_FILTERS, search: '' });
  });

  it('keeps the category when the search is cleared', () => {
    const onChange = vi.fn();
    const filters = { categoryId: 'cat-wohnen', search: 'rewe' };
    render(toolbar({ filters, onChange }));

    fireEvent.click(screen.getByRole('button', { name: 'Suche löschen' }));

    expect(onChange).toHaveBeenCalledWith({ ...filters, search: '' });
  });
});
