import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import { useEffect, useState } from 'react';

/** How long a load may take before anything is shown for it (DESIGN.md §7). */
export const SKELETON_DELAY_MS = 300;

interface DelayedSkeletonProps {
  /** Rows of the content being waited for. */
  readonly rows?: number;
  /** Height of one row, in theme spacing units. */
  readonly rowHeight?: number;
  readonly label: string;
}

/**
 * Nothing for the first 300 ms, then placeholders in the content's shape. A spinner that
 * flashes for a local load reads as jank; a blank page that stays blank reads as broken.
 */
export function DelayedSkeleton({ rows = 4, rowHeight = 5, label }: DelayedSkeletonProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(true);
    }, SKELETON_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <Stack spacing={1} role="status" aria-label={label} aria-busy>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} variant="rounded" height={rowHeight * 8} />
      ))}
    </Stack>
  );
}
