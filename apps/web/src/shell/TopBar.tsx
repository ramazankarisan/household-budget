import UploadFileRounded from '@mui/icons-material/UploadFileRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useImport } from './importContext';
import { MonthStepper } from './MonthStepper';
import { type MonthState } from './useMonth';
import { useShortcuts } from './useShortcuts';

interface TopBarProps {
  /** The page's one `h1`. */
  readonly title: string;
  readonly subtitle?: ReactNode;
  /** Present on pages that show a month; drives the stepper and `[` / `]`. */
  readonly month?:
    | {
        readonly state: MonthState;
        readonly available: readonly string[];
        readonly allowAll: boolean;
      }
    | undefined;
  /** The page's own actions, right of the stepper. */
  readonly actions?: ReactNode;
}

/**
 * The top of every page: title on the left, the month and the page's actions on the right.
 * Rendered by the page — only the page knows its title, its months and its actions — so
 * every page's header is the same component and the same place.
 */
export function TopBar({ title, subtitle, month, actions }: TopBarProps) {
  const { t } = useTranslation();
  const { openImport } = useImport();
  useShortcuts(
    {
      '[': () => month?.state.step(-1),
      ']': () => month?.state.step(1),
    },
    month !== undefined,
  );

  return (
    <Stack
      component="header"
      direction="row"
      spacing={2}
      useFlexGap
      sx={{ alignItems: 'flex-end', flexWrap: 'wrap', pb: 1 }}
    >
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="h1" component="h1">
          {title}
        </Typography>
        {subtitle === undefined ? null : (
          <Typography variant="body1" color="text.secondary" component="div">
            {subtitle}
          </Typography>
        )}
      </Box>
      {month === undefined ? null : (
        <MonthStepper
          month={month.state.month}
          available={month.available}
          allowAll={month.allowAll}
          onChange={month.state.setMonth}
        />
      )}
      {actions}
      <Button
        variant="contained"
        startIcon={<UploadFileRounded />}
        onClick={() => {
          openImport();
        }}
      >
        {t('common.import.open')}
      </Button>
    </Stack>
  );
}
