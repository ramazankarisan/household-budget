import { type CategoryPayload } from '@household-budget/core';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';

import { type TransactionFilterState, UNCATEGORIZED } from '../filter';
import { formatMonth } from '../format';
import { describeUncategorized, transactionsText } from '../i18n/transactions';

interface TransactionFiltersProps {
  readonly filters: TransactionFilterState;
  /** `'YYYY-MM'`, newest first — only the months the account actually has. */
  readonly months: readonly string[];
  readonly categories: readonly CategoryPayload[];
  /** Uncategorized rows in the **whole account**, not in the filtered view. */
  readonly uncategorized: number;
  readonly onChange: (filters: TransactionFilterState) => void;
}

/**
 * The one toolbar row above the table: what to show, and how much is left to do.
 *
 * Presentational — it owns no state and does no filtering. It wraps rather than widens,
 * because the table below it is `tableLayout: 'fixed'` and two commits exist solely to
 * keep Betrag on the page.
 */
export function TransactionFilters({
  filters,
  months,
  categories,
  uncategorized,
  onChange,
}: TransactionFiltersProps) {
  const text = transactionsText();

  return (
    <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
      {/*
        No visible label on either select. MUI's `label` becomes an `aria-labelledby`,
        which outranks `aria-label` in the name computation — so a visible "Kategorie"
        here would name this control exactly what `CategoryCell` names the combobox on
        every row, and every page-scoped query for one of those would match two elements.
        Nothing is lost by dropping it: a filter select displays its own value, and the
        value at rest is the words "Alle Monate" and "Alle Kategorien" — which is what
        `displayEmpty` buys. Without it MUI renders a zero-width space for an empty value
        and both controls sit there blank, the same reason `CategoryCell` sets it.
      */}
      <TextField
        select
        size="small"
        slotProps={{ select: { 'aria-label': text.month, displayEmpty: true } }}
        value={filters.month}
        onChange={(event) => {
          onChange({ ...filters, month: event.target.value });
        }}
        sx={{ minWidth: 180 }}
      >
        <MenuItem value="">{text.allMonths}</MenuItem>
        {months.map((month) => (
          <MenuItem key={month} value={month}>
            {formatMonth(month)}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        select
        size="small"
        slotProps={{ select: { 'aria-label': text.filterCategory, displayEmpty: true } }}
        value={filters.categoryId}
        onChange={(event) => {
          onChange({ ...filters, categoryId: event.target.value });
        }}
        sx={{ minWidth: 200 }}
      >
        <MenuItem value="">{text.allCategories}</MenuItem>
        <MenuItem value={UNCATEGORIZED}>{text.uncategorized}</MenuItem>
        {categories.map((category) => (
          <MenuItem key={category.id} value={category.id}>
            {category.name}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        size="small"
        value={filters.search}
        // No debounce: the haystacks are normalized once per loaded list, which leaves a
        // keystroke under a millisecond at 50 000 rows (research §6). A debounce would be
        // a state machine to own in exchange for nothing.
        onChange={(event) => {
          onChange({ ...filters, search: event.target.value });
        }}
        slotProps={{
          htmlInput: { 'aria-label': text.search },
          input: {
            endAdornment:
              filters.search === '' ? undefined : (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    aria-label={text.clearSearch}
                    onClick={() => {
                      onChange({ ...filters, search: '' });
                    }}
                  >
                    ✕
                  </IconButton>
                </InputAdornment>
              ),
          },
        }}
        placeholder={text.search}
        sx={{ minWidth: 220 }}
      />

      {/* Pushes the count to the far end on a wide window, and collapses when it wraps. */}
      <Box sx={{ flexGrow: 1 }} />

      {uncategorized > 0 ? (
        <Chip
          color="warning"
          label={describeUncategorized(uncategorized)}
          aria-label={text.showUncategorized}
          onClick={() => {
            onChange({ ...filters, categoryId: UNCATEGORIZED });
          }}
        />
      ) : (
        // Inert below zero: there is nothing left to open, and a control that does
        // nothing is worse than none.
        <Chip variant="outlined" label={describeUncategorized(0)} />
      )}
    </Stack>
  );
}
