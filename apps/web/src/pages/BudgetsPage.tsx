import {
  type AccountPayload,
  type BudgetInputError,
  type BudgetPayload,
  type CategoryPayload,
  monthlyReport,
  type TransactionPayload,
} from '@household-budget/core';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import {
  ApiError,
  clearBudget,
  listAccounts,
  listBudgets,
  listCategories,
  listTransactions,
  setBudget,
} from '../api/client';
import { type ListEntryState, monthsOf, UNCATEGORIZED } from '../filter';
import { formatMonth } from '../format';
import { budgetsText, describeBudgetErrors, describeMonthTotal } from '../i18n/budgets';
import { transactionsText } from '../i18n/transactions';
import { AccountSelect } from './AccountSelect';
import { BudgetTable } from './BudgetTable';
import { Nav } from './Nav';
import { SpendingChart } from './SpendingChart';

/** The limits loaded, and which month they are for — a load for a month left behind is not. */
interface LoadedBudgets {
  readonly month: string;
  readonly rows: readonly BudgetPayload[];
}

/**
 * A refused write in words. `BUDGET_INVALID` carries one entry per bad field, which the
 * field itself would normally have caught — this is the path for when it did not.
 */
function messageOf(cause: unknown): string {
  if (cause instanceof ApiError && cause.code === 'BUDGET_INVALID') {
    const { errors } = cause.details as { errors?: readonly BudgetInputError[] };
    const sentences = Object.values(describeBudgetErrors(errors ?? []));
    if (sentences.length > 0) {
      return sentences.join(' · ');
    }
  }
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The third page: one month's spending per category against its limits.
 *
 * It owns the loads, the selected month and the writes; the arithmetic is
 * `monthlyReport` from `packages/core`, run here over the rows the page loaded — the same
 * rows, fetched the same way, that `AccountPage` shows. A month switch re-derives the
 * table from what is already loaded and fetches only that month's limits.
 */
export function BudgetsPage() {
  const text = budgetsText();
  const listText = transactionsText();
  const navigate = useNavigate();

  const [accounts, setAccounts] = useState<AccountPayload[] | undefined>(undefined);
  const [accountId, setAccountId] = useState<string>('');
  const [categories, setCategories] = useState<readonly CategoryPayload[]>([]);
  // `undefined` while the account's rows are on their way; `[]` means none were imported.
  const [transactions, setTransactions] = useState<readonly TransactionPayload[] | undefined>(
    undefined,
  );
  // What the user picked. `''` until they pick — the page then shows the newest month.
  const [chosenMonth, setChosenMonth] = useState('');
  const [budgets, setBudgets] = useState<LoadedBudgets | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const fail = useCallback((cause: unknown) => {
    setError(messageOf(cause));
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

  /*
   * One load per account, and the previous one aborted when the account changes — the
   * guard `AccountPage` has, for its reason: switching twice in a row must not land the
   * first account's rows under the third one's name. A response that arrives anyway is
   * dropped by the `aborted` check.
   */
  useEffect(() => {
    if (accountId === '') {
      return;
    }
    const controller = new AbortController();

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

    return () => {
      controller.abort();
    };
  }, [accountId, fail]);

  const months = useMemo(() => monthsOf(transactions ?? []), [transactions]);
  // Derived, not stored: the newest month until the user picks one the account has. An
  // effect that copied `months[0]` into state would render the wrong month once first.
  const month =
    chosenMonth !== '' && months.includes(chosenMonth) ? chosenMonth : (months[0] ?? '');

  useEffect(() => {
    if (month === '') {
      return;
    }
    const controller = new AbortController();

    listBudgets(month, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) {
          setBudgets({ month, rows });
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          fail(cause);
        }
      });

    return () => {
      controller.abort();
    };
  }, [month, fail]);

  // The cells whose own write is in flight, and which write that is — the guard
  // `AccountPage.changeCategory` uses. A response the user has already superseded is
  // dropped rather than overwriting the newer one.
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(() => new Set());
  const writeSeq = useRef(new Map<string, number>());
  // Bumped when a write is refused, so the fields remount with the stored numbers.
  const [revision, setRevision] = useState(0);

  /**
   * One cell's write. The result replaces that one limit in state rather than reloading
   * the month: nothing else changed, and the server's answer is the stored value.
   */
  function write(categoryId: string, send: () => Promise<BudgetPayload | null>): void {
    const key = `${month}/${categoryId}`;
    const seq = (writeSeq.current.get(key) ?? 0) + 1;
    writeSeq.current.set(key, seq);
    const current = () => writeSeq.current.get(key) === seq;
    const forMonth = month;

    setError(undefined);
    setSavingIds((ids) => new Set(ids).add(categoryId));

    send()
      .then((saved) => {
        if (!current()) {
          return;
        }
        setBudgets((loaded) => {
          if (loaded?.month !== forMonth) {
            return loaded;
          }
          const others = loaded.rows.filter((row) => row.categoryId !== categoryId);
          return { month: forMonth, rows: saved === null ? others : [...others, saved] };
        });
      })
      .catch((cause: unknown) => {
        if (current()) {
          fail(cause);
          setRevision((value) => value + 1);
        }
      })
      .finally(() => {
        if (!current()) {
          return;
        }
        setSavingIds((ids) => {
          const next = new Set(ids);
          next.delete(categoryId);
          return next;
        });
      });
  }

  const loadedBudgets = budgets?.month === month ? budgets.rows : undefined;
  const report = useMemo(
    () => monthlyReport(transactions ?? [], loadedBudgets ?? [], categories, month),
    [transactions, loadedBudgets, categories, month],
  );

  const empty = accounts?.length === 0 || transactions?.length === 0;

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
        >
          <Stack direction="row" spacing={3} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
            <Typography variant="h4" component="h1">
              Household Budget
            </Typography>
            <Nav />
          </Stack>
          {accounts !== undefined && accounts.length > 0 && (
            <AccountSelect
              accounts={accounts}
              value={accountId}
              onChange={(nextAccountId) => {
                // Cleared rather than left for the reload to replace: the previous
                // account's spending under the new account's name is worse than a spinner.
                setTransactions(undefined);
                // A month picked for one account need not exist in the next one's history.
                setChosenMonth('');
                setAccountId(nextAccountId);
              }}
            />
          )}
        </Stack>

        {error !== undefined && <Alert severity="error">{error}</Alert>}

        {empty ? (
          <Stack
            direction="row"
            spacing={2}
            useFlexGap
            sx={{ flexWrap: 'wrap', alignItems: 'center' }}
          >
            <Typography variant="body2" color="text.secondary">
              {listText.noTransactions}
            </Typography>
            <Button size="small" component={Link} to="/">
              {text.toTransactions}
            </Button>
          </Stack>
        ) : transactions === undefined || loadedBudgets === undefined ? (
          <CircularProgress size={24} />
        ) : (
          <Stack spacing={2}>
            <Stack
              direction="row"
              spacing={2}
              useFlexGap
              sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
            >
              <TextField
                select
                size="small"
                // The dashboard always shows exactly one month, so there is no "all" entry.
                slotProps={{ select: { 'aria-label': listText.month } }}
                value={month}
                onChange={(event) => {
                  setChosenMonth(event.target.value);
                }}
                sx={{ minWidth: 180 }}
              >
                {months.map((option) => (
                  <MenuItem key={option} value={option}>
                    {formatMonth(option)}
                  </MenuItem>
                ))}
              </TextField>
              <Typography variant="body1" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {describeMonthTotal(report)}
              </Typography>
            </Stack>

            <BudgetTable
              report={report}
              categories={categories}
              savingIds={savingIds}
              revision={revision}
              onSave={(categoryId, amountCents) => {
                write(categoryId, () => setBudget(month, categoryId, amountCents));
              }}
              onClear={(categoryId) => {
                write(categoryId, () => clearBudget(month, categoryId).then(() => null));
              }}
              onShowUncategorized={() => {
                const state: ListEntryState = { accountId, month, categoryId: UNCATEGORIZED };
                void navigate('/', { state });
              }}
            />

            {/* The same report object: the chart reads what the table reads, nothing else. */}
            <SpendingChart report={report} categories={categories} />
          </Stack>
        )}
      </Stack>
    </Container>
  );
}
