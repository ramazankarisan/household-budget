import { type CategoryPayload } from '@household-budget/core';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useTranslation } from 'react-i18next';

import { type TransactionFilterState, UNCATEGORIZED } from '../filter';
import { describeUncategorized } from '../locales/sentences';
import { StatusIcon } from '../ui/StatusIcon';

interface TransactionFiltersProps {
  readonly filters: TransactionFilterState;
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
  categories,
  uncategorized,
  onChange,
}: TransactionFiltersProps) {
  const { t } = useTranslation();

  return (
    <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
      {/*
        No visible label on the select. MUI's `label` becomes an `aria-labelledby`,
        which outranks `aria-label` in the name computation — so a visible "Kategorie"
        here would name this control exactly what `CategoryCell` names the combobox on
        every row, and every page-scoped query for one of those would match two elements.
        Nothing is lost by dropping it: a filter select displays its own value, and the
        value at rest is the words "Alle Kategorien" — which is what `displayEmpty` buys.
        Without it MUI renders a zero-width space for an empty value and the control sits
        there blank, the same reason `CategoryCell` sets it. The month is the top bar's.
      */}
      <TextField
        select
        size="small"
        slotProps={{
          select: { 'aria-label': t('transactions.filterCategory'), displayEmpty: true },
        }}
        value={filters.categoryId}
        onChange={(event) => {
          onChange({ ...filters, categoryId: event.target.value });
        }}
        sx={{ minWidth: 200 }}
      >
        <MenuItem value="">{t('transactions.allCategories')}</MenuItem>
        <MenuItem value={UNCATEGORIZED}>{t('common.uncategorized')}</MenuItem>
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
          htmlInput: { 'aria-label': t('transactions.search') },
          input: {
            endAdornment:
              filters.search === '' ? undefined : (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    aria-label={t('transactions.clearSearch')}
                    onClick={() => {
                      onChange({ ...filters, search: '' });
                    }}
                  >
                    <StatusIcon kind="clear" />
                  </IconButton>
                </InputAdornment>
              ),
          },
        }}
        placeholder={t('transactions.search')}
        sx={{ minWidth: 220 }}
      />

      {/* Pushes the count to the far end on a wide window, and collapses when it wraps. */}
      <Box sx={{ flexGrow: 1 }} />

      {uncategorized > 0 ? (
        <Chip
          color="warning"
          label={describeUncategorized(t, uncategorized)}
          // The count and what clicking does, in that order. `aria-label` replaces the
          // visible label in the accessible name rather than adding to it, so naming this
          // only after its action would leave a screen reader with everything about the
          // chip except the one number it exists to report.
          aria-label={`${describeUncategorized(t, uncategorized)} · ${t('transactions.showUncategorized')}`}
          onClick={() => {
            onChange({ ...filters, categoryId: UNCATEGORIZED });
          }}
        />
      ) : (
        // Inert below zero: there is nothing left to open, and a control that does
        // nothing is worse than none.
        <Chip variant="outlined" label={describeUncategorized(t, 0)} />
      )}
    </Stack>
  );
}
