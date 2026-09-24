import { type ImportSummary, type RowError } from '@household-budget/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ImportResult } from './ImportPanel';

function rowErrors(count: number): RowError[] {
  return Array.from({ length: count }, (_, index) => ({
    code: 'AMOUNT_UNPARSEABLE',
    line: index + 2,
    field: 'Betrag',
    value: '12,3,4',
  }));
}

function summary(failed: RowError[], failedCount: number): ImportSummary {
  return {
    batchId: 'batch-1',
    parsed: 0,
    imported: 0,
    skipped: 0,
    restored: 0,
    pendingReplaced: 0,
    categorized: 0,
    failed,
    failedCount,
    encoding: 'utf-8',
  };
}

describe('ImportResult', () => {
  it('counts every failed row and says how many the capped list leaves out', () => {
    render(<ImportResult summary={summary(rowErrors(100), 150)} />);

    expect(screen.getByText(/150 fehlerhaft/)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(100);
    expect(screen.getByText('… und 50 weitere')).toBeInTheDocument();
  });

  it('lists every failed row and adds nothing when the list is complete', () => {
    render(<ImportResult summary={summary(rowErrors(3), 3)} />);

    expect(screen.getByText(/3 fehlerhaft/)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByText(/weitere/)).not.toBeInTheDocument();
  });
});
