import { type CategoryPayload, type TransactionPayload } from '@household-budget/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CategoryCell } from './CategoryCell';

const CATEGORIES: CategoryPayload[] = [
  { id: 'cat-wohnen', name: 'Wohnen' },
  { id: 'cat-lebensmittel', name: 'Lebensmittel' },
];

function transaction(overrides: Partial<TransactionPayload> = {}): TransactionPayload {
  return {
    id: 't-1',
    bookingDate: '2025-09-22',
    valueDate: '2025-09-22',
    amountCents: -83290,
    currency: 'EUR',
    status: 'booked',
    counterpartyName: 'Müller GmbH',
    counterpartyIban: null,
    purpose: 'Rechnung 4711',
    bookingText: 'FOLGELASTSCHRIFT',
    bankCategory: null,
    categoryId: null,
    categoryLockedAt: null,
    ...overrides,
  };
}

describe('CategoryCell', () => {
  it('shows the category the row holds', () => {
    render(
      <CategoryCell
        transaction={transaction({ categoryId: 'cat-wohnen' })}
        categories={CATEGORIES}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Kategorie' })).toHaveTextContent('Wohnen');
  });

  it('reports the chosen category', () => {
    const onChange = vi.fn();
    render(
      <CategoryCell transaction={transaction()} categories={CATEGORIES} onChange={onChange} />,
    );

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Kategorie' }));
    fireEvent.click(screen.getByRole('option', { name: 'Lebensmittel' }));

    expect(onChange).toHaveBeenCalledWith('t-1', 'cat-lebensmittel');
  });

  it('reports null when the category is cleared', () => {
    // null is what unlocks the row, which is the only way back to being rule-governed.
    const onChange = vi.fn();
    render(
      <CategoryCell
        transaction={transaction({
          categoryId: 'cat-wohnen',
          categoryLockedAt: '2026-09-23T08:00:00.000Z',
        })}
        categories={CATEGORIES}
        onChange={onChange}
      />,
    );

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Kategorie' }));
    fireEvent.click(screen.getByRole('option', { name: 'Kategorie entfernen' }));

    expect(onChange).toHaveBeenCalledWith('t-1', null);
  });

  it('marks a row the user set by hand', () => {
    // A row the engine will skip forever has to look different from one it has not
    // reached yet.
    render(
      <CategoryCell
        transaction={transaction({
          categoryId: 'cat-wohnen',
          categoryLockedAt: '2026-09-23T08:00:00.000Z',
        })}
        categories={CATEGORIES}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('von Hand gesetzt — Regeln ändern das nicht')).toBeInTheDocument();
  });

  it('leaves a rule-assigned row unmarked', () => {
    render(
      <CategoryCell
        transaction={transaction({ categoryId: 'cat-wohnen' })}
        categories={CATEGORIES}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.queryByLabelText('von Hand gesetzt — Regeln ändern das nicht'),
    ).not.toBeInTheDocument();
  });
});
