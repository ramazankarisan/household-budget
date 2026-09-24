import { type CategoryReport, type MonthlyReport } from '@household-budget/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SpendingChart } from './SpendingChart';

const CATEGORIES = [
  { id: 'cat-wohnen', name: 'Wohnen' },
  { id: 'cat-essen', name: 'Lebensmittel' },
];

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

/** September 2025: Wohnen over its limit, Lebensmittel untouched, the bucket unbudgeted. */
const SEPTEMBER: MonthlyReport = {
  month: '2025-09',
  categories: [
    entry({ bookedCents: 87507, budgetCents: 70000, remainingCents: -17507, isOver: true }),
    entry({ categoryId: 'cat-essen' }),
    entry({ categoryId: null, bookedCents: 151067, pendingCents: 1900 }),
  ],
  totalBookedCents: 238574,
  totalPendingCents: 1900,
  totalBudgetCents: 70000,
};

/**
 * The bars one series drew, left to right, as the heights the chart gave them. The class
 * keeps the legend's swatch out: it carries the same `data-series` and is a `rect` too.
 */
function heightsOf(container: HTMLElement, seriesId: string): number[] {
  return [...container.querySelectorAll(`[data-series="${seriesId}"] rect.MuiBarChart-element`)]
    .map((bar) => ({
      x: Number(bar.getAttribute('x')),
      height: Number(bar.getAttribute('height')),
    }))
    .sort((left, right) => left.x - right.x)
    .map((bar) => bar.height);
}

describe('SpendingChart', () => {
  // Explicit size and `skipAnimation` are the whole reason this renders under jsdom at all:
  // nothing is measured, and no frame is waited for.
  it('renders under jsdom, named by its caption', () => {
    render(<SpendingChart report={SEPTEMBER} categories={CATEGORIES} />);

    expect(screen.getByRole('figure', { name: 'Ausgaben nach Kategorie' })).toBeInTheDocument();
  });

  it('draws one group per category that has something to show, and none for the rest', () => {
    const { container } = render(<SpendingChart report={SEPTEMBER} categories={CATEGORIES} />);

    expect(container).toHaveTextContent('Wohnen');
    expect(container).toHaveTextContent('Ohne Kategorie');
    // Neither spent in nor budgeted: a zero-height group would only be a gap.
    expect(container).not.toHaveTextContent('Lebensmittel');
  });

  it('draws the values it was given, in proportion', () => {
    const { container } = render(<SpendingChart report={SEPTEMBER} categories={CATEGORIES} />);

    const [wohnenBooked, bucketBooked] = heightsOf(container, 'booked');
    const [wohnenPending, bucketPending] = heightsOf(container, 'pending');
    const budget = heightsOf(container, 'budget');

    // Pixel heights round, so the ratios are compared, not the pixels.
    expect((bucketBooked ?? 0) / (wohnenBooked ?? 1)).toBeCloseTo(151067 / 87507, 1);
    expect(wohnenPending).toBe(0);
    expect(bucketPending).toBeGreaterThan(0);
    // One limit, and it is the only Budget bar — the bucket cannot have one.
    expect(budget).toHaveLength(1);
    expect((budget[0] ?? 0) / (wohnenBooked ?? 1)).toBeCloseTo(70000 / 87507, 1);
  });

  it('reads its axis in euro, not in cents', () => {
    const { container } = render(<SpendingChart report={SEPTEMBER} categories={CATEGORIES} />);

    expect(container.textContent).toMatch(/500,00\s€/u);
  });

  it('renders nothing at all for a month with no spending and no limits', () => {
    const { container } = render(
      <SpendingChart
        report={{
          month: '1990-01',
          categories: [entry({}), entry({ categoryId: 'cat-essen' })],
          totalBookedCents: 0,
          totalPendingCents: 0,
          totalBudgetCents: null,
        }}
        categories={CATEGORIES}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('still shows a limit set for a month nobody has spent in yet', () => {
    const { container } = render(
      <SpendingChart
        report={{
          month: '2025-10',
          categories: [entry({ budgetCents: 70000, remainingCents: 70000 })],
          totalBookedCents: 0,
          totalPendingCents: 0,
          totalBudgetCents: 70000,
        }}
        categories={CATEGORIES}
      />,
    );

    expect(heightsOf(container, 'budget')).toHaveLength(1);
  });

  it('draws no Budget bars while the limits load, and says so instead of implying none', () => {
    // Review of PR #13: with every limit still `null`, the Budget series read as "nothing
    // is budgeted" while the table said `…`.
    const loading: MonthlyReport = {
      ...SEPTEMBER,
      categories: SEPTEMBER.categories.map((row) => ({ ...row, budgetCents: null })),
      totalBudgetCents: null,
    };
    const { container } = render(
      <SpendingChart report={loading} categories={CATEGORIES} limitsLoading />,
    );

    const figure = screen.getByRole('figure', { name: 'Ausgaben nach Kategorie' });
    expect(figure).toHaveAttribute('aria-busy', 'true');
    expect(figure).toHaveTextContent('Budgets werden geladen');
    expect(container.querySelector('[data-series="budget"]')).toBeNull();
    expect(heightsOf(container, 'booked')).toHaveLength(2);
  });

  it('is not busy once the limits are there', () => {
    render(<SpendingChart report={SEPTEMBER} categories={CATEGORIES} />);

    const figure = screen.getByRole('figure', { name: 'Ausgaben nach Kategorie' });
    expect(figure).not.toHaveAttribute('aria-busy');
    expect(figure).not.toHaveTextContent('Budgets werden geladen');
  });
});
