import { type CategoryPayload, type TransactionPayload } from '@household-budget/core';
import AddRounded from '@mui/icons-material/AddRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Card from '@mui/material/Card';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { applyRules, createCategory, createRule } from '../api/client';
import { monthsOf, uncategorizedRows } from '../filter';
import { formatBookingDate } from '../format';
import { useHousehold } from '../household/context';
import { useCategorize } from '../household/useCategorize';
import { categoryHint, inboxRows, proposeRule } from '../inbox';
import { describeFailure } from '../locales/sentences';
import { TopBar } from '../shell/TopBar';
import { useMonth } from '../shell/useMonth';
import { useShortcuts } from '../shell/useShortcuts';
import { MONO } from '../theme';
import { AmountText } from '../ui/AmountText';
import { CategoryMenu } from '../ui/CategoryMenu';
import { CategoryDot } from '../ui/CategoryPill';
import { DelayedSkeleton } from '../ui/DelayedSkeleton';
import { EmptyState } from '../ui/EmptyState';
import { KeyHint } from '../ui/KeyHint';
import { type RuleCondition } from '../ui/RuleSentence';
import { RuleProposal } from './inbox/RuleProposal';

/** How many categories get a number key; the rest are one `M` away. */
const ON_KEYS = 9;
/** How many upcoming rows the queue shows. */
const QUEUE = 7;

interface Proposal {
  /** Remounts the editor for each new proposal. */
  readonly key: number;
  readonly rule: RuleCondition;
}

/**
 * `/inbox` — Sortieren (plan 08, phase 3): the rows without a category, one at a time,
 * sorted with number keys, and after each one the rule that would have sorted it.
 *
 * What it lists is what „Ohne Kategorie“ counts everywhere (`uncategorizedRows`): booked
 * rows, across every account. A row sorted here leaves the list at once — it no longer
 * matches — so "the current row" is simply the first one not skipped.
 */
