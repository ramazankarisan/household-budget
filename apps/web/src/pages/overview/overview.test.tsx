import { type CategoryReport } from '@household-budget/core';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { BudgetBar } from '../../ui/BudgetBar';
import { SortCallout } from './SideCards';
import { TrendChart } from './TrendChart';

function entry(overrides: Partial<CategoryReport>): CategoryReport {
  const bookedCents = overrides.bookedCents ?? 0;
  const pendingCents = overrides.pendingCents ?? 0;
  const budgetCents = overrides.budgetCents ?? null;
  return {
    categoryId: 'cat-wohnen',
    bookedCents,
    pendingCents,
    budgetCents,
    remainingCents: budgetCents === null ? null : budgetCents - bookedCents - pendingCents,
    isOver: budgetCents !== null && bookedCents + pendingCents > budgetCents,
    transactionCount: 1,
    ...overrides,
  };
}

describe('BudgetBar', () => {
  it('is named by the sentence it shows', () => {
    render(
      <BudgetBar
        entry={entry({ bookedCents: 90000, budgetCents: 100000 })}
        colorIndex={0}
        label="Wohnen: 900,00 € von 1.000,00 €, 100,00 € übrig"
      />,
    );

    expect(
      screen.getByRole('img', { name: 'Wohnen: 900,00 € von 1.000,00 €, 100,00 € übrig' }),
    ).toHaveAttribute('data-tone', 'near');
  });

  it('draws vorgemerkt as its own segment, and only when there is some', () => {
    const { rerender } = render(
      <BudgetBar
        entry={entry({ bookedCents: 5000, budgetCents: 10000 })}
        colorIndex={0}
        label="x"
      />,
    );
    expect(screen.queryByTestId('pending-segment')).toBeNull();

    rerender(
      <BudgetBar
        entry={entry({ bookedCents: 5000, pendingCents: 1000, budgetCents: 10000 })}
        colorIndex={0}
        label="x"
      />,
    );
    expect(screen.getByTestId('pending-segment')).toBeInTheDocument();
  });

  it('draws nothing for a category without a limit', () => {
    const { container } = render(
      <BudgetBar entry={entry({ bookedCents: 5000 })} colorIndex={0} label="x" />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('TrendChart', () => {
  const totals = [
    { month: '2025-04', bookedCents: 205000, limitCents: null },
    { month: '2025-05', bookedCents: 0, limitCents: null },
    { month: '2025-09', bookedCents: 193802, limitCents: 213000 },
  ];

  it('is a captioned figure with the average of the months that have spending', () => {
    render(<TrendChart totals={totals} limitCents={213000} width={400} />);

    const figure = screen.getByRole('figure', { name: 'Verlauf' });
    expect(figure).toHaveTextContent('Verlauf');
    // (2.050,00 + 1.938,02) / 2 — the empty May is a gap, not a zero to average in.
    expect(figure.textContent.replaceAll('\u00a0', ' ')).toContain('Ø 1.994,01 €');
  });

  it('draws the limit line only when there is a limit', () => {
    const { container, rerender } = render(
      <TrendChart totals={totals} limitCents={213000} width={400} />,
    );
    expect(container.querySelector('.MuiChartsReferenceLine-root')).not.toBeNull();

    rerender(<TrendChart totals={totals} limitCents={null} width={400} />);
    expect(container.querySelector('.MuiChartsReferenceLine-root')).toBeNull();
  });
});

describe('SortCallout', () => {
  it('leads with the chosen month, and says the total beside it', () => {
    render(
      <MemoryRouter>
        <SortCallout
          total={12}
          inMonth={7}
          month="2025-09"
          href="/transactions?m=2025-09&c=uncategorized"
        />
      </MemoryRouter>,
    );

    const callout = screen.getByRole('link', { name: /Ohne Kategorie: 7/ });
    expect(callout).toHaveTextContent('im September 2025 · 12 insgesamt');
  });

  it('says when a month is done, and points at the others', () => {
    render(
      <MemoryRouter>
        <SortCallout
          total={5}
          inMonth={0}
          month="2025-09"
          href="/transactions?m=all&c=uncategorized"
        />
      </MemoryRouter>,
    );

    const callout = screen.getByRole('link', { name: /September 2025: alles kategorisiert/ });
    expect(callout).toHaveTextContent('noch 5 in anderen Monaten');
    expect(callout).toHaveAttribute('href', '/transactions?m=all&c=uncategorized');
  });
});
