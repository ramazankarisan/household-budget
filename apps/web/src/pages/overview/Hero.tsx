import { type MonthlyReport } from '@household-budget/core';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { formatAmount, formatMonth } from '../../format';
import { toLocale } from '../../locales/messages';
import { describeMonthTotal } from '../../locales/sentences';
import { paceOf } from '../../trend';
import { AmountText } from '../../ui/AmountText';
import { StatusIcon } from '../../ui/StatusIcon';

interface HeroProps {
  readonly report: MonthlyReport;
  readonly limitsLoading: boolean;
}

/**
 * The answer first (DESIGN.md §1): what was spent this month, against what may be.
 *
 * Booked only, exactly as `describeMonthTotal` measures it (plan 08, decision 6):
 * vorgemerkt is shown beside the number, never inside it — the next import replaces it
 * wholesale, and a headline that silently includes it can fall with no explanation.
 */
export function Hero({ report, limitsLoading }: HeroProps) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.resolvedLanguage);
  const limit = limitsLoading ? null : report.totalBudgetCents;
  const pace = paceOf(report.month);
  const bookedShare = limit === null || limit === 0 ? null : report.totalBookedCents / limit;
  const dayShare = pace === undefined ? null : pace.day / pace.days;

  return (
    <Card>
      <Stack spacing={2.5} sx={{ p: { xs: 2.5, md: 3.5 } }}>
        <Stack spacing={0.5}>
          <Typography variant="body1" color="text.secondary">
            {t('overview.spentIn', { month: formatMonth(report.month, locale) })}
          </Typography>
          <Typography variant="display" component="p">
            <AmountText cents={report.totalBookedCents} />
          </Typography>
          <Typography
            variant="body1"
            color="text.secondary"
            sx={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {describeMonthTotal(t, report, { limitsLoading })}
          </Typography>
        </Stack>

        {bookedShare !== null && (
          <Box>
            <Box
              role="img"
              aria-label={t('overview.spentShare', { percent: Math.round(bookedShare * 100) })}
              sx={{
                position: 'relative',
                height: 14,
                borderRadius: 999,
                backgroundColor: 'background.subtle',
              }}
            >
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  right: 'auto',
                  width: `${String(Math.min(bookedShare, 1) * 100)}%`,
                  borderRadius: 999,
                  backgroundColor: bookedShare > 1 ? 'status.over.main' : 'primary.main',
                }}
              />
              {dayShare !== null && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: -6,
                    bottom: -6,
                    left: `${String(dayShare * 100)}%`,
                    width: 2,
                    ml: '-1px',
                    borderRadius: 1,
                    backgroundColor: 'text.primary',
                  }}
                />
              )}
            </Box>
            <Stack
              direction="row"
              sx={{ justifyContent: 'space-between', mt: 1, color: 'text.secondary' }}
            >
              <Typography variant="caption">
                {pace === undefined ? '' : t('overview.today', { day: pace.day, days: pace.days })}
              </Typography>
              <Typography variant="caption">
                {t('overview.spentShare', { percent: Math.round(bookedShare * 100) })}
              </Typography>
            </Stack>
          </Box>
        )}

        {(report.totalPendingCents > 0 ||
          (bookedShare !== null && dayShare !== null && bookedShare > dayShare)) && (
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {bookedShare !== null && dayShare !== null && bookedShare > dayShare && (
              <Chip
                icon={<StatusIcon kind="over" />}
                label={t('overview.faster')}
                sx={{
                  backgroundColor: 'status.near.soft',
                  color: 'status.near.main',
                  '& .MuiChip-icon': { color: 'inherit' },
                }}
              />
            )}
            {report.totalPendingCents > 0 && (
              <Chip
                variant="outlined"
                icon={<StatusIcon kind="pending" />}
                label={t('overview.pendingNotCounted', {
                  amount: formatAmount(report.totalPendingCents),
                })}
                sx={{ color: 'status.pending.main', '& .MuiChip-icon': { color: 'inherit' } }}
              />
            )}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
