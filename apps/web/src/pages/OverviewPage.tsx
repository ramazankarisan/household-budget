import { type BudgetPayload, monthlyReport } from '@household-budget/core';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { clearBudget, listBudgets, setBudget } from '../api/client';
import { monthOf, monthsOf, uncategorizedRows } from '../filter';
import { useHousehold } from '../household/context';
import { describeFailure } from '../locales/sentences';
import { TopBar } from '../shell/TopBar';
import { MONTH_PARAM, useMonth } from '../shell/useMonth';
import { monthTotals, trailingMonths } from '../trend';
import { DelayedSkeleton } from '../ui/DelayedSkeleton';
import { EmptyState } from '../ui/EmptyState';
import { BudgetRows } from './overview/BudgetRows';
import { Hero } from './overview/Hero';
import { SortCallout, StatTiles, TopSpends } from './overview/SideCards';
import { TrendChart } from './overview/TrendChart';

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

/** How many months the trend shows, the page's month last. */
const TREND_MONTHS = 6;
/** Where the page has room for the side column (sidebar + rows + 320 px). */
const TWO_COLUMNS = '@media (min-width: 1360px)';

/** How many of the month's largest outflows are listed. */
const TOP_SPENDS = 4;

/**
 * `/` — the month, answered (plan 08, phase 2): what was spent against what may be, per
 * category, what is still unsorted, and how the month compares to the ones before.
 *
 * Household-wide, because a limit is: `Budget` has no account, so the spending it is
 * measured against is every account's. Measuring it against one account at a time would
 * let two cards each stay "übrig" while the household is over. So there is no account
 * picker here, and the month list is the union of every account's months.
 *
 * The rows come from the household; the page owns the limits and their writes. The
 * arithmetic is `monthlyReport` from `packages/core`. A month switch re-derives everything
 * from rows already in memory and fetches that month's limits only the first time it is
 * shown (see `budgets`).
 */
export function OverviewPage() {
  const { t } = useTranslation();
  const { transactions, categories, error: loadError } = useHousehold();

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
  // The cause, not its sentence: worded at render by `describeFailure`, so an alert already
  // on screen follows a language switch rather than staying in the old language.
  const [error, setError] = useState<{ readonly cause: unknown } | undefined>(undefined);
  const [editing, setEditing] = useState(false);

  const fail = useCallback((cause: unknown) => {
    setError({ cause });
  }, []);

  const months = useMemo(() => monthsOf(transactions ?? []), [transactions]);
  // The URL's month, else the newest one. Derived, not stored: an effect that copied
  // `months[0]` into state would render the wrong month once first.
  const monthState = useMonth(months, { defaultTo: 'newest' });
  const { month } = monthState;

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
   * `writeSeq` is the guard `useCategorize` uses: a response the user has already
   * superseded is dropped rather than overwriting the newer one. `revisions` is bumped when
   * a write is refused, which remounts that one field with the stored number.
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
  const totals = useMemo(
    () =>
      month === ''
        ? []
        : monthTotals(transactions ?? [], budgets, categories, trailingMonths(month, TREND_MONTHS)),
    [transactions, budgets, categories, month],
  );

  const inThisMonth = useMemo(
    () => (transactions ?? []).filter((row) => monthOf(row) === month),
    [transactions, month],
  );
  const incomeCents = inThisMonth
    .filter((row) => row.status === 'booked' && row.amountCents > 0)
    .reduce((sum, row) => sum + row.amountCents, 0);
  const topSpends = [...inThisMonth]
    .filter((row) => row.status === 'booked' && row.amountCents < 0)
    .sort((a, b) => a.amountCents - b.amountCents)
    .slice(0, TOP_SPENDS);

  const unsortedTotal = uncategorizedRows(transactions ?? []).length;
  const unsortedMonth = uncategorizedRows(transactions ?? [], { month }).length;

  // „Ohne Kategorie“ leads to the inbox, on this month: sorting them is what it is for.
  const inboxHref = `/inbox?${new URLSearchParams({ [MONTH_PARAM]: month }).toString()}`;
  // With this month done, the callout leads to what is left in the others.
  const allInboxHref = `/inbox?${new URLSearchParams({ [MONTH_PARAM]: 'all' }).toString()}`;

  const empty = transactions?.length === 0;

  return (
    <Stack spacing={3}>
      <TopBar
        title={t('common.pages.overview')}
        subtitle={t('overview.allAccounts')}
        month={
          months.length > 0 ? { state: monthState, available: months, allowAll: false } : undefined
        }
      />

      {loadError !== undefined && (
        <Alert severity="error">{describeFailure(t, loadError.cause)}</Alert>
      )}
      {error !== undefined && <Alert severity="error">{describeFailure(t, error.cause)}</Alert>}

      {empty ? (
        <EmptyState
          message={t('transactions.noTransactions')}
          action={
            <Button size="small" component={Link} to="/transactions">
              {t('budgets.toTransactions')}
            </Button>
          }
        />
      ) : transactions === undefined ? (
        <DelayedSkeleton rows={6} label={t('common.loading')} />
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
            gap: 2.5,
            alignItems: 'start',
            // A side column only once the budget rows beside it keep room for their bars:
            // below this the rows' fixed columns would squeeze the bar to nothing.
            [TWO_COLUMNS]: { gridTemplateColumns: 'minmax(0, 1fr) 320px' },
          }}
        >
          <Stack spacing={2.5} sx={{ minWidth: 0 }}>
            <Hero report={report} limitsLoading={limitsLoading} />
            <BudgetRows
              report={report}
              categories={categories}
              editing={editing}
              onToggleEditing={() => {
                setEditing((current) => !current);
              }}
              savingIds={savingIds}
              revisions={monthRevisions}
              limitsLoading={limitsLoading}
              onSave={(categoryId, amountCents) => {
                write(categoryId, () => setBudget(month, categoryId, amountCents));
              }}
              onClear={(categoryId) => {
                write(categoryId, () => clearBudget(month, categoryId).then(() => null));
              }}
              uncategorizedHref={inboxHref}
            />
          </Stack>
          <Stack spacing={2.5} sx={{ minWidth: 0 }}>
            <SortCallout
              total={unsortedTotal}
              inMonth={unsortedMonth}
              month={month}
              href={unsortedMonth > 0 ? inboxHref : allInboxHref}
            />
            <StatTiles
              incomeCents={incomeCents}
              surplusCents={incomeCents - report.totalBookedCents}
            />
            <TrendChart
              totals={totals}
              limitCents={limitsLoading ? null : report.totalBudgetCents}
            />
            <TopSpends rows={topSpends} categories={categories} />
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
