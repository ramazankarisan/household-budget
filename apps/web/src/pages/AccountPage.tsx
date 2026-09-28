import { type TransactionPayload } from '@household-budget/core';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { createAccount } from '../api/client';
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
import { TopBar } from '../shell/TopBar';
import { useMonth } from '../shell/useMonth';
import { DelayedSkeleton } from '../ui/DelayedSkeleton';
import { AccountSelect } from './AccountSelect';
import { ImportPanel } from './ImportPanel';
import { TransactionFilters } from './TransactionFilters';
import { TransactionList } from './TransactionList';

const EMPTY_ROWS: readonly TransactionPayload[] = [];

/** Search params another page may land on this one with. */
export const ACCOUNT_PARAM = 'a';
export const CATEGORY_PARAM = 'c';

export function AccountPage() {
  const { t } = useTranslation();
  const household = useHousehold();
  const { accounts, rowsByAccount, categories, reload, addAccount } = household;
  // Read once, on mount: another page may have sent the user here already narrowed
  // (`?a=…&c=uncategorized`). A later change of filter is the user's, and must not be
  // overridden by where they came from.
  const [params] = useSearchParams();
  const [entry] = useState(() => ({
    accountId: params.get(ACCOUNT_PARAM) ?? '',
    categoryId: params.get(CATEGORY_PARAM) ?? '',
  }));

  const [chosenAccountId, setAccountId] = useState<string>(entry.accountId);
  const [filters, setFilters] = useState<TransactionFilterState>({
    ...NO_FILTERS,
    categoryId: entry.categoryId,
  });
  // The cause, not its sentence: worded at render by `describeFailure`, so an alert already
  // on screen follows a language switch rather than staying in the old language.
  const [error, setError] = useState<{ readonly cause: unknown } | undefined>(undefined);

  const fail = useCallback((cause: unknown) => {
    setError({ cause });
  }, []);

  // The account asked for, if it exists; the first one otherwise.
  const accountId =
    accounts?.find((account) => account.id === chosenAccountId)?.id ?? accounts?.[0]?.id ?? '';
  // `[]` until this account's rows arrive — never another account's rows under its name.
  const transactions = rowsByAccount.get(accountId) ?? EMPTY_ROWS;

  const { changeCategory, savingIds } = useCategorize(fail);

  // Derived during render, from the one array the household owns. Nothing here is a
  // second copy of the rows, which is what lets a category set by hand drop a row out of
  // an active filter the moment it stops matching.
  const months = useMemo(() => monthsOf(transactions), [transactions]);
  // The URL's month. A month this account does not have falls back to all of them.
  const monthState = useMonth(months, { defaultTo: 'all' });
  const { month } = monthState;
  // Normalized per loaded list rather than per keystroke — which is the comparison that
  // matters, since typing is the frequent event.
  const searchable = useMemo(() => searchableOf(transactions), [transactions]);
  const visible = useMemo(
    () => filterTransactions(searchable, filters, month),
    [searchable, filters, month],
  );
  // The whole account, not the view: the number answers "how much is left to do".
  const uncategorized = useMemo(() => uncategorizedRows(transactions).length, [transactions]);
  const filtering = hasFilters(filters);

  async function createAndSelect(iban: string, name: string): Promise<void> {
    const created = await createAccount(iban, name);
    addAccount(created);
    setAccountId(created.id);
  }

  return (
    <Stack spacing={3}>
      <TopBar
        title={t('common.pages.transactions')}
        month={
          transactions.length > 0
            ? { state: monthState, available: months, allowAll: true }
            : undefined
        }
      />

      {/* A row of its own under the shared header; the Box keeps the select at its own
            width instead of stretching across the column. */}
      {accounts !== undefined && accounts.length > 0 && (
        <Box>
          <AccountSelect
            accounts={accounts}
            value={accountId}
            onChange={(nextAccountId) => {
              // A category chosen for one account means nothing for the next. The month
              // stays in the URL and falls back to "all" if this account lacks it.
              setFilters(NO_FILTERS);
              setAccountId(nextAccountId);
            }}
          />
        </Box>
      )}

      {household.error !== undefined && (
        <Alert severity="error">{describeFailure(t, household.error.cause)}</Alert>
      )}
      {error !== undefined && <Alert severity="error">{describeFailure(t, error.cause)}</Alert>}

      {accounts === undefined && <DelayedSkeleton label={t('common.loading')} />}

      {accounts?.length === 0 && <NewAccountForm onCreate={createAndSelect} onError={fail} />}

      {accountId !== '' && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={3}>
              <Typography variant="h6" component="h2">
                {t('common.import.title')}
              </Typography>
              <ImportPanel accountId={accountId} onImported={reload} />
              <Divider />
              {transactions.length > 0 && (
                <TransactionFilters
                  filters={filters}
                  categories={categories}
                  uncategorized={uncategorized}
                  onChange={setFilters}
                />
              )}
              <TransactionList
                transactions={visible}
                categories={categories}
                onCategoryChange={(id, categoryId) => {
                  void changeCategory(id, categoryId);
                }}
                savingIds={savingIds}
                emptyMessage={filtering ? t('transactions.noMatches') : undefined}
                onResetFilters={
                  filtering
                    ? () => {
                        setFilters(NO_FILTERS);
                      }
                    : undefined
                }
              />
            </Stack>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}

interface NewAccountFormProps {
  readonly onCreate: (iban: string, name: string) => Promise<void>;
  readonly onError: (cause: unknown) => void;
}

/** Shown only when there is no account yet: an import has to land somewhere. */
function NewAccountForm({ onCreate, onError }: NewAccountFormProps) {
  const { t } = useTranslation();
  const [iban, setIban] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          component="form"
          spacing={2}
          onSubmit={(event) => {
            event.preventDefault();
            setSaving(true);
            onCreate(iban, name)
              .catch(onError)
              .finally(() => {
                setSaving(false);
              });
          }}
        >
          <Typography variant="h6" component="h2">
            {t('common.account.create')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('common.account.createHint')}
          </Typography>
          <TextField
            label={t('common.account.iban')}
            value={iban}
            required
            onChange={(event) => {
              setIban(event.target.value);
            }}
          />
          <TextField
            label={t('common.account.name')}
            value={name}
            required
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <Button type="submit" variant="contained" disabled={saving} sx={{ alignSelf: 'start' }}>
            {t('common.account.submit')}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
