import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { type ReactNode } from 'react';

/** One sentence and at most one way forward (DESIGN.md §7). No illustration. */
export function EmptyState({
  message,
  action,
}: {
  readonly message: string;
  readonly action?: ReactNode;
}) {
  return (
    <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
      <Typography variant="body1" color="text.secondary">
        {message}
      </Typography>
      {action}
    </Stack>
  );
}
