import {
  type CategoryPayload,
  type CategoryReport,
  type MonthlyReport,
} from '@household-budget/core';
import EditRounded from '@mui/icons-material/EditRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { formatAmount } from '../../format';
import { describeBudgetBar, describeRemaining } from '../../locales/sentences';
import { budgetTone } from '../../trend';
import { AmountText } from '../../ui/AmountText';
import { BudgetBar } from '../../ui/BudgetBar';
import { CategoryDot } from '../../ui/CategoryPill';
import { StatusIcon } from '../../ui/StatusIcon';
import { BudgetField } from '../BudgetField';

interface BudgetRowsProps {
  readonly report: MonthlyReport;
  /** Names and colours. The report carries ids only. */
  readonly categories: readonly CategoryPayload[];
  /** The limits become fields; otherwise they are read. */
  readonly editing: boolean;
  readonly onToggleEditing: () => void;
  /** Category ids whose own write for this month is in flight. */
  readonly savingIds: ReadonlySet<string>;
  /** Bumped per category when its write was refused, remounting that one field. */
  readonly revisions: ReadonlyMap<string, number>;
  /** The month's limits have not arrived: the limit and what is left of it show `…`. */
  readonly limitsLoading: boolean;
  readonly onSave: (categoryId: string, amountCents: number) => void;
  readonly onClear: (categoryId: string) => void;
  /** Where the „Ohne Kategorie“ row leads. */
  readonly uncategorizedHref: string;
}

/**
 * Categories most used first; the ones without a limit after them, in the order they
 * came; the uncategorized bucket always last. Used = booked + vorgemerkt against the limit.
 */
function ordered(entries: readonly CategoryReport[]): readonly CategoryReport[] {
  const use = (entry: CategoryReport) =>
    entry.budgetCents === null || entry.budgetCents === 0
      ? -1
      : (entry.bookedCents + entry.pendingCents) / entry.budgetCents;
  const categorized = entries.filter((entry) => entry.categoryId !== null);
  const bucket = entries.filter((entry) => entry.categoryId === null);
  return [...[...categorized].sort((a, b) => use(b) - use(a)), ...bucket];
}

const ROW_GRID = {
  display: 'grid',
  gridTemplateColumns: {
    xs: 'minmax(0, 1fr) auto',
    md: '150px minmax(120px, 1fr) 170px 150px',
  },
  gridTemplateAreas: {
    xs: '"name status" "bar bar" "amount amount"',
    md: '"name bar amount status"',
  },
  alignItems: 'center',
  columnGap: 2.5,
  rowGap: 1,
  px: { xs: 2, md: 3 },
  py: 1.5,
  borderTop: '1px solid',
  borderColor: 'divider',
} as const;

/** `…` where a number depends on limits not loaded yet — never `0,00 €`, never a blank. */
function Pending({ label }: { readonly label: string }) {
  return (
    <Box component="span" aria-label={label} title={label} sx={{ color: 'text.secondary' }}>
      …
    </Box>
  );
}

/**
 * One month, one row per category: its bar against the limit, what was booked, and what is
 * left — or, in edit mode, the limit as a field (the `BudgetField` the table used, with the
 * same parser and the same write guards in the page).
 */
