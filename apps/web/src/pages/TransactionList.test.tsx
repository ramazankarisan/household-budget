import { type TransactionPayload } from '@household-budget/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TransactionList } from './TransactionList';

function transaction(overrides: Partial<TransactionPayload> = {}): TransactionPayload {
  return {
    id: 'a',
    bookingDate: '2025-09-22',
    valueDate: '2025-09-22',
    amountCents: -83290,
    currency: 'EUR',
    status: 'booked',
    counterpartyName: 'Müller GmbH',
    purpose: 'Rechnung 4711',
    bookingText: 'FOLGELASTSCHRIFT',
    bankCategory: 'Wohnen',
    ...overrides,
  };
}

describe('TransactionList', () => {
  it('invites an import when there is nothing to show', () => {
    render(<TransactionList transactions={[]} />);

    expect(screen.getByText(/Noch keine Umsätze/)).toBeInTheDocument();
  });

  it('renders a transaction with German date and amount formatting', () => {
    render(<TransactionList transactions={[transaction()]} />);

    expect(screen.getByRole('cell', { name: 'Müller GmbH' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '22.09.2025' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: /832,90/ })).toBeInTheDocument();
  });

  it('labels a pending row so it cannot be mistaken for a settled one', () => {
    render(
      <TransactionList
        transactions={[transaction({ id: 'b', status: 'pending', counterpartyName: 'Ärzte GmbH' })]}
      />,
    );

    expect(screen.getByLabelText('vorgemerkt')).toBeInTheDocument();
  });

  it('shows both of two identical rows', () => {
    // They are two distinct purchases, and collapsing them would hide money spent.
    render(
      <TransactionList
        transactions={[
          transaction({ id: 'a', counterpartyName: 'REWE', amountCents: -4217 }),
          transaction({ id: 'b', counterpartyName: 'REWE', amountCents: -4217 }),
        ]}
      />,
    );

    expect(screen.getAllByRole('cell', { name: 'REWE' })).toHaveLength(2);
  });

  it('renders a dash for a row the bank left blank', () => {
    render(
      <TransactionList transactions={[transaction({ counterpartyName: null, purpose: null })]} />,
    );

    expect(screen.getAllByRole('cell', { name: '—' })).toHaveLength(2);
  });
});
