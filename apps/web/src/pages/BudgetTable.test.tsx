import { type CategoryReport, type MonthlyReport } from '@household-budget/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BudgetTable } from './BudgetTable';

const CATEGORIES = [
  { id: 'cat-wohnen', name: 'Wohnen' },
  { id: 'cat-essen', name: 'Lebensmittel' },
  { id: 'cat-reise', name: 'Reise' },
];

/** `Intl` puts U+00A0 between the amount and the €. */
const plain = (text: string | null): string => (text ?? '').replaceAll('\u00a0', ' ');

function entry(overrides: Partial<CategoryReport>): CategoryReport {
  return {
    categoryId: 'cat-wohnen',
    bookedCents: 0,
    pendingCents: 0,
    budgetCents: null,
    remainingCents: null,
    isOver: false,
    transactionCount: 0,
    ...overrides,
  };
}

/** The fixture month with Wohnen over, Lebensmittel under, Reise unbudgeted. */
const REPORT: MonthlyReport = {
  month: '2025-09',
  categories: [
    entry({ bookedCents: 87507, budgetCents: 70000, remainingCents: -17507, isOver: true }),
    entry({ categoryId: 'cat-essen', budgetCents: 40000, remainingCents: 40000 }),
    entry({ categoryId: 'cat-reise', bookedCents: 12850 }),
    entry({ categoryId: null, bookedCents: 151067, pendingCents: 1900 }),
  ],
  totalBookedCents: 238574,
  totalPendingCents: 1900,
  totalBudgetCents: 110000,
};

function renderTable() {
  const handlers = {
    onSave: vi.fn<(categoryId: string, amountCents: number) => void>(),
    onClear: vi.fn<(categoryId: string) => void>(),
    onShowUncategorized: vi.fn<() => void>(),
  };
  render(
    <BudgetTable
      report={REPORT}
      categories={CATEGORIES}
      savingIds={new Set(['cat-essen'])}
      revision={0}
      {...handlers}
    />,
  );
  return handlers;
}

const rowOf = (text: string) =>
  screen.getAllByRole('row').find((row) => row.textContent.includes(text)) as HTMLElement;

describe('BudgetTable', () => {
  it('marks an over row with the word and puts it in the row’s name', () => {
    renderTable();

    const wohnen = rowOf('Wohnen');
    expect(plain(wohnen.textContent)).toContain('875,07 €');
    expect(plain(wohnen.textContent)).toContain('175,07 € über');
    // A screen reader gets the state without the red.
    expect(plain(wohnen.getAttribute('aria-label'))).toBe('Wohnen: 175,07 € über');
  });

  it('says what is left on a row under its limit, and carries no extra name', () => {
    renderTable();

    const essen = rowOf('Lebensmittel');
    expect(plain(essen.textContent)).toContain('400,00 € übrig');
    expect(essen).not.toHaveAttribute('aria-label');
  });

  it('gives an unbudgeted category an empty field and nothing to compare', () => {
    renderTable();

    const field = screen.getByRole('textbox', { name: 'Budget Reise' });
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('placeholder', 'Budget setzen');
    expect(plain(rowOf('Reise').textContent)).toContain('128,50 €');
  });

  it('keeps the vorgemerkt figure apart and labels it, dashing it when zero', () => {
    renderTable();

    const uncategorized = rowOf('Ohne Kategorie');
    expect(plain(uncategorized.textContent)).toContain('1.510,67 €');
    expect(plain(uncategorized.textContent)).toContain('19,00 €');
    expect(within(uncategorized).getByLabelText('vorgemerkt')).toBeInTheDocument();
    expect(within(rowOf('Wohnen')).queryByLabelText('vorgemerkt')).toBeNull();
  });

  it('gives the uncategorized row no field — only the way to the rows', () => {
    const { onShowUncategorized } = renderTable();

    const uncategorized = rowOf('Ohne Kategorie');
    expect(within(uncategorized).queryByRole('textbox')).toBeNull();

    fireEvent.click(within(uncategorized).getByRole('button', { name: 'Ohne Kategorie' }));
    expect(onShowUncategorized).toHaveBeenCalledOnce();
  });

  it('disables the one cell whose write is in flight', () => {
    renderTable();

    expect(screen.getByRole('textbox', { name: 'Budget Lebensmittel' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Budget Wohnen' })).toBeEnabled();
  });

  it('hands a committed value up with the category it belongs to', () => {
    const { onSave } = renderTable();

    const field = screen.getByRole('textbox', { name: 'Budget Reise' });
    fireEvent.change(field, { target: { value: '150' } });
    fireEvent.blur(field);

    expect(onSave).toHaveBeenCalledExactlyOnceWith('cat-reise', 15000);
  });
});
