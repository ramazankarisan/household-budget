import { type CategoryPayload, type TransactionPayload } from '@household-budget/core';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import InboxRounded from '@mui/icons-material/InboxRounded';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { formatMonth } from '../../format';
import { toLocale } from '../../locales/messages';
import { AmountText } from '../../ui/AmountText';
import { CategoryDot } from '../../ui/CategoryPill';

/**
 * „Ohne Kategorie: 7 · im September · 12 insgesamt“ — the work left in the chosen month first,
 * and where it leads. A finished month says so and points at the rest.
 */
export function SortCallout({
  total,
  inMonth,
  month,
  href,
}: {
  readonly total: number;
  readonly inMonth: number;
  readonly month: string;
  readonly href: string;
}) {
  const { t, i18n } = useTranslation();
  const monthName = formatMonth(month, toLocale(i18n.resolvedLanguage));

  if (total === 0) {
    return (
      <Card>
        <Typography variant="body1" color="text.secondary" sx={{ p: 2.5 }}>
          {t('overview.allSorted')}
        </Typography>
      </Card>
    );
  }

  return (
    <Card>
      <CardActionArea component={Link} to={href} sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box
            aria-hidden
            sx={{
              width: 36,
              height: 36,
              borderRadius: 2,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'status.near.soft',
              color: 'status.near.main',
              flexShrink: 0,
            }}
          >
            <InboxRounded fontSize="small" />
          </Box>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h2" component="p">
              {inMonth > 0
                ? t('overview.toSort', { count: inMonth })
                : t('overview.monthSorted', { month: monthName })}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {inMonth === 0
                ? t('overview.toSortElsewhere', { count: total })
                : total > inMonth
                  ? t('overview.toSortMonthOfTotal', { month: monthName, total })
                  : t('overview.toSortMonth', { month: monthName })}
            </Typography>
          </Box>
          <ArrowForwardRounded aria-hidden sx={{ color: 'primary.main' }} />
        </Stack>
      </CardActionArea>
    </Card>
  );
}

/** Money in, and what is left of it after the booked spending. */
export function StatTiles({
  incomeCents,
  surplusCents,
}: {
  readonly incomeCents: number;
  readonly surplusCents: number;
}) {
  const { t } = useTranslation();

  return (
    <Card sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
      <Stack spacing={0.5} sx={{ p: 2.5, borderRight: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary">
          {t('overview.income')}
        </Typography>
        <Typography variant="h2" component="p" sx={{ fontSize: '1.25rem' }}>
          <AmountText cents={incomeCents} tone="auto" />
        </Typography>
      </Stack>
      <Stack spacing={0.5} sx={{ p: 2.5 }}>
        <Typography variant="caption" color="text.secondary">
          {t('overview.surplus')}
        </Typography>
        <Typography variant="h2" component="p" sx={{ fontSize: '1.25rem' }}>
          <AmountText cents={surplusCents} tone="auto" />
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('overview.withoutPending')}
        </Typography>
      </Stack>
    </Card>
  );
}

/** The month's largest booked outflows — where most of the money went, by name. */
export function TopSpends({
  rows,
  categories,
}: {
  readonly rows: readonly TransactionPayload[];
  readonly categories: readonly CategoryPayload[];
}) {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return null;
  }
  const byId = new Map(categories.map((category) => [category.id, category]));

  return (
    <Card>
      <Typography variant="h2" component="h2" sx={{ px: 2.5, pt: 2, pb: 1 }}>
        {t('overview.topSpends')}
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {rows.map((row) => {
          const category = row.categoryId === null ? undefined : byId.get(row.categoryId);
          return (
            <Stack
              component="li"
              key={row.id}
              direction="row"
              spacing={1.5}
              sx={{
                alignItems: 'center',
                px: 2.5,
                py: 1.25,
                borderTop: '1px solid',
                borderColor: 'divider',
              }}
            >
              {category === undefined ? (
                <Box aria-hidden sx={{ width: 8, flexShrink: 0 }} />
              ) : (
                <CategoryDot colorIndex={category.colorIndex} />
              )}
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography
                  variant="body1"
                  sx={{
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.counterpartyName ?? '—'}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="div"
                  sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {category?.name ?? t('common.uncategorized')}
                </Typography>
              </Box>
              <AmountText cents={row.amountCents} sx={{ fontWeight: 500 }} />
            </Stack>
          );
        })}
      </Box>
    </Card>
  );
}
