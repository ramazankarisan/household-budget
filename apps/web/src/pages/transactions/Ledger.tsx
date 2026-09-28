import { type CategoryPayload, type TransactionPayload } from '@household-budget/core';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatAmount } from '../../format';
import { toLocale } from '../../locales/messages';
import { AmountText } from '../../ui/AmountText';
import { CategoryMenu } from '../../ui/CategoryMenu';
import { CategoryPill } from '../../ui/CategoryPill';
import { StatusIcon } from '../../ui/StatusIcon';
import { byDay, formatDay } from './days';

interface LedgerProps {
  readonly transactions: readonly TransactionPayload[];
  readonly categories: readonly CategoryPayload[];
  /**
   * Each row's account name, by row id — given when rows of more than one account are on
   * screen, where the account is worth saying; omitted otherwise.
   */
  readonly accountNames?: ReadonlyMap<string, string> | undefined;
  /** `null` clears the category and its lock. */
  readonly onCategoryChange: (transactionId: string, categoryId: string | null) => void;
  /** Creates a category by name and gives it to the row. */
  readonly onCreateCategory: (transactionId: string, name: string) => void;
  readonly savingIds: ReadonlySet<string>;
}

/**
 * The statement, read the way a statement is (plan 08, phase 5): one group per day with
 * what went out that day, and per row the counterparty, what the bank wrote about it, its
 * category and its amount. Income is marked with its `+`; spending stays text colour.
 *
 * A vorgemerkt row is shown and marked, with its category read-only: the next import
 * replaces it wholesale, and the API refuses a category on it (`TRANSACTION_PENDING`).
 */
export function Ledger({
  transactions,
  categories,
  accountNames,
  onCategoryChange,
  onCreateCategory,
  savingIds,
}: LedgerProps) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.resolvedLanguage);
  const [menu, setMenu] = useState<
    { readonly anchor: HTMLElement; readonly row: TransactionPayload } | undefined
  >(undefined);
  const categoryOf = new Map(categories.map((category) => [category.id, category]));

  return (
    <Card>
      {byDay(transactions).map(({ day, rows }, index) => {
        const out = rows
          .filter((row) => row.amountCents < 0)
          .reduce((sum, row) => sum + row.amountCents, 0);
        return (
          <Box component="section" key={day} aria-label={formatDay(day, locale)}>
            <Stack
              direction="row"
              sx={{
                justifyContent: 'space-between',
                alignItems: 'center',
                minHeight: 40,
                px: { xs: 2, md: 3 },
                backgroundColor: 'background.subtle',
                borderTop: index === 0 ? 'none' : '1px solid',
                borderColor: 'divider',
                position: 'sticky',
                top: 0,
                zIndex: 1,
              }}
            >
              <Typography variant="h3" component="h3">
                {formatDay(day, locale)}
              </Typography>
              {out < 0 && (
                <Typography variant="caption" color="text.secondary">
                  {t('transactions.dayTotal', { amount: formatAmount(out) })}
                </Typography>
              )}
            </Stack>
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {rows.map((row) => {
                const category =
                  row.categoryId === null ? undefined : categoryOf.get(row.categoryId);
                const pending = row.status === 'pending';
                const locked = row.categoryLockedAt !== null;
                const name = row.counterpartyName ?? '—';
                const pillName = category?.name ?? t('common.uncategorized');
                const accountName = accountNames?.get(row.id);
                return (
                  <Box
                    component="li"
                    key={row.id}
                    aria-label={name}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: '36px minmax(0, 1fr) auto',
                        md: '36px minmax(0, 1fr) 190px 130px',
                      },
                      gridTemplateAreas: {
                        xs: '"avatar text amount" ". pill pill"',
                        md: '"avatar text pill amount"',
                      },
                      alignItems: 'center',
                      columnGap: 2,
                      rowGap: 0.75,
                      minHeight: 60,
                      px: { xs: 2, md: 3 },
                      py: 1,
                      borderTop: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Box
                      aria-hidden
                      sx={{
                        gridArea: 'avatar',
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'background.subtle',
                        color: 'text.secondary',
                        typography: 'body2',
                        fontWeight: 600,
                      }}
                    >
                      {initialOf(name)}
                    </Box>
                    <Box sx={{ gridArea: 'text', minWidth: 0 }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                        <Typography
                          variant="body1"
                          sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}
                        >
                          {name}
                        </Typography>
                        {pending && (
                          <Box
                            component="span"
                            sx={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 0.5,
                              px: 1,
                              height: 20,
                              borderRadius: 999,
                              border: '1px solid',
                              borderColor: 'status.pending.main',
                              color: 'status.pending.main',
                              typography: 'caption',
                              flexShrink: 0,
                            }}
                          >
                            <StatusIcon kind="pending" />
                            {t('common.pending')}
                          </Box>
                        )}
                        {locked && (
                          <StatusIcon
                            kind="locked"
                            label={t('rules.lockedHint')}
                            sx={{ color: 'text.secondary' }}
                          />
                        )}
                      </Stack>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        component="div"
                        title={row.purpose ?? undefined}
                        sx={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}
                      >
                        {row.purpose ?? '—'}
                        {accountName === undefined ? '' : ` · ${accountName}`}
                      </Typography>
                    </Box>
                    <Box sx={{ gridArea: 'pill', minWidth: 0 }}>
                      {pending ? (
                        <CategoryPill category={category ?? null} title={t('rules.pendingHint')} />
                      ) : (
                        <CategoryPill
                          category={category ?? null}
                          aria-label={t('transactions.categoryOf', { name: pillName })}
                          disabled={savingIds.has(row.id)}
                          onClick={(event) => {
                            setMenu({ anchor: event.currentTarget, row });
                          }}
                        />
                      )}
                    </Box>
                    <Box sx={{ gridArea: 'amount', textAlign: 'right' }}>
                      <AmountText cents={row.amountCents} tone="auto" sx={{ fontWeight: 500 }} />
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        );
      })}
      <CategoryMenu
        anchorEl={menu?.anchor ?? null}
        onClose={() => {
          setMenu(undefined);
        }}
        categories={categories}
        currentId={menu?.row.categoryId ?? null}
        onPick={(categoryId) => {
          if (menu !== undefined) {
            onCategoryChange(menu.row.id, categoryId);
          }
        }}
        onCreate={(name) => {
          if (menu !== undefined) {
            onCreateCategory(menu.row.id, name);
          }
        }}
      />
    </Card>
  );
}

/** The first letter of the counterparty, for the round mark beside it. */
function initialOf(name: string): string {
  return /\p{L}/u.exec(name)?.[0]?.toUpperCase() ?? '·';
}
