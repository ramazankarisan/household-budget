import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatMonth } from '../format';
import { toLocale } from '../locales/messages';
import { ALL_MONTHS } from './useMonth';

interface MonthStepperProps {
  readonly month: string;
  /** Newest first. */
  readonly available: readonly string[];
  readonly allowAll: boolean;
  readonly onChange: (month: string) => void;
}

/**
 * `‹ September 2025 ›`. The arrows step through the months that have data — a history has
 * holes, and stepping into an empty month shows nothing worth seeing; the label opens the
 * whole list, with „Alle Monate“ first where the page allows it.
 */
export function MonthStepper({ month, available, allowAll, onChange }: MonthStepperProps) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.resolvedLanguage);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const index = available.indexOf(month);
  const isAll = month === ALL_MONTHS;
  const label = isAll ? t('common.month.all') : month === '' ? '—' : formatMonth(month, locale);
  // Older is further down the newest-first list.
  const older = isAll ? available[0] : available[index + 1];
  const newer = isAll ? undefined : index > 0 ? available[index - 1] : undefined;

  function pick(next: string): void {
    setAnchor(null);
    onChange(next);
  }

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 40,
        px: 0.5,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        backgroundColor: 'background.paper',
      }}
    >
      <IconButton
        size="small"
        aria-label={t('common.month.previous')}
        disabled={older === undefined}
        onClick={() => {
          if (older !== undefined) {
            onChange(older);
          }
        }}
      >
        <ChevronLeftRounded fontSize="small" />
      </IconButton>
      <Button
        size="small"
        color="inherit"
        aria-label={`${t('common.month.choose')}: ${label}`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        disabled={available.length === 0}
        onClick={(event) => {
          setAnchor(event.currentTarget);
        }}
        sx={{ minWidth: 132, fontWeight: 600 }}
      >
        {label}
      </Button>
      <IconButton
        size="small"
        aria-label={t('common.month.next')}
        disabled={newer === undefined}
        onClick={() => {
          if (newer !== undefined) {
            onChange(newer);
          }
        }}
      >
        <ChevronRightRounded fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={() => {
          setAnchor(null);
        }}
        slotProps={{ paper: { sx: { maxHeight: 360 } } }}
      >
        {allowAll && (
          <MenuItem selected={isAll} onClick={() => pick(ALL_MONTHS)}>
            {t('common.month.all')}
          </MenuItem>
        )}
        {available.map((option) => (
          <MenuItem key={option} selected={option === month} onClick={() => pick(option)}>
            {formatMonth(option, locale)}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
