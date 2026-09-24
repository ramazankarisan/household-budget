import {
  type AccountPayload,
  type CategoryPayload,
  type TransactionPayload,
} from '@household-budget/core';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import {
  createAccount,
  listAccounts,
  listCategories,
  listTransactions,
  setTransactionCategory,
} from '../api/client';
import {
  filterTransactions,
  hasFilters,
  listEntryOf,
  monthsOf,
  NO_FILTERS,
  searchableOf,
  type TransactionFilterState,
  uncategorizedCount,
} from '../filter';
import { describeFailure } from '../locales/sentences';
import { AccountSelect } from './AccountSelect';
import { AppHeader } from './AppHeader';
import { ImportPanel } from './ImportPanel';
import { TransactionFilters } from './TransactionFilters';
import { TransactionList } from './TransactionList';

export function AccountPage() {
  const { t } = useTranslation();
  // Read once, on mount: another page may have sent the user here already narrowed. A
  // later change of filter is the user's, and must not be overridden by where they came
  // from.
  const location = useLocation();
  const [entry] = useState(() => listEntryOf(location.state));

  const [accounts, setAccounts] = useState<AccountPayload[] | undefined>(undefined);
  const [accountId, setAccountId] = useState<string>(entry?.accountId ?? '');
  const [transactions, setTransactions] = useState<readonly TransactionPayload[]>([]);
  const [categories, setCategories] = useState<readonly CategoryPayload[]>([]);
  const [filters, setFilters] = useState<TransactionFilterState>(
    entry === undefined
      ? NO_FILTERS
      : { ...NO_FILTERS, month: entry.month, categoryId: entry.categoryId },
  );
  // The cause, not its sentence: worded at render by `describeFailure`, so an alert already
  // on screen follows a language switch rather than staying in the old language.
  const [error, setError] = useState<{ readonly cause: unknown } | undefined>(undefined);

  const fail = useCallback((cause: unknown) => {
    setError({ cause });
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    listAccounts(controller.signal)
      .then((loaded) => {
        setAccounts(loaded);
        setAccountId((current) => (current === '' ? (loaded[0]?.id ?? '') : current));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          fail(cause);
        }
      });

    return () => {
      controller.abort();
    };
  }, [fail]);

  useEffect(() => {
    const controller = new AbortController();

    listCategories(controller.signal)
      .then(setCategories)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          fail(cause);
        }
      });

    return () => {
      controller.abort();
    };
  }, [fail]);

  // The load in flight, so switching accounts twice in a row cannot land the first
  // account's rows under the third one's name: the older request is aborted, and a
  // response that arrives anyway is dropped.
  const inFlight = useRef<AbortController | undefined>(undefined);

  const refreshTransactions = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = undefined;
    if (accountId === '') {
      return;
    }

    const controller = new AbortController();
    inFlight.current = controller;

    listTransactions(accountId, controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) {
          setTransactions(loaded);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          fail(cause);
        }
      });
  }, [accountId, fail]);

  useEffect(() => {
    refreshTransactions();
    return () => {
      inFlight.current?.abort();
    };
  }, [refreshTransactions]);

  // The rows whose own change is in flight, and which change that is. The set disables the
  // cell so a second pick cannot be made while the first is unanswered; the counter is
  // what makes that safe rather than merely likely — a response the user has already
  // superseded is dropped instead of overwriting the newer one, the same guard
  // `refreshTransactions` applies to the list as a whole.
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(() => new Set());
  const changeSeq = useRef(new Map<string, number>());

  /**
   * Written through the API and then replaced in place, rather than reloading the list:
   * the server decides the lock timestamp, and re-fetching every row to learn one row's
   * new state would scroll the table out from under the click.
   */
  function changeCategory(transactionId: string, categoryId: string | null): void {
    const seq = (changeSeq.current.get(transactionId) ?? 0) + 1;
    changeSeq.current.set(transactionId, seq);
    setSavingIds((current) => new Set(current).add(transactionId));

    const current = () => changeSeq.current.get(transactionId) === seq;

    setTransactionCategory(transactionId, categoryId)
      .then((updated) => {
        if (current()) {
          setTransactions((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
        }
      })
      .catch((cause: unknown) => {
        if (current()) {
          fail(cause);
        }
      })
      .finally(() => {
        if (!current()) {
          return;
        }
        setSavingIds((ids) => {
          const next = new Set(ids);
          next.delete(transactionId);
          return next;
        });
      });
  }

  // Derived during render, from the one array the loader owns. Nothing here is a second
  // copy of the rows, which is what lets `changeCategory`'s in-place replacement drop a
  // row out of an active filter the moment it stops matching.
  const months = useMemo(() => monthsOf(transactions), [transactions]);
  // Normalized per loaded list rather than per keystroke — which is the comparison that
  // matters, since typing is the frequent event. Setting a category by hand rebuilds it
  // too, because `changeCategory` replaces the array: ~2 ms for an eight-year history,
  // once per click, and cheaper than a per-id cache that would need invalidating on
  // exactly that event anyway.
  const searchable = useMemo(() => searchableOf(transactions), [transactions]);
  const visible = useMemo(() => filterTransactions(searchable, filters), [searchable, filters]);
  // The whole account, not the view: the number answers "how much is left to do".
  const uncategorized = useMemo(() => uncategorizedCount(transactions), [transactions]);
  const filtering = hasFilters(filters);

  async function addAccount(iban: string, name: string): Promise<void> {
    const created = await createAccount(iban, name);
    setAccounts((current) => [...(current ?? []), created]);
    setAccountId(created.id);
  }

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <AppHeader />

        {/* A row of its own under the shared header; the Box keeps the select at its own
            width instead of stretching across the column. */}
        {accounts !== undefined && accounts.length > 0 && (
          <Box>
            <AccountSelect
              accounts={accounts}
              value={accountId}
              onChange={(nextAccountId) => {
                // Cleared here rather than in the effect that reloads them: showing the
                // previous account's rows under the new account's name is worse than
                // showing none for a moment.
                setTransactions([]);
                // A month or a category chosen for one account means nothing for the
                // next: `September 2025` against a history ending in 2023 shows an empty
                // table, which reads as a bug rather than as a filter.
                setFilters(NO_FILTERS);
                setAccountId(nextAccountId);
              }}
            />
          </Box>
        )}

        {error !== undefined && <Alert severity="error">{describeFailure(t, error.cause)}</Alert>}

        {accounts === undefined && <CircularProgress size={24} />}

        {accounts?.length === 0 && <NewAccountForm onCreate={addAccount} onError={fail} />}

        {accountId !== '' && (
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={3}>
                <Typography variant="h6" component="h2">
                  {t('common.import.title')}
                </Typography>
                <ImportPanel accountId={accountId} onImported={refreshTransactions} />
                <Divider />
                {transactions.length > 0 && (
                  <TransactionFilters
                    filters={filters}
                    months={months}
                    categories={categories}
                    uncategorized={uncategorized}
                    onChange={setFilters}
                  />
                )}
                <TransactionList
                  transactions={visible}
                  categories={categories}
                  onCategoryChange={changeCategory}
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
    </Container>
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
