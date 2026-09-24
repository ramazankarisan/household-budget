import { type BudgetInputError, parseBudgetInput, parseGermanAmount } from '@household-budget/core';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { describeBudgetError } from '../locales/sentences';

interface BudgetFieldProps {
  /** The limit as stored, or `null` when this month has none for the category. */
  readonly budgetCents: number | null;
  /** For the accessible name: a column of identical "Budget" fields is not navigable. */
  readonly categoryName: string;
  readonly month: string;
  readonly categoryId: string;
  /** Set while this cell's own write is in flight, so a second one cannot start. */
  readonly disabled: boolean;
  readonly onSave: (amountCents: number) => void;
  readonly onClear: () => void;
}

/** Whole euros with the German thousands dot. Integers only — the cents are appended by hand. */
const EUROS = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0, useGrouping: true });

/**
 * `123456` to `1.234,56` — what the field shows at rest. No `€`: the column header says it.
 * Grouped like every other amount on the page; `parseGermanAmount` reads the dot back.
 */
function draftOf(cents: number | null): string {
  if (cents === null) {
    return '';
  }
  const euros = Math.trunc(cents / 100);
  const fraction = String(cents % 100).padStart(2, '0');
  return `${EUROS.format(euros)},${fraction}`;
}

/**
 * The inline editor for one cell of the budget table.
 *
 * It holds a **string** while it is typed, the `RuleDraft` posture: a number field would
 * turn `700,` into `NaN` halfway through typing `700,50`. The string is parsed on blur or
 * Enter by core's `parseGermanAmount` — the same parser the CSV import trusts with the
 * bank's own amounts, so `1.234,56` and `12,3` mean what they mean on a statement — and
 * then validated by `parseBudgetInput`, the function the API runs on the same value.
 *
 * Nothing is written until a number is entered and committed. An emptied field clears a
 * limit that was set and does nothing for one that was not. The parent keys this by the
 * stored value, so a successful write — or a failed one the parent chose to discard —
 * remounts it with the stored number rather than the typed one.
 */
export function BudgetField({
  budgetCents,
  categoryName,
  month,
  categoryId,
  disabled,
  onSave,
  onClear,
}: BudgetFieldProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => draftOf(budgetCents));
  // What was refused, not its sentence: worded at render, so it follows a language switch.
  // `refusal` is `undefined` when core reported no error to name — the field is still marked.
  const [error, setError] = useState<
    { readonly refusal: BudgetInputError | undefined } | undefined
  >(undefined);
  const input = useRef<HTMLInputElement>(null);

  /**
   * What the typed text amounts to, without acting on it. Split from {@link commit} so
   * Enter can refuse a value and keep the caret where it is, and otherwise leave the write
   * to the blur it triggers — committing on both would write the same cell twice.
   */
  function evaluate():
    | { readonly kind: 'clear' }
    | { readonly kind: 'save'; readonly amountCents: number }
    | { readonly kind: 'refused'; readonly refusal: BudgetInputError | undefined } {
    const trimmed = draft.trim();
    if (trimmed === '') {
      return { kind: 'clear' };
    }

    // `undefined` from the parser is reported as the integer error rather than a code of
    // its own: to the user both mean "that is not an amount in euro".
    const amountCents = parseGermanAmount(trimmed) ?? Number.NaN;
    const parsed = parseBudgetInput({ month, categoryId, amountCents });
    if (parsed.ok) {
      return { kind: 'save', amountCents: parsed.budget.amountCents };
    }
    const refusal =
      parsed.errors.find((entry) => entry.field === 'amountCents') ?? parsed.errors[0];
    return { kind: 'refused', refusal };
  }

  function commit(): void {
    const outcome = evaluate();

    switch (outcome.kind) {
      case 'refused':
        setError({ refusal: outcome.refusal });
        return;
      case 'clear':
        setError(undefined);
        if (budgetCents !== null) {
          onClear();
        }
        return;
      case 'save':
        setError(undefined);
        setDraft(draftOf(outcome.amountCents));
        if (outcome.amountCents !== budgetCents) {
          onSave(outcome.amountCents);
        }
        return;
    }
  }

  return (
    <TextField
      size="small"
      value={draft}
      placeholder={t('budgets.setBudget')}
      disabled={disabled}
      error={error !== undefined}
      helperText={error?.refusal === undefined ? undefined : describeBudgetError(t, error.refusal)}
      inputRef={input}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={() => {
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const outcome = evaluate();
          if (outcome.kind === 'refused') {
            setError({ refusal: outcome.refusal });
          } else {
            // The blur commits. Committing here as well would write the cell twice.
            input.current?.blur();
          }
        } else if (event.key === 'Escape') {
          setDraft(draftOf(budgetCents));
          setError(undefined);
        }
      }}
      slotProps={{
        htmlInput: {
          'aria-label': `${t('budgets.columns.budget')} ${categoryName}`,
          inputMode: 'decimal',
          style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
        },
        input: {
          endAdornment:
            budgetCents === null ? undefined : (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  aria-label={`${t('budgets.clearBudget')}: ${categoryName}`}
                  disabled={disabled}
                  // Keeps focus in the input: a blur would commit whatever is typed
                  // before the clear it is about to be replaced by.
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => {
                    setDraft('');
                    setError(undefined);
                    onClear();
                  }}
                >
                  ✕
                </IconButton>
              </InputAdornment>
            ),
        },
      }}
      sx={{ width: '10rem' }}
    />
  );
}