export function BudgetRows({
  report,
  categories,
  editing,
  onToggleEditing,
  savingIds,
  revisions,
  limitsLoading,
  onSave,
  onClear,
  uncategorizedHref,
}: BudgetRowsProps) {
  const { t } = useTranslation();
  const byId = new Map(categories.map((category) => [category.id, category]));

  return (
    <Card>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{
          alignItems: 'baseline',
          justifyContent: 'space-between',
          px: { xs: 2, md: 3 },
          py: 2,
        }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
          <Typography variant="h2" component="h2">
            {t('overview.byCategory')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('overview.sortedByUse')}
          </Typography>
        </Stack>
        <Button
          size="small"
          startIcon={editing ? undefined : <EditRounded fontSize="small" />}
          onClick={onToggleEditing}
          disabled={limitsLoading}
          sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          {editing ? t('overview.done') : t('overview.edit')}
        </Button>
      </Stack>

      <Box
        component="ul"
        aria-label={t('overview.byCategory')}
        sx={{ listStyle: 'none', m: 0, p: 0 }}
      >
        {ordered(report.categories).map((entry) => {
          if (entry.categoryId === null) {
            return (
              <Box component="li" key="uncategorized" sx={ROW_GRID}>
                <Stack
                  direction="row"
                  spacing={1.25}
                  sx={{ gridArea: 'name', alignItems: 'center' }}
                >
                  <Box
                    aria-hidden
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      border: '1.5px dashed',
                      borderColor: 'border.strong',
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="body1" color="text.secondary">
                    {t('common.uncategorized')}
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ gridArea: 'bar' }}>
                  {t('overview.uncategorizedSpend')}
                </Typography>
                <Box sx={{ gridArea: 'amount', textAlign: { md: 'right' } }}>
                  <AmountText cents={entry.bookedCents} sx={{ fontWeight: 500 }} />
                  {entry.pendingCents > 0 && <PendingLine cents={entry.pendingCents} />}
                </Box>
                <Box sx={{ gridArea: 'status', textAlign: 'right' }}>
                  <Button
                    size="small"
                    component={Link}
                    to={uncategorizedHref}
                    title={t('budgets.showUncategorized')}
                  >
                    {t('overview.showUncategorized')}
                  </Button>
                </Box>
              </Box>
            );
          }

          const category = byId.get(entry.categoryId);
          const name = category?.name ?? entry.categoryId;
          const colorIndex = category?.colorIndex ?? 0;
          const tone = budgetTone(entry);
          const remaining = describeRemaining(t, entry.remainingCents);

          return (
            <Box component="li" key={entry.categoryId} sx={ROW_GRID}>
              <Stack
                direction="row"
                spacing={1.25}
                sx={{ gridArea: 'name', alignItems: 'center', minWidth: 0 }}
              >
                <CategoryDot colorIndex={colorIndex} size={10} />
                <Typography
                  variant="body1"
                  sx={{
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {name}
                </Typography>
              </Stack>

              <Box sx={{ gridArea: 'bar' }}>
                {limitsLoading ? null : entry.budgetCents === null ? (
                  <Typography variant="caption" color="text.secondary">
                    {t('overview.noBudget')}
                  </Typography>
                ) : (
                  <BudgetBar
                    entry={entry}
                    colorIndex={colorIndex}
                    label={describeBudgetBar(t, name, entry)}
                  />
                )}
              </Box>

              <Box sx={{ gridArea: 'amount', textAlign: { md: 'right' } }}>
                <AmountText cents={entry.bookedCents} sx={{ fontWeight: 500 }} />
                <Box component="span" sx={{ color: 'text.secondary' }}>
                  {' / '}
                  {limitsLoading ? (
                    <Pending label={t('budgets.loadingLimits')} />
                  ) : entry.budgetCents === null ? (
                    '—'
                  ) : (
                    <AmountText cents={entry.budgetCents} />
                  )}
                </Box>
                {entry.pendingCents > 0 && <PendingLine cents={entry.pendingCents} />}
              </Box>

              <Box sx={{ gridArea: 'status', textAlign: 'right' }}>
                {limitsLoading ? (
                  <Pending label={t('budgets.loadingLimits')} />
                ) : editing ? (
                  <BudgetField
                    // Remounted when the stored number changes or a refused write is
                    // discarded, so the field shows what is stored rather than what was typed.
                    key={`${report.month}:${String(entry.budgetCents)}:${String(revisions.get(entry.categoryId) ?? 0)}`}
                    budgetCents={entry.budgetCents}
                    categoryName={name}
                    month={report.month}
                    categoryId={entry.categoryId}
                    disabled={savingIds.has(entry.categoryId)}
                    onSave={(amountCents) => {
                      if (entry.categoryId !== null) {
                        onSave(entry.categoryId, amountCents);
                      }
                    }}
                    onClear={() => {
                      if (entry.categoryId !== null) {
                        onClear(entry.categoryId);
                      }
                    }}
                  />
                ) : (
                  <Typography
                    component="span"
                    variant="body1"
                    sx={{
                      whiteSpace: 'nowrap',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: tone === 'over' || tone === 'near' ? 600 : 400,
                      color:
                        tone === 'over'
                          ? 'status.over.main'
                          : tone === 'near'
                            ? 'status.near.main'
                            : 'text.secondary',
                    }}
                  >
                    {tone === 'over' && <StatusIcon kind="over" sx={{ mr: 0.5 }} />}
                    {remaining}
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>

      <Stack
        direction="row"
        spacing={2.5}
        useFlexGap
        sx={{
          flexWrap: 'wrap',
          px: { xs: 2, md: 3 },
          py: 1.5,
          borderTop: '1px solid',
          borderColor: 'divider',
          color: 'text.secondary',
        }}
      >
        <Legend kind="booked" label={t('overview.legendBooked')} />
        <Legend kind="pending" label={t('overview.legendPending')} />
        <Legend kind="limit" label={t('overview.legendLimit')} />
      </Stack>
    </Card>
  );
}

function PendingLine({ cents }: { readonly cents: number }) {
  const { t } = useTranslation();
  return (
    <Typography
      variant="caption"
      component="div"
      sx={{ color: 'status.pending.main', whiteSpace: 'nowrap' }}
    >
      <StatusIcon kind="pending" /> + {formatAmount(cents)} {t('common.pending')}
    </Typography>
  );
}

function Legend({
  kind,
  label,
}: {
  readonly kind: 'booked' | 'pending' | 'limit';
  readonly label: string;
}) {
  const swatch =
    kind === 'limit'
      ? { width: 2, height: 12, backgroundColor: 'text.primary' }
      : kind === 'booked'
        ? { width: 14, height: 8, borderRadius: 1, backgroundColor: 'text.secondary' }
        : {
            width: 14,
            height: 8,
            borderRadius: 1,
            boxSizing: 'border-box',
            border: '1px solid',
            borderColor: 'text.secondary',
            backgroundImage:
              'repeating-linear-gradient(135deg, currentColor 0 2px, transparent 2px 5px)',
          };
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
      <Box aria-hidden sx={swatch} />
      <Typography variant="caption">{label}</Typography>
    </Stack>
  );
}