export function InboxPage() {
  const { t } = useTranslation();
  const household = useHousehold();
  const { transactions, categories, rules, accounts, reload, setCategories } = household;
  const [error, setError] = useState<{ readonly cause: unknown } | undefined>(undefined);
  const fail = useCallback((cause: unknown) => {
    setError({ cause });
  }, []);
  const { changeCategory, savingIds } = useCategorize(fail);

  const months = useMemo(() => monthsOf(uncategorizedRows(transactions ?? [])), [transactions]);
  const monthState = useMonth(months, { defaultTo: 'all' });
  const { month } = monthState;
  const rows = useMemo(() => inboxRows(transactions ?? [], month), [transactions, month]);

  // Rows passed over with `S` or `J`, for this visit only; they come back next time.
  const [skipped, setSkipped] = useState<readonly string[]>([]);
  // Sorted in this visit, newest last — what `Z` takes back, and what the progress counts.
  const [sorted, setSorted] = useState<readonly string[]>([]);
  const [proposal, setProposal] = useState<Proposal | undefined>(undefined);
  const proposalSeq = useRef(0);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const moreButton = useRef<HTMLButtonElement>(null);

  const open = rows.filter((row) => !skipped.includes(row.id));
  const current = open[0] ?? rows.find((row) => skipped.includes(row.id));
  const queue = rows.filter((row) => row.id !== current?.id).slice(0, QUEUE);
  const hint = current === undefined ? undefined : categoryHint(current, transactions ?? []);
  const keyed = categories.slice(0, ON_KEYS);
  const total = rows.length + sorted.length;

  function assign(row: TransactionPayload, categoryId: string): void {
    setSorted((done) => [...done, row.id]);
    proposalSeq.current += 1;
    setProposal({ key: proposalSeq.current, rule: proposeRule(row, categoryId) });
    void changeCategory(row.id, categoryId);
  }

  function assignNew(row: TransactionPayload, name: string): void {
    createCategory(name)
      .then((created: CategoryPayload) => {
        setCategories((current) =>
          [...current, created].sort((a, b) => a.name.localeCompare(b.name)),
        );
        assign(row, created.id);
      })
      .catch(fail);
  }

  function undo(): void {
    const last = sorted[sorted.length - 1];
    if (last === undefined) {
      return;
    }
    setSorted((done) => done.slice(0, -1));
    setProposal(undefined);
    void changeCategory(last, null);
  }

  function skip(): void {
    if (current !== undefined) {
      setSkipped((ids) => [...ids.filter((id) => id !== current.id), current.id]);
    }
  }

  async function createAndApply(rule: RuleCondition): Promise<void> {
    try {
      await createRule({ ...rule, active: true });
      await applyRules();
      setProposal(undefined);
      // The run sorted rows on every account; the household loads what it wrote.
      reload();
    } catch (cause) {
      fail(cause);
    }
  }

  const menuOpen = menuAnchor !== null;
  useShortcuts(
    {
      ...Object.fromEntries(
        keyed.map((category, index) => [
          String(index + 1),
          () => {
            if (current !== undefined) {
              assign(current, category.id);
            }
          },
        ]),
      ),
      m: () => {
        setMenuAnchor(moreButton.current);
      },
      n: () => {
        setMenuAnchor(moreButton.current);
      },
      s: skip,
      j: skip,
      k: () => {
        setSkipped((ids) => ids.slice(0, -1));
      },
      z: undo,
    },
    !menuOpen && current !== undefined,
  );

  const accountName = (row: TransactionPayload) =>
    accounts?.find((account) => rowsOfAccount(household.rowsByAccount, account.id, row.id))?.name ??
    '';

  return (
    <Stack spacing={3}>
      <TopBar
        title={t('common.pages.inbox')}
        subtitle={t('inbox.subtitle', { count: rows.length })}
        month={
          months.length > 0 ? { state: monthState, available: months, allowAll: true } : undefined
        }
      />

      {household.error !== undefined && (
        <Alert severity="error">{describeFailure(t, household.error.cause)}</Alert>
      )}
      {error !== undefined && <Alert severity="error">{describeFailure(t, error.cause)}</Alert>}

      {transactions === undefined ? (
        <DelayedSkeleton rows={3} rowHeight={12} label={t('common.loading')} />
      ) : current === undefined ? (
        <Stack spacing={2}>
          <EmptyState
            message={t('inbox.allDone')}
            action={
              <Button size="small" component={Link} to="/">
                {t('inbox.toOverview')}
              </Button>
            }
          />
          {proposal !== undefined && (
            <RuleProposal
              key={proposal.key}
              initial={proposal.rule}
              transactions={transactions}
              rules={rules}
              categories={categories}
              onCreate={createAndApply}
              onDismiss={() => {
                setProposal(undefined);
              }}
            />
          )}
        </Stack>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 320px' },
            gap: 2.5,
            alignItems: 'start',
          }}
        >
          <Stack spacing={2.5} sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1.75} sx={{ alignItems: 'center' }}>
              <LinearProgress
                variant="determinate"
                value={total === 0 ? 0 : (sorted.length / total) * 100}
                aria-label={t('inbox.progress', { done: sorted.length, total })}
                sx={{ flexGrow: 1, height: 6, borderRadius: 999 }}
              />
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                {t('inbox.progress', { done: sorted.length, total })}
              </Typography>
            </Stack>

            <Card component="article" aria-label={current.counterpartyName ?? '—'}>
              <Stack spacing={3} sx={{ p: { xs: 2.5, md: 4 } }}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={2}
                  sx={{ alignItems: { sm: 'flex-start' } }}
                >
                  <Stack spacing={0.75} sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="body2" color="text.secondary">
                      {t('inbox.when', {
                        date: formatBookingDate(current.bookingDate),
                        account: accountName(current),
                      })}
                    </Typography>
                    <Typography variant="h2" component="h2" sx={{ fontSize: '1.375rem' }}>
                      {current.counterpartyName ?? '—'}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ fontFamily: MONO, overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}
                    >
                      {current.purpose ?? '—'}
                    </Typography>
                  </Stack>
                  <Typography variant="display" component="p" sx={{ fontSize: '2.5rem' }}>
                    <AmountText cents={current.amountCents} tone="auto" />
                  </Typography>
                </Stack>

                <Box
                  role="group"
                  aria-label={t('inbox.chooseCategory')}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: 'repeat(2, minmax(0, 1fr))',
                      md: 'repeat(3, minmax(0, 1fr))',
                    },
                    gap: 1.25,
                  }}
                >
                  {keyed.map((category, index) => (
                    <CategoryButton
                      key={category.id}
                      category={category}
                      keyLabel={String(index + 1)}
                      suggested={category.id === hint}
                      disabled={savingIds.has(current.id)}
                      onClick={() => {
                        assign(current, category.id);
                      }}
                    />
                  ))}
                  <Button
                    ref={moreButton}
                    variant="outlined"
                    startIcon={<AddRounded />}
                    endIcon={<KeyHint keys="M" />}
                    aria-haspopup="menu"
                    onClick={(event) => {
                      setMenuAnchor(event.currentTarget);
                    }}
                    sx={{ height: 52, justifyContent: 'flex-start' }}
                  >
                    {categories.length > ON_KEYS ? t('inbox.more') : t('inbox.newCategory')}
                  </Button>
                  <Button
                    color="inherit"
                    endIcon={<KeyHint keys="S" />}
                    onClick={skip}
                    sx={{ height: 52, justifyContent: 'flex-start', color: 'text.secondary' }}
                  >
                    {t('inbox.skip')}
                  </Button>
                </Box>
                <CategoryMenu
                  anchorEl={menuAnchor}
                  onClose={() => {
                    setMenuAnchor(null);
                  }}
                  categories={categories}
                  currentId={null}
                  onPick={(categoryId) => {
                    if (categoryId !== null) {
                      assign(current, categoryId);
                    }
                  }}
                  onCreate={(name) => {
                    assignNew(current, name);
                  }}
                />
              </Stack>
            </Card>

            {proposal !== undefined && (
              <RuleProposal
                key={proposal.key}
                initial={proposal.rule}
                transactions={transactions}
                rules={rules}
                categories={categories}
                onCreate={createAndApply}
                onDismiss={() => {
                  setProposal(undefined);
                }}
              />
            )}
          </Stack>

          <Stack spacing={2.5} sx={{ minWidth: 0 }}>
            <Card>
              <Stack
                direction="row"
                sx={{ justifyContent: 'space-between', alignItems: 'center', px: 2.5, py: 2 }}
              >
                <Typography variant="h2" component="h2">
                  {t('inbox.next')}
                </Typography>
                <Stack direction="row" spacing={0.5}>
                  <KeyHint keys="J" />
                  <KeyHint keys="K" />
                </Stack>
              </Stack>
              <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {queue.map((row) => (
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
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Typography variant="body1" sx={{ fontWeight: 500 }} noWrap>
                        {row.counterpartyName ?? '—'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" component="div" noWrap>
                        {row.purpose ?? '—'}
                      </Typography>
                    </Box>
                    <AmountText cents={row.amountCents} tone="auto" />
                  </Stack>
                ))}
              </Box>
              {sorted.length > 0 && (
                <Box sx={{ px: 2.5, py: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                  <Button size="small" endIcon={<KeyHint keys="Z" />} onClick={undo}>
                    {t('inbox.undo')}
                  </Button>
                </Box>
              )}
            </Card>
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

function rowsOfAccount(
  rowsByAccount: ReadonlyMap<string, readonly TransactionPayload[]>,
  accountId: string,
  rowId: string,
): boolean {
  return (rowsByAccount.get(accountId) ?? []).some((row) => row.id === rowId);
}

function CategoryButton({
  category,
  keyLabel,
  suggested,
  disabled,
  onClick,
}: {
  readonly category: CategoryPayload;
  readonly keyLabel: string;
  readonly suggested: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ButtonBase
      onClick={onClick}
      disabled={disabled}
      sx={{
        height: 52,
        px: 1.75,
        gap: 1.25,
        justifyContent: 'flex-start',
        borderRadius: 2,
        border: '1px solid',
        borderColor: suggested ? 'primary.main' : 'divider',
        backgroundColor: suggested ? 'primary.soft' : 'background.paper',
        typography: 'body1',
        fontWeight: 500,
        '&:hover': { backgroundColor: suggested ? 'primary.soft' : 'background.subtle' },
      }}
    >
      <KeyHint keys={keyLabel} />
      <CategoryDot colorIndex={category.colorIndex} size={10} />
      <Box component="span" sx={{ flexGrow: 1, textAlign: 'left', minWidth: 0 }}>
        {category.name}
      </Box>
      {suggested && (
        <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600 }}>
          {t('inbox.suggestion')}
        </Typography>
      )}
    </ButtonBase>
  );
}
