import CloseRounded from '@mui/icons-material/CloseRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import SouthWestRounded from '@mui/icons-material/SouthWestRounded';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import { type SxProps, type Theme } from '@mui/material/styles';

type StatusKind = 'pending' | 'locked' | 'over' | 'income' | 'clear';

const ICONS = {
  pending: ScheduleRounded,
  locked: LockRounded,
  over: WarningAmberRounded,
  income: SouthWestRounded,
  clear: CloseRounded,
} as const;

interface StatusIconProps {
  readonly kind: StatusKind;
  /**
   * The icon's accessible name. Omit it when a word next to the icon already says the
   * same thing — the icon is then decoration and hidden from assistive tech.
   */
  readonly label?: string | undefined;
  readonly sx?: SxProps<Theme>;
}

/**
 * The states DESIGN.md §5 names, as icons instead of emoji: the hourglass emoji rendered differently per
 * OS, ignored the colour scheme and could not be sized to the type around it.
 */
export function StatusIcon({ kind, label, sx }: StatusIconProps) {
  const Icon = ICONS[kind];
  return (
    <Icon
      titleAccess={label}
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      role={label === undefined ? undefined : 'img'}
      sx={[{ fontSize: '1.125em', verticalAlign: '-0.2em' }, ...(Array.isArray(sx) ? sx : [sx])]}
    />
  );
}
