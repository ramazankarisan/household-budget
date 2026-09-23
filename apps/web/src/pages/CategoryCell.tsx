import { type CategoryPayload, type TransactionPayload } from '@household-budget/core';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';

import { rulesText } from '../i18n/rules';

interface CategoryCellProps {
  readonly transaction: TransactionPayload;
  readonly categories: readonly CategoryPayload[];
  /** `null` clears the category and the lock, making the row eligible again. */
  readonly onChange: (transactionId: string, categoryId: string | null) => void;
  readonly disabled?: boolean;
}

/**
 * The category on one row, and the one place a human overrides a rule.
 *
 * Choosing here locks the row: `categoryLockedAt` is set server-side, and the lock is
 * shown, because a row the rules engine will silently skip forever has to look different
 * from one it simply has not reached yet.
 */
export function CategoryCell({ transaction, categories, onChange, disabled }: CategoryCellProps) {
  const text = rulesText();
  const locked = transaction.categoryLockedAt !== null;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <TextField
        select
        size="small"
        variant="standard"
        label={text.category}
        // Empty string, not null: MUI reads `null` as uncontrolled and warns.
        value={transaction.categoryId ?? ''}
        disabled={disabled ?? false}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={{ minWidth: 150 }}
        onChange={(event) => {
          onChange(transaction.id, event.target.value === '' ? null : event.target.value);
        }}
      >
        <MenuItem value="">
          <em>{transaction.categoryId === null ? text.uncategorized : text.clearCategory}</em>
        </MenuItem>
        {categories.map((category) => (
          <MenuItem key={category.id} value={category.id}>
            {category.name}
          </MenuItem>
        ))}
      </TextField>
      {locked && (
        <Box component="span" aria-label={text.lockedHint} title={text.lockedHint}>
          🔒
        </Box>
      )}
    </Box>
  );
}
