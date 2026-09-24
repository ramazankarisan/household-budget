import { type CategoryPayload, type TransactionPayload } from '@household-budget/core';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { rulesText } from '../i18n/rules';

interface CategoryCellProps {
  readonly transaction: TransactionPayload;
  readonly categories: readonly CategoryPayload[];
  /** `null` clears the category and the lock, making the row eligible again. */
  readonly onChange: (transactionId: string, categoryId: string | null) => void;
  /** Set while this row's own change is in flight, so a second one cannot start. */
  readonly disabled?: boolean;
}

/**
 * The category on one row, and the one place a human overrides a rule.
 *
 * Choosing here locks the row: `categoryLockedAt` is set server-side, and the lock is
 * shown, because a row the rules engine will silently skip forever has to look different
 * from one it simply has not reached yet.
 *
 * Read-only in two cases. On a **pending** row, because the next import replaces the
 * pending set wholesale and those rows carry no dedupKey for a replacement to inherit
 * from — offering a decision that a later import throws away is worse than not offering
 * it, and the API refuses it for the same reason. And while the categories are still
 * loading, because a `Select` whose value matches no option warns and renders blank.
 * A rule still categorizes both; that assignment is re-derived on every apply.
 */
export function CategoryCell({ transaction, categories, onChange, disabled }: CategoryCellProps) {
  const text = rulesText();
  const locked = transaction.categoryLockedAt !== null;
  const current = categories.find((category) => category.id === transaction.categoryId);
  const pending = transaction.status === 'pending';
  const readOnly = pending || categories.length === 0;

  if (readOnly) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
        <Typography
          variant="body2"
          title={pending ? text.pendingHint : (current?.name ?? text.uncategorized)}
          color={current === undefined ? 'text.disabled' : 'text.primary'}
          sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {current?.name ?? text.uncategorized}
        </Typography>
      </Box>
    );
  }

  return (
    // minWidth 0 on the flex child: without it the select refuses to shrink below its
    // longest option and widens the fixed column it is supposed to fit inside.
    <Box
      title={current?.name ?? text.uncategorized}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}
    >
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
        // Empty string, not null: MUI reads `null` as uncontrolled and warns. A category
        // the loaded list does not contain is empty too, for the same reason.
        value={current?.id ?? ''}
        disabled={disabled ?? false}
        sx={{
          minWidth: 0,
          flex: 1,
          '& .MuiSelect-select': {
            py: 0.25,
            fontSize: '0.875rem',
            // A long category name is cut with an ellipsis rather than widening the row.
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        }}
        onChange={(event) => {
          onChange(transaction.id, event.target.value === '' ? null : event.target.value);
        }}
      >
        <MenuItem value="">
          <Box component="em" sx={{ color: 'text.disabled' }}>
            {/*
              Keyed on whether a category was *resolved*, not on whether the row names one.
              This item is also what the closed select displays when the value is empty, so
              on a row holding an id the loaded list does not contain — a category deleted
              while this soft-deleted row still pointed at it, or the moment before the
              categories arrive — "Kategorie entfernen" would be shown as though that were
              the row's current category.
            */}
            {current === undefined ? text.uncategorized : text.clearCategory}
          </Box>
        </MenuItem>
        {categories.map((category) => (
          <MenuItem key={category.id} value={category.id}>
            {category.name}
          </MenuItem>
        ))}
      </TextField>
      {/*
        The slot is always there, lock or not. The select is `flex: 1`, so a lock that only
        appeared on locked rows made their select narrower and moved the chevron out of the
        column every other row lines up in.
      */}
      <Box
        component="span"
        data-testid="lock-slot"
        aria-hidden={locked ? undefined : true}
        aria-label={locked ? text.lockedHint : undefined}
        title={locked ? text.lockedHint : undefined}
        sx={{ width: '1rem', flexShrink: 0, fontSize: '0.75rem', lineHeight: 1 }}
      >
        {locked ? '🔒' : null}
      </Box>
    </Box>
  );
}
