import { type CategoryPayload, type MonthlyReport } from '@household-budget/core';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { BarChart } from '@mui/x-charts/BarChart';

import { formatAmount } from '../format';
import { budgetsText } from '../i18n/budgets';
import { transactionsText } from '../i18n/transactions';

interface SpendingChartProps {
  /** The same object the table renders. The chart has no data path of its own. */
  readonly report: MonthlyReport;
  readonly categories: readonly CategoryPayload[];
  /**
   * Explicit, because a chart that measures its container cannot render before layout —
   * nor under `jsdom`, which has none. Defaults fit the page's `md` container.
   */
  readonly width?: number;
  readonly height?: number;
  /**
   * The month's limits have not arrived. The report then holds `null` for every limit,
   * which drawn as-is says "nothing is budgeted" — the claim the table's `…` exists to
   * avoid. So the Budget series is left out, the chart is dimmed and marked busy, and the
   * caption says why, until the limits land.
   */
  readonly limitsLoading?: boolean;
}

/** A bar series' value formatter: cents in, `875,07 €` out, nothing for a missing bar. */
function formatCents(value: number | null): string {
  return value === null ? '' : formatAmount(value);
}

/**
 * The month once, as bars: per category, what was spent — booked and vorgemerkt stacked
 * into one bar, so the two stay distinguishable — and the limit beside it.
 *
 * Grouped bars rather than a reference line, because a reference line is one value and
 * every category has its own. A category with neither spending nor a limit gets no bar
 * at all, and a month where that is every category renders nothing: an empty frame with
 * axes is a chart saying "no data", which the table above already says better.
 *
 * `skipAnimation` and a fixed size are what let it render without measuring anything —
 * the requirement MUI X documents for server rendering, and what makes it testable here.
 * Colours are the theme's own palette entries, so the chart follows the colour scheme
 * the rest of the page is in.
 */
export function SpendingChart({
  report,
  categories,
  width = 800,
  height = 280,
  limitsLoading = false,
}: SpendingChartProps) {
  const theme = useTheme();
  const text = budgetsText();
  const names = new Map(categories.map((category) => [category.id, category.name]));

  const shown = report.categories.filter(
    (entry) => entry.bookedCents + entry.pendingCents > 0 || entry.budgetCents !== null,
  );
  if (shown.length === 0) {
    return null;
  }

  const labels = shown.map((entry) =>
    entry.categoryId === null
      ? transactionsText().uncategorized
      : (names.get(entry.categoryId) ?? entry.categoryId),
  );

  const spent = [
    {
      id: 'booked',
      label: text.columns.booked,
      data: shown.map((entry) => entry.bookedCents),
      stack: 'ist',
      color: theme.palette.primary.main,
      valueFormatter: formatCents,
    },
    {
      id: 'pending',
      label: text.columns.pending,
      data: shown.map((entry) => entry.pendingCents),
      stack: 'ist',
      color: theme.palette.primary.light,
      valueFormatter: formatCents,
    },
  ];
  const budget = {
    id: 'budget',
    label: text.columns.budget,
    // `null`, not 0: an unbudgeted category has no Budget bar, rather than one
    // of zero height that the tooltip would report as a limit of 0,00 €.
    data: shown.map((entry) => entry.budgetCents),
    color: theme.palette.text.disabled,
    valueFormatter: formatCents,
  };

  return (
    <Box
      component="figure"
      aria-label={text.chartTitle}
      aria-busy={limitsLoading || undefined}
      sx={{ m: 0 }}
    >
      <Typography variant="subtitle1" component="figcaption">
        {text.chartTitle}
        {limitsLoading && (
          <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
            · {text.loadingLimits} …
          </Typography>
        )}
      </Typography>
      {/* Scrolls rather than squeezes on a narrow window: the size is fixed on purpose. */}
      <Box sx={{ overflowX: 'auto', opacity: limitsLoading ? 0.5 : 1 }}>
        <BarChart
          width={width}
          height={height}
          skipAnimation
          xAxis={[{ scaleType: 'band', data: labels }]}
          yAxis={[{ valueFormatter: (value: number) => formatAmount(value), width: 90 }]}
          series={limitsLoading ? spent : [...spent, budget]}
        />
      </Box>
    </Box>
  );
}
