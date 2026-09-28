import Box from '@mui/material/Box';
import { type SxProps, type Theme } from '@mui/material/styles';

import { formatAmount } from '../format';

interface AmountTextProps {
  /** Signed integer cents. */
  readonly cents: number;
  /**
   * `auto` — money in is `status.income` with a leading `+`; money out stays text colour,
   * because spending is normal and is not red (DESIGN.md §4). `plain` — never coloured.
   */
  readonly tone?: 'auto' | 'plain';
  readonly component?: 'span' | 'div';
  readonly sx?: SxProps<Theme>;
}

/** Every amount the app shows: formatted once, tabular, never wrapped mid-number. */
export function AmountText({ cents, tone = 'plain', component = 'span', sx }: AmountTextProps) {
  const income = tone === 'auto' && cents > 0;
  const text = formatAmount(cents);

  return (
    <Box
      component={component}
      sx={[
        {
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
          color: income ? 'status.income.main' : undefined,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {income ? `+${text}` : text}
    </Box>
  );
}
