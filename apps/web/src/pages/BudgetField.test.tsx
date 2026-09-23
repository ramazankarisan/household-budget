import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BudgetField } from './BudgetField';

function renderField(budgetCents: number | null = null) {
  const onSave = vi.fn<(amountCents: number) => void>();
  const onClear = vi.fn<() => void>();

  render(
    <BudgetField
      budgetCents={budgetCents}
      categoryName="Wohnen"
      month="2025-09"
      categoryId="cat-wohnen"
      disabled={false}
      onSave={onSave}
      onClear={onClear}
    />,
  );

  return { onSave, onClear, input: screen.getByRole('textbox', { name: 'Budget Wohnen' }) };
}

function type(input: HTMLElement, value: string): void {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
}

describe('BudgetField', () => {
  it('turns 700 into 70000 cents when the field is left', () => {
    const { onSave, input } = renderField();

    type(input, '700');
    fireEvent.blur(input);

    expect(onSave).toHaveBeenCalledExactlyOnceWith(70000);
    expect(input).toHaveValue('700,00');
  });

  it('reads a comma as the decimal separator, the way a statement does', () => {
    const { onSave, input } = renderField();

    type(input, '700,5');
    fireEvent.blur(input);

    expect(onSave).toHaveBeenCalledExactlyOnceWith(70050);
  });

  it('writes once on Enter, not once for the key and again for the blur it causes', () => {
    const { onSave, input } = renderField();

    // Really focused, so the `blur()` Enter calls really blurs and its handler runs.
    input.focus();
    type(input, '1.234,56');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input).not.toHaveFocus();
    expect(onSave).toHaveBeenCalledExactlyOnceWith(123456);
  });

  it('clears a set limit when emptied', () => {
    const { onSave, onClear, input } = renderField(70000);

    expect(input).toHaveValue('700,00');
    type(input, '   ');
    fireEvent.blur(input);

    expect(onClear).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('writes nothing when a field that was empty is left empty', () => {
    const { onSave, onClear, input } = renderField();

    fireEvent.focus(input);
    fireEvent.blur(input);

    expect(onSave).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it('writes nothing when the number did not change', () => {
    const { onSave, input } = renderField(70000);

    type(input, '700');
    fireEvent.blur(input);

    expect(onSave).not.toHaveBeenCalled();
  });

  it('refuses a negative limit, says why, and keeps the caret in the field', () => {
    const { onSave, input } = renderField();

    input.focus();
    type(input, '-5');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('Ein Budget kann nicht negativ sein')).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('refuses text that is not an amount in euro', () => {
    const { onSave, input } = renderField();

    type(input, '700.50');
    fireEvent.blur(input);

    // `700.50` is ambiguous in German — a thousands separator in the wrong place, or an
    // English decimal point — and a limit is not something to guess about.
    expect(screen.getByText('Betrag in Euro, z. B. 700 oder 700,50')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('offers a clear button only once a limit is set', () => {
    renderField();
    expect(screen.queryByRole('button', { name: 'Budget entfernen: Wohnen' })).toBeNull();
  });

  it('clears through the button', () => {
    const { onClear } = renderField(70000);

    fireEvent.click(screen.getByRole('button', { name: 'Budget entfernen: Wohnen' }));

    expect(onClear).toHaveBeenCalledOnce();
  });
});
