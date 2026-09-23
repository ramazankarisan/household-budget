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
        // No visible label: the column header already says "Kategorie", and repeating it
        // once per row is what pushed the table past the width of the page. The name is
        // still there for anyone not reading the header.
        slotProps={{
          // displayEmpty: without it MUI renders an empty cell for an uncategorized row,
          // which reads as "nothing here" rather than "nothing chosen yet".
          select: { 'aria-label': text.category, displayEmpty: true },
          input: { disableUnderline: true },
        }}
        // Empty string, not null: MUI reads `null` as uncontrolled and warns.
        value={transaction.categoryId ?? ''}
        disabled={disabled ?? false}
        sx={{
          minWidth: 0,
          '& .MuiSelect-select': {
            // The widest category name decides the column, not a fixed guess.
            py: 0.25,
            fontSize: '0.875rem',
          },
        }}
        onChange={(event) => {
          onChange(transaction.id, event.target.value === '' ? null : event.target.value);
        }}
      >
        <MenuItem value="">
          <Box component="em" sx={{ color: 'text.disabled' }}>
            {transaction.categoryId === null ? text.uncategorized : text.clearCategory}
          </Box>
        </MenuItem>
        {categories.map((category) => (
          <MenuItem key={category.id} value={category.id}>
            {category.name}
          </MenuItem>
        ))}
      </TextField>
      {locked && (
        <Box
          component="span"
          aria-label={text.lockedHint}
          title={text.lockedHint}
          sx={{ fontSize: '0.75rem', lineHeight: 1 }}
        >
          🔒
        </Box>
      )}
    </Box>
  );
}
