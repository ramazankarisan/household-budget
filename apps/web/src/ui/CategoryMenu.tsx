import { type CategoryPayload, normalize } from '@household-budget/core';
import AddRounded from '@mui/icons-material/AddRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import Popover from '@mui/material/Popover';
import TextField from '@mui/material/TextField';
import { type KeyboardEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CategoryDot } from './CategoryPill';
import { KeyHint } from './KeyHint';

interface CategoryMenuProps {
  readonly anchorEl: HTMLElement | null;
  readonly onClose: () => void;
  readonly categories: readonly CategoryPayload[];
  /** What the row holds now; `null` for none. Offers „Kategorie entfernen“ when set. */
  readonly currentId: string | null;
  readonly onPick: (categoryId: string | null) => void;
  /** Creates a category by name and picks it. Omitted: no „Neue Kategorie“ entry. */
  readonly onCreate?: ((name: string) => void) | undefined;
}

/**
 * Choosing a category from many (DESIGN.md §5): type to narrow — `müll` and `MÜLL` alike,
 * through core's `normalize` — arrow keys to move, Enter or a number key to pick, and
 * „Neue Kategorie „…““ when nothing typed exists yet.
 */
export function CategoryMenu({
  anchorEl,
  onClose,
  categories,
  currentId,
  onPick,
  onCreate,
}: CategoryMenuProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const list = useRef<HTMLUListElement>(null);
  const needle = normalize(query);
  const shown = categories.filter((category) => normalize(category.name).includes(needle));
  const exists = categories.some((category) => normalize(category.name) === needle);
  const canCreate = onCreate !== undefined && needle !== '' && !exists;

  function close(): void {
    setQuery('');
    onClose();
  }

  function pick(categoryId: string | null): void {
    close();
    onPick(categoryId);
  }

  function onListKey(event: KeyboardEvent): void {
    const index = Number(event.key);
    if (Number.isInteger(index) && index >= 1 && index <= 9) {
      const category = shown[index - 1];
      if (category !== undefined) {
        event.preventDefault();
        pick(category.id);
      }
    }
  }

  return (
    <Popover
      open={anchorEl !== null}
      anchorEl={anchorEl}
      onClose={close}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{ paper: { sx: { width: 280, p: 1 } } }}
    >
      <TextField
        autoFocus
        size="small"
        fullWidth
        value={query}
        placeholder={t('inbox.searchCategory')}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            list.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const first = shown[0];
            if (first !== undefined) {
              pick(first.id);
            } else if (canCreate) {
              close();
              onCreate(query.trim());
            }
          }
        }}
        slotProps={{
          htmlInput: { 'aria-label': t('inbox.searchCategory') },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchRounded fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
      />
      <MenuList
        ref={list}
        aria-label={t('inbox.chooseCategory')}
        dense
        onKeyDown={onListKey}
        sx={{ maxHeight: 320, overflowY: 'auto', mt: 0.5 }}
      >
        {shown.map((category, index) => (
          <MenuItem
            key={category.id}
            selected={category.id === currentId}
            onClick={() => {
              pick(category.id);
            }}
            sx={{ gap: 1.25, borderRadius: 1 }}
          >
            <CategoryDot colorIndex={category.colorIndex} />
            <Box component="span" sx={{ flexGrow: 1 }}>
              {category.name}
            </Box>
            {index < 9 && <KeyHint keys={String(index + 1)} />}
          </MenuItem>
        ))}
        {canCreate && (
          <MenuItem
            onClick={() => {
              close();
              onCreate(query.trim());
            }}
            sx={{ gap: 1.25, borderRadius: 1, color: 'primary.main' }}
          >
            <AddRounded fontSize="small" />
            {t('inbox.createNamed', { name: query.trim() })}
          </MenuItem>
        )}
        {currentId !== null && [
          <Divider key="divider" />,
          <MenuItem
            key="clear"
            onClick={() => {
              pick(null);
            }}
            sx={{ borderRadius: 1, color: 'text.secondary' }}
          >
            {t('rules.clearCategory')}
          </MenuItem>,
        ]}
      </MenuList>
    </Popover>
  );
}
