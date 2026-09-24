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
import { type TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import {
  ApiError,
  clearBudget,
  listAccounts,
  listBudgets,
  listCategories,
  listTransactions,
  setBudget,
} from '../api/client';
import { type ListEntryState, monthOf, monthsOf, UNCATEGORIZED } from '../filter';
import { formatMonth } from '../format';
import { toLocale } from '../locales/messages';
import { describeBudgetErrors, describeMonthTotal } from '../locales/sentences';
import { AppHeader } from './AppHeader';
import { BudgetTable } from './BudgetTable';
import { SpendingChart } from './SpendingChart';

/**
 * A refused write in words. `BUDGET_INVALID` carries one entry per bad field, which the
 * field itself would normally have caught — this is the path for when it did not.
 */
function messageOf(t: TFunction, cause: unknown): string {
  if (cause instanceof ApiError && cause.code === 'BUDGET_INVALID') {
    const { errors } = cause.details as { errors?: readonly BudgetInputError[] };
    const sentences = Object.values(describeBudgetErrors(t, errors ?? []));
    if (sentences.length > 0) {
      return sentences.join(' · ');
    }
  }
  return cause instanceof Error ? cause.message : String(cause);
}

/** One account's rows, kept apart so the uncategorized row can say whose they are. */
interface AccountRows {
  readonly accountId: string;
  readonly rows: readonly TransactionPayload[];
}

/** A cell is one category in one month, and so is everything tracked about it. */
function cellKey(month: string, categoryId: string): string {
  return `${month}/${categoryId}`;
}

/** The part of a per-cell map that belongs to one month, keyed by category id. */
function inMonth<T>(cells: ReadonlyMap<string, T>, month: string): ReadonlyMap<string, T> {
  const prefix = `${month}/`;
  const here = new Map<string, T>();
  for (const [key, value] of cells) {
    if (key.startsWith(prefix)) {
      here.set(key.slice(prefix.length), value);
    }
  }
  return here;
}

/**
 * The third page: one month's spending per category against its limits.
 *
 * Household-wide, because a limit is: `Budget` has no account, so the spending it is
 * measured against is every account's. Measuring it against one account at a time would
 * let two cards each stay "übrig" while the household is over, and would flip a limit
 * between over and under as the selected account changed. So there is no account picker
 * here, and the month list is the union of every account's months.
 *
 * It owns the loads, the selected month and the writes; the arithmetic is
 * `monthlyReport` from `packages/core`, run over the rows loaded the same way
 * `AccountPage` loads them, once per account. A month switch re-derives the table from
 * what is already loaded, shows that month's spending at once, and fetches its limits only
 * the first time the month is shown (see `budgets`).
 */
export function BudgetsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [categories, setCategories] = useState<readonly CategoryPayload[]>([]);
  // `undefined` while the rows are on their way; `[]` means there is no account yet.
  const [loaded, setLoaded] = useState<readonly AccountRows[] | undefined>(undefined);
  // What the user picked. `''` until they pick — the page then shows the newest month.
  const [chosenMonth, setChosenMonth] = useState('');
  /*
   * The limits per month, kept for as long as the page is. A month switch shows the
   * cached month at once and fetches only a month not seen yet; writes update the entry
   * for their month. Nothing else writes limits while this page is open — it is the one
   * place they are edited — so a cached month cannot go stale under it.
   */
  const [budgets, setBudgets] = useState<ReadonlyMap<string, readonly BudgetPayload[]>>(
    () => new Map(),
  );
  // Read by the fetch effect so it can skip a cached month without depending on
  // `budgets` — which would refetch after every write. Synced in an effect, not during
  // render (react-hooks/refs); it is declared before the fetch effect, and effects run in
  // declaration order, so the fetch always sees this render's cache.
  const budgetsRef = useRef(budgets);
  useEffect(() => {
    budgetsRef.current = budgets;
  }, [budgets]);
  const [error, setError] = useState<string | undefined>(undefined);

  // The i18next instance, not `t`: it is stable, so a language switch does not hand the
  // loading effects a new `fail` and send them fetching again. The sentence is worded in
  // whatever language is current when the failure happens.
  const fail = useCallback(
    (cause: unknown) => {
      setError(messageOf(i18n.getFixedT(i18n.language), cause));
    },
    [i18n],
  );

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    listAccounts(signal)
      .then((accounts: readonly AccountPayload[]) =>
        Promise.all(
          accounts.map(async (account) => ({
            accountId: account.id,
            rows: await listTransactions(account.id, signal),
          })),
        ),
      )
      .then((perAccount) => {
        if (!signal.aborted) {
          setLoaded(perAccount);
        }
      })
      .catch((cause: unknown) => {
        if (!signal.aborted) {
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

  const transactions = useMemo(() => loaded?.flatMap((account) => account.rows), [loaded]);
  const months = useMemo(() => monthsOf(transactions ?? []), [transactions]);
  // Derived, not stored: the newest month until the user picks one. An effect that
  // copied `months[0]` into state would render the wrong month once first.
  const month =
    chosenMonth !== '' && months.includes(chosenMonth) ? chosenMonth : (months[0] ?? '');

  useEffect(() => {
    if (month === '' || budgetsRef.current.has(month)) {
      return;
    }
    const controller = new AbortController();

    listBudgets(month, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) {
          setBudgets((stored) => new Map(stored).set(month, rows));
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

  /*
   * Per cell — month and category — never per category alone: a write still in flight
   * for September must not disable the same category's August field, and a refused one
   * must reset only the field it came from, not every draft on the page.
   *
   * `writeSeq` is the guard `AccountPage.changeCategory` uses: a response the user has
   * already superseded is dropped rather than overwriting the newer one. `revisions` is
   * bumped when a write is refused, which remounts that one field with the stored number.
   */
  const [savingCells, setSavingCells] = useState<ReadonlyMap<string, true>>(() => new Map());
  const [revisions, setRevisions] = useState<ReadonlyMap<string, number>>(() => new Map());
  const writeSeq = useRef(new Map<string, number>());

  /**
   * One cell's write. The result replaces that one limit in state rather than reloading
   * the month: nothing else changed, and the server's answer is the stored value.
   */
  function write(categoryId: string, send: () => Promise<BudgetPayload | null>): void {
    const forMonth = month;
    const key = cellKey(forMonth, categoryId);
    const seq = (writeSeq.current.get(key) ?? 0) + 1;
    writeSeq.current.set(key, seq);
    const current = () => writeSeq.current.get(key) === seq;

    setError(undefined);
    setSavingCells((cells) => new Map(cells).set(key, true));

    send()
      .then((saved) => {
        if (!current()) {
          return;
        }
        setBudgets((stored) => {
          const rows = stored.get(forMonth);
          if (rows === undefined) {
            return stored;
          }
          const others = rows.filter((row) => row.categoryId !== categoryId);
          return new Map(stored).set(forMonth, saved === null ? others : [...others, saved]);
        });
      })
      .catch((cause: unknown) => {
        if (current()) {
          fail(cause);
          setRevisions((cells) => new Map(cells).set(key, (cells.get(key) ?? 0) + 1));
        }
      })
      .finally(() => {
        if (!current()) {
          return;
        }
        setSavingCells((cells) => {
          const next = new Map(cells);
          next.delete(key);
          return next;
        });
      });
  }

  const savingIds = useMemo(
    () => new Set(inMonth(savingCells, month).keys()),
    [savingCells, month],
  );
  const monthRevisions = useMemo(() => inMonth(revisions, month), [revisions, month]);

  const loadedBudgets = budgets.get(month);
  // The rows are in memory, so spending never waits; only the limits can be in flight.
  const limitsLoading = loadedBudgets === undefined;
  const report = useMemo(
    () => monthlyReport(transactions ?? [], loadedBudgets ?? [], categories, month),
    [transactions, loadedBudgets, categories, month],
  );

  /**
   * Where the uncategorized row sends the user. The list is one account at a time, so it
   * opens on the first account holding uncategorized spending this month — with a single
   * account, that account. The bucket can span several; the list's account picker is
   * the way to the rest, and the count chip there says how many each one has.
   */
  function uncategorizedAccount(): string {
    const holder = loaded?.find((account) =>
      account.rows.some(
        (row) => row.categoryId === null && row.amountCents < 0 && monthOf(row) === month,
      ),
    );
    return holder?.accountId ?? loaded?.[0]?.accountId ?? '';
  }

  const empty = transactions?.length === 0;

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <AppHeader />

        {error !== undefined && <Alert severity="error">{error}</Alert>}

        {empty ? (
          <Stack
            direction="row"
            spacing={2}
            useFlexGap
            sx={{ flexWrap: 'wrap', alignItems: 'center' }}
          >
            <Typography variant="body2" color="text.secondary">
              {t('transactions.noTransactions')}
            </Typography>
            <Button size="small" component={Link} to="/">
              {t('budgets.toTransactions')}
            </Button>
          </Stack>
        ) : transactions === undefined ? (
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
                slotProps={{ select: { 'aria-label': t('transactions.month') } }}
                value={month}
                onChange={(event) => {
                  setChosenMonth(event.target.value);
                }}
                sx={{ minWidth: 180 }}
              >
                {months.map((option) => (
                  <MenuItem key={option} value={option}>
                    {formatMonth(option, toLocale(i18n.resolvedLanguage))}
                  </MenuItem>
                ))}
              </TextField>
              <Typography variant="body1" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {describeMonthTotal(t, report, { limitsLoading })}
              </Typography>
            </Stack>

            <BudgetTable
              report={report}
              categories={categories}
              savingIds={savingIds}
              revisions={monthRevisions}
              limitsLoading={limitsLoading}
              onSave={(categoryId, amountCents) => {
                write(categoryId, () => setBudget(month, categoryId, amountCents));
              }}
              onClear={(categoryId) => {
                write(categoryId, () => clearBudget(month, categoryId).then(() => null));
              }}
              onShowUncategorized={() => {
                const state: ListEntryState = {
                  accountId: uncategorizedAccount(),
                  month,
                  categoryId: UNCATEGORIZED,
                };
                void navigate('/', { state });
              }}
            />

            {/* The same report object: the chart reads what the table reads, nothing else. */}
            <SpendingChart report={report} categories={categories} limitsLoading={limitsLoading} />
          </Stack>
        )}
      </Stack>
    </Container>
  );
}
