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

  it('keeps the lock slot on an unlocked row, so the chevrons line up down the column', () => {
    // The select is flex: 1. A slot present only on locked rows made their select
    // narrower and pushed the chevron out of line (dogfood ISSUE-003).
    render(
      <CategoryCell
        transaction={transaction({ categoryId: 'cat-wohnen' })}
        categories={CATEGORIES}
        onChange={vi.fn()}
      />,
    );

    const slot = screen.getByTestId('lock-slot');
    expect(slot).toBeEmptyDOMElement();
    expect(slot).toHaveAttribute('aria-hidden', 'true');
  });

  it('puts the lock in the same slot on a locked row', () => {
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

    const slot = screen.getByTestId('lock-slot');
    expect(slot).toHaveTextContent('🔒');
    expect(slot).toHaveAccessibleName('von Hand gesetzt — Regeln ändern das nicht');
    expect(slot).not.toHaveAttribute('aria-hidden');
  });
});

describe('CategoryCell, where a choice could not survive', () => {
  it('does not offer a category on a pending row', () => {
    // The next import replaces the pending set wholesale and those rows carry no
    // dedupKey, so a choice made here could not be carried over. The API refuses it too.
    render(
      <CategoryCell
        transaction={transaction({ status: 'pending' })}
        categories={CATEGORIES}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Ohne Kategorie')).toBeInTheDocument();
  });

  it('still shows the category a rule gave a pending row', () => {
    render(
      <CategoryCell
        transaction={transaction({ status: 'pending', categoryId: 'cat-wohnen' })}
        categories={CATEGORIES}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Wohnen')).toBeInTheDocument();
  });

  it('renders text rather than an empty select while the categories are still loading', () => {
    // A Select whose value matches no option warns and renders blank, which is what the
    // first paint looks like: transactions land before categories do.
    render(
      <CategoryCell
        transaction={transaction({ categoryId: 'cat-wohnen' })}
        categories={[]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('reads as uncategorized, not as "remove category", on an id the list does not contain', () => {
    // Reachable: a category deleted while a soft-deleted row still pointed at it comes
    // back from a restore holding an id nothing resolves. The empty item is also what the
    // closed select displays, so its label was claiming to be the row's category.
    render(
      <CategoryCell
        transaction={transaction({ categoryId: 'cat-deleted' })}
        categories={CATEGORIES}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Kategorie' })).toHaveTextContent('Ohne Kategorie');
    expect(screen.queryByText('Kategorie entfernen')).not.toBeInTheDocument();
  });

  it('still offers to remove the category on a row that has a resolvable one', () => {
    render(
      <CategoryCell
        transaction={transaction({ categoryId: 'cat-wohnen' })}
        categories={CATEGORIES}
        onChange={vi.fn()}
      />,
    );

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Kategorie' }));

    expect(screen.getByText('Kategorie entfernen')).toBeInTheDocument();
  });

  it('does not accept a second change while the first is still in flight', () => {
    const onChange = vi.fn();
    render(
      <CategoryCell
        transaction={transaction()}
        categories={CATEGORIES}
        onChange={onChange}
        disabled
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Kategorie' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
