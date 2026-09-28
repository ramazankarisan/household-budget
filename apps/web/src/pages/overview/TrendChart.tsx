import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { BarChart } from '@mui/x-charts/BarChart';
import { ChartsReferenceLine } from '@mui/x-charts/ChartsReferenceLine';
import { useTranslation } from 'react-i18next';

import { formatAmount } from '../../format';
import { toLocale } from '../../locales/messages';
import { type MonthTotal } from '../../trend';

interface TrendChartProps {
  /** Oldest first; the last one is the month the page shows. */
  readonly totals: readonly MonthTotal[];
  /** The shown month's summed limits, drawn as a line; `null` draws none. */
  readonly limitCents: number | null;
  /** Explicit only in tests: jsdom has no layout, so a chart cannot measure itself there. */
  readonly width?: number;
  readonly height?: number;
}

const SHORT_MONTH = {
  de: new Intl.DateTimeFormat('de-DE', { month: 'short' }),
  en: new Intl.DateTimeFormat('en-GB', { month: 'short' }),
};

function shortMonth(month: string, locale: 'de' | 'en'): string {
  const [year, monthOfYear] = month.split('-').map(Number);
  return SHORT_MONTH[locale].format(new Date(year ?? 1970, (monthOfYear ?? 1) - 1, 1));
}

/**
 * Change over months (DESIGN.md §6): one column per month, the shown one in the primary
 * colour, and the month's limit as a line rather than as a second bar — a line reads as
 * "the mark", a grey bar read as "disabled". Sizes itself to its card; a chart that
 * scrolls sideways is a bug.
 */
export function TrendChart({ totals, limitCents, width, height = 190 }: TrendChartProps) {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.resolvedLanguage);
  if (totals.length === 0) {
    return null;
  }
  const withData = totals.filter((total) => total.bookedCents > 0);
  const average =
    withData.length === 0
      ? 0
      : Math.round(withData.reduce((sum, total) => sum + total.bookedCents, 0) / withData.length);
  const months = totals.map((total) => total.month);
  const shown = months[months.length - 1];
  const soft = theme.palette.primary.soft ?? theme.palette.action.selected;

  return (
    <Card>
      <Box component="figure" aria-label={t('overview.trend')} sx={{ m: 0, p: { xs: 2, md: 2.5 } }}>
        <Stack
          component="figcaption"
          direction="row"
          sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}
        >
          <Typography variant="h2" component="span">
            {t('overview.trend')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('overview.average', { amount: formatAmount(average) })}
          </Typography>
        </Stack>
        <Box sx={{ width: '100%', height }}>
          <BarChart
            {...(width === undefined ? {} : { width })}
            height={height}
            skipAnimation
            hideLegend
            borderRadius={4}
            margin={{ left: 0, right: 8, top: 16, bottom: 0 }}
            xAxis={[
              {
                scaleType: 'band',
                data: months,
                valueFormatter: (month: string) => shortMonth(month, locale),
                colorMap: {
                  type: 'ordinal',
                  values: months,
                  colors: months.map((month) =>
                    month === shown ? theme.palette.primary.main : soft,
                  ),
                },
              },
            ]}
            yAxis={[{ position: 'none', min: 0 }]}
            series={[
              {
                id: 'booked',
                label: t('overview.legendBooked'),
                data: totals.map((total) => total.bookedCents),
                valueFormatter: (value: number | null) =>
                  value === null ? '' : formatAmount(value),
              },
            ]}
          >
            {limitCents === null ? null : (
              <ChartsReferenceLine
                y={limitCents}
                label={t('overview.limitLine', { amount: formatAmount(limitCents) })}
                labelAlign="start"
                lineStyle={{ strokeDasharray: '4 4', stroke: theme.palette.text.primary }}
                labelStyle={{
                  fontSize: theme.typography.caption.fontSize,
                  fill: theme.palette.text.secondary,
                }}
              />
            )}
          </BarChart>
        </Box>
      </Box>
    </Card>
  );
}
