import { type TransactionPayload } from '@household-budget/core';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { createCategory } from '../api/client';
import {
  filterTransactions,
  hasFilters,
  monthsOf,
  NO_FILTERS,
  searchableOf,
  type TransactionFilterState,
  uncategorizedRows,
} from '../filter';
import { useHousehold } from '../household/context';
import { useCategorize } from '../household/useCategorize';
import { describeFailure } from '../locales/sentences';
import { useImport } from '../shell/importContext';
import { TopBar } from '../shell/TopBar';
import { ACCOUNT_PARAM, CATEGORY_PARAM, useMonth } from '../shell/useMonth';
import { DelayedSkeleton } from '../ui/DelayedSkeleton';
import { EmptyState } from '../ui/EmptyState';
import { FilterBar } from './transactions/FilterBar';
import { Ledger } from './transactions/Ledger';

const EMPTY_ROWS: readonly TransactionPayload[] = [];

/**
 * `/transactions` — Umsätze (plan 08, phase 5): every account's rows by default, as a
 * statement is read — by day — narrowed by account, category and search, in the month the
 * top bar shows.
 *
 * Everything is derived during render from the household's one copy of the rows. Nothing
 * here is a second copy, which is what lets a category set by hand drop a row out of an
 * active filter the moment it stops matching.
 */
export function TransactionsPage() {
  const { t } = useTranslation();
  const household = useHousehold();
  const { accounts, rowsByAccount, transactions: all, categories, setCategories } = household;
  const { openImport } = useImport();
  // Read once, on mount: another page may have sent the user here already narrowed
  // (`?a=…&c=uncategorized`). A later change of filter is the user's.
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<TransactionFilterState>(() => ({
    ...NO_FILTERS,
    accountId: params.get(ACCOUNT_PARAM) ?? '',
    categoryId: params.get(CATEGORY_PARAM) ?? '',
  }));
  // The cause, not its sentence: worded at render, so it follows a language switch.
  const [error, setError] = useState<{ readonly cause: unknown } | undefined>(undefined);
  const fail = useCallback((cause: unknown) => {
    setError({ cause });
  }, []);
  const { changeCategory, savingIds } = useCategorize(fail);

  // An account that is not there (a stale link) means every account.
  const accountId = accounts?.some((account) => account.id === filters.accountId)
    ? filters.accountId
    : '';
  // One account's rows as soon as they arrive; all accounts' once all have.
  const rows =
    accountId === '' ? (all ?? EMPTY_ROWS) : (rowsByAccount.get(accountId) ?? EMPTY_ROWS);

  const months = useMemo(() => monthsOf(rows), [rows]);
  // The URL's month. A month these rows do not have falls back to all of them.
  const monthState = useMonth(months, { defaultTo: 'all' });
  const { month } = monthState;
  // Normalized per loaded list rather than per keystroke — typing is the frequent event.
  const searchable = useMemo(() => searchableOf(rows), [rows]);
  const visible = useMemo(
    () => filterTransactions(searchable, filters, month),
    [searchable, filters, month],
  );
  // The chosen accounts and month, not the view: the number answers "how much is left to
  // do" in what the user is looking at, and search or a category filter do not move it.
  const uncategorized = useMemo(() => uncategorizedRows(rows, { month }).length, [rows, month]);
  const filtering = hasFilters({ ...filters, accountId });

  // Each row's account, said on the row only while more than one account is on screen.
  const accountNames = useMemo(() => {
    if (accountId !== '' || accounts === undefined || accounts.length < 2) {
      return undefined;
    }
    const names = new Map<string, string>();
    for (const account of accounts) {
      for (const row of rowsByAccount.get(account.id) ?? []) {
        names.set(row.id, account.name);
      }
    }
    return names;
  }, [accountId, accounts, rowsByAccount]);

  function createAndAssign(transactionId: string, name: string): void {
    createCategory(name)
      .then((created) => {
        setCategories((current) =>
          [...current, created].sort((a, b) => a.name.localeCompare(b.name)),
        );
        void changeCategory(transactionId, created.id);
      })
      .catch(fail);
  }

  const loading =
    accounts === undefined ||
    (accountId === '' ? all === undefined : !rowsByAccount.has(accountId));

  return (
    <Stack spacing={3}>
      <TopBar
        title={t('common.pages.transactions')}
        month={
          rows.length > 0 ? { state: monthState, available: months, allowAll: true } : undefined
        }
      />

      {household.error !== undefined && (
        <Alert severity="error">{describeFailure(t, household.error.cause)}</Alert>
      )}
      {error !== undefined && <Alert severity="error">{describeFailure(t, error.cause)}</Alert>}

      {accounts?.length === 0 ? (
        <EmptyState
          message={t('common.accounts.none')}
          action={
            <Button
              variant="contained"
              size="small"
              onClick={() => {
                openImport({ newAccount: true });
              }}
            >
              {t('common.accounts.add')}
            </Button>
          }
        />
      ) : loading ? (
        <DelayedSkeleton rows={6} label={t('common.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState
          message={t('transactions.noTransactions')}
          action={
            <Button
              variant="contained"
              size="small"
              onClick={() => {
                openImport();
              }}
            >
              {t('common.import.title')}
            </Button>
          }
        />
      ) : (
        <Stack spacing={2}>
          <FilterBar
            filters={{ ...filters, accountId }}
            categories={categories}
            accounts={accounts ?? []}
            uncategorized={uncategorized}
            onChange={setFilters}
          />
          {visible.length === 0 ? (
            <EmptyState
              message={filtering ? t('transactions.noMatches') : t('transactions.noTransactions')}
              action={
                filtering ? (
                  <Button
                    size="small"
                    onClick={() => {
                      setFilters(NO_FILTERS);
                    }}
                  >
                    {t('transactions.resetFilters')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Ledger
              transactions={visible}
              categories={categories}
              accountNames={accountNames}
              savingIds={savingIds}
              onCategoryChange={(id, categoryId) => {
                void changeCategory(id, categoryId);
              }}
              onCreateCategory={createAndAssign}
            />
          )}
        </Stack>
      )}
    </Stack>
  );
}
