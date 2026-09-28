import { type Theme } from '@mui/material/styles';

/**
 * A category's colour in the current scheme (DESIGN.md §2.2). Optional chaining because a
 * component rendered without the app's theme — a unit test — has no `category` palette.
 */
export function categoryColor(theme: Theme, colorIndex: number): string {
  const palette = theme.palette.category as readonly string[] | undefined;
  return palette?.[colorIndex] ?? theme.palette.text.secondary;
}
