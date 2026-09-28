import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RuleSentence, RuleSentenceEditor } from './RuleSentence';

const CATEGORIES = [{ id: 'cat-wohnen', name: 'Wohnen', colorIndex: 0 }];

describe('RuleSentence', () => {
  it('reads as the sentence the rule is', () => {
    render(
      <RuleSentence
        rule={{
          field: 'counterpartyName',
          operator: 'contains',
          value: 'rewe',
          categoryId: 'cat-wohnen',
        }}
        categories={CATEGORIES}
      />,
    );

    expect(document.body).toHaveTextContent(/Wenn\s*Empfänger\s*enthält\s*„rewe“\s*Wohnen/u);
  });

  it('shows an IBAN the way an IBAN is read, without quotes', () => {
    render(
      <RuleSentence
        rule={{
          field: 'counterpartyIban',
          operator: 'equals',
          value: 'de89370400440532013000',
          categoryId: 'cat-wohnen',
        }}
        categories={CATEGORIES}
      />,
    );

    expect(screen.getByText('DE89370400440532013000')).toBeInTheDocument();
  });
});

describe('RuleSentenceEditor', () => {
  it('moves off an operator the new field does not allow', () => {
    const onChange = vi.fn();
    render(
      <RuleSentenceEditor
        rule={{
          field: 'counterpartyName',
          operator: 'contains',
          value: 'x',
          categoryId: 'cat-wohnen',
        }}
        categories={CATEGORIES}
        onChange={onChange}
      />,
    );

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Feld' }));
    fireEvent.click(screen.getByRole('option', { name: 'IBAN' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'counterpartyIban', operator: 'equals' }),
    );
  });
});
