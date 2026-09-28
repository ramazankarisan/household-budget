import { type CategoryReport } from '@household-budget/core';
import Box from '@mui/material/Box';
import { type Theme } from '@mui/material/styles';

import { budgetTone } from '../trend';
import { categoryColor } from './categoryColor';

/** How far past the limit the track reaches, so an overspend still has room to show. */
const TRACK = 1.25;

interface BudgetBarProps {
  readonly entry: CategoryReport;
  readonly colorIndex: number;
  /** The bar's accessible name — the sentence that says what it shows. */
  readonly label: string;
  readonly height?: number;
}

function share(cents: number, limit: number): number {
  return Math.min(cents / limit / TRACK, 1) * 100;
}

/**
 * One category against its limit (DESIGN.md §5): booked solid in the category's colour,
 * vorgemerkt hatched after it — shown, never merged into the booked part — and a tick
 * where the limit is. Colour is never the only carrier: the row next to it says „über“,
 * and this bar's name says the numbers.
 *
 * Renders nothing for a category without a limit: a bar against nothing is a claim.
 */
export function BudgetBar({ entry, colorIndex, label, height = 10 }: BudgetBarProps) {
  const limit = entry.budgetCents;
  if (limit === null) {
    return null;
  }
  const tone = budgetTone(entry);
  // A limit of 0 has no scale; anything spent against it fills the track.
  const scale = limit === 0 ? 1 : limit;
  const booked = limit === 0 ? (entry.bookedCents > 0 ? 100 : 0) : share(entry.bookedCents, scale);
  const spent =
    limit === 0
      ? entry.bookedCents + entry.pendingCents > 0
        ? 100
        : 0
      : share(entry.bookedCents + entry.pendingCents, scale);
  const color = (theme: Theme) => categoryColor(theme, colorIndex);

  return (
    <Box
      role="img"
      aria-label={label}
      data-tone={tone}
      sx={{
        position: 'relative',
        height,
        borderRadius: 999,
        backgroundColor: 'background.subtle',
      }}
    >
      <Box
        sx={(theme) => ({
          position: 'absolute',
          inset: 0,
          right: 'auto',
          width: `${String(booked)}%`,
          borderRadius: '999px 0 0 999px',
          backgroundColor: color(theme),
        })}
      />
      {spent > booked && (
        <Box
          data-testid="pending-segment"
          sx={(theme) => ({
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${String(booked)}%`,
            width: `${String(spent - booked)}%`,
            boxSizing: 'border-box',
            border: `1px solid ${color(theme)}`,
            borderRadius: '0 999px 999px 0',
            background: `repeating-linear-gradient(135deg, ${color(theme)} 0 2px, transparent 2px 5px)`,
          })}
        />
      )}
      <Box
        sx={{
          position: 'absolute',
          top: -4,
          bottom: -4,
          left: `${String(100 / TRACK)}%`,
          width: 2,
          ml: '-1px',
          borderRadius: 1,
          backgroundColor: tone === 'over' ? 'status.over.main' : 'text.primary',
        }}
      />
    </Box>
  );
}
