import { type CategoryPayload } from '@household-budget/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NO_FILTERS, type TransactionFilterState, UNCATEGORIZED } from '../filter';
import { TransactionFilters } from './TransactionFilters';

const CATEGORIES: CategoryPayload[] = [
  { id: 'cat-wohnen', name: 'Wohnen' },
  { id: 'cat-essen', name: 'Lebensmittel' },
];

const MONTHS = ['2025-10', '2025-09', '2014-03'];

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
      months={MONTHS}
      categories={CATEGORIES}
      uncategorized={overrides.uncategorized ?? 7}
      onChange={overrides.onChange ?? vi.fn()}
    />
  );
}

describe('TransactionFilters', () => {
  it('names each month rather than showing its key', () => {
    render(toolbar());
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Monat' }));

    expect(screen.getByRole('option', { name: 'September 2025' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'März 2014' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '2025-09' })).not.toBeInTheDocument();
  });

  it('reports the month that was chosen', () => {
    const onChange = vi.fn();
    render(toolbar({ onChange }));

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Monat' }));
    fireEvent.click(screen.getByRole('option', { name: 'September 2025' }));

    expect(onChange).toHaveBeenCalledWith({ ...NO_FILTERS, month: '2025-09' });
  });

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
    const filters = { ...NO_FILTERS, month: '2025-09' };
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

  it('keeps the month and the category when the search is cleared', () => {
    const onChange = vi.fn();
    const filters = { month: '2025-09', categoryId: 'cat-wohnen', search: 'rewe' };
    render(toolbar({ filters, onChange }));

    fireEvent.click(screen.getByRole('button', { name: 'Suche löschen' }));

    expect(onChange).toHaveBeenCalledWith({ ...filters, search: '' });
  });
});
