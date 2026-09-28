import { type AccountPayload, type CategoryPayload } from '@household-budget/core';
import InboxRounded from '@mui/icons-material/InboxRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { type TransactionFilterState, UNCATEGORIZED } from '../../filter';
import { describeUncategorized } from '../../locales/sentences';
import { useShortcuts } from '../../shell/useShortcuts';
import { CategoryDot } from '../../ui/CategoryPill';
import { KeyHint } from '../../ui/KeyHint';
import { StatusIcon } from '../../ui/StatusIcon';

interface FilterBarProps {
  readonly filters: TransactionFilterState;
  readonly categories: readonly CategoryPayload[];
  readonly accounts: readonly AccountPayload[];
  /** Rows without a category in the chosen accounts and month — never just the filtered view. */
  readonly uncategorized: number;
  readonly onChange: (filters: TransactionFilterState) => void;
}

/**
 * What narrows the list: a search over payee, purpose and IBAN (`/` jumps to it), a
 * category, and — with more than one account — an account. The month is the top bar's.
 * The chip on the right says how much is left to sort, and shows exactly those rows.
 *
 * Presentational: it owns no state and does no filtering. It wraps rather than widens.
 */
export function FilterBar({
  filters,
  categories,
  accounts,
  uncategorized,
  onChange,
}: FilterBarProps) {
  const { t } = useTranslation();
  const search = useRef<HTMLInputElement>(null);
  useShortcuts({
    '/': () => {
      search.current?.focus();
    },
  });

  return (
    <Stack
      direction="row"
      spacing={1.25}
      useFlexGap
      sx={{ flexWrap: 'wrap', alignItems: 'center' }}
    >
      <TextField
        size="small"
        value={filters.search}
        inputRef={search}
        // No debounce: the haystacks are normalized once per loaded list, which leaves a
        // keystroke under a millisecond at 50 000 rows (research 03 §6).
        onChange={(event) => {
          onChange({ ...filters, search: event.target.value });
        }}
        placeholder={t('transactions.search')}
        slotProps={{
          htmlInput: { 'aria-label': t('transactions.search') },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchRounded fontSize="small" />
              </InputAdornment>
            ),
            endAdornment:
              filters.search === '' ? (
                <InputAdornment position="end">
                  <KeyHint keys="/" />
                </InputAdornment>
              ) : (
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
        sx={{ width: { xs: '100%', sm: 320 } }}
      />

      {/*
        No visible labels on the selects: MUI's `label` becomes an `aria-labelledby`, which
        outranks `aria-label`, and "Kategorie" would name this control what every row's pill
        is named. A filter select shows its own value, and at rest that value is the words
        „Alle Kategorien“ / „Alle Konten“ — which is what `displayEmpty` buys.
      */}
      <TextField
        select
        size="small"
        value={filters.categoryId}
        onChange={(event) => {
          onChange({ ...filters, categoryId: event.target.value });
        }}
        slotProps={{
          select: { 'aria-label': t('transactions.filterCategory'), displayEmpty: true },
        }}
        sx={{ minWidth: 190 }}
      >
        <MenuItem value="">{t('transactions.allCategories')}</MenuItem>
        <MenuItem value={UNCATEGORIZED}>{t('common.uncategorized')}</MenuItem>
        {categories.map((category) => (
          <MenuItem key={category.id} value={category.id} sx={{ gap: 1 }}>
            <CategoryDot colorIndex={category.colorIndex} />
            {category.name}
          </MenuItem>
        ))}
      </TextField>

      {accounts.length > 1 && (
        <TextField
          select
          size="small"
          value={filters.accountId}
          onChange={(event) => {
            onChange({ ...filters, accountId: event.target.value });
          }}
          slotProps={{
            select: { 'aria-label': t('transactions.filterAccount'), displayEmpty: true },
          }}
          sx={{ minWidth: 190 }}
        >
          <MenuItem value="">{t('transactions.allAccounts')}</MenuItem>
          {accounts.map((account) => (
            <MenuItem key={account.id} value={account.id}>
              {account.name} · …{account.iban.slice(-4)}
            </MenuItem>
          ))}
        </TextField>
      )}

      <Box sx={{ flexGrow: 1 }} />

      {uncategorized > 0 ? (
        <Chip
          icon={<InboxRounded />}
          label={describeUncategorized(t, uncategorized)}
          // The count and what clicking does, in that order: `aria-label` replaces the
          // visible label rather than adding to it.
          aria-label={`${describeUncategorized(t, uncategorized)} · ${t('transactions.showUncategorized')}`}
          onClick={() => {
            onChange({ ...filters, categoryId: UNCATEGORIZED });
          }}
          sx={{
            backgroundColor: 'status.near.soft',
            color: 'status.near.main',
            fontWeight: 600,
            '& .MuiChip-icon': { color: 'inherit' },
          }}
        />
      ) : (
        // Inert at zero: there is nothing left to open, and a control that does nothing is
        // worse than none.
        <Chip variant="outlined" label={describeUncategorized(t, 0)} />
      )}
    </Stack>
  );
}
