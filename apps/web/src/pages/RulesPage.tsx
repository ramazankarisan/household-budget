import { type ApplySummary, type RulePayload } from '@household-budget/core';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { applyRules, deleteRule, reorderRules, restoreRule } from '../api/client';
import { useHousehold } from '../household/context';
import { describeApplySummary, describeFailure, describeRuleDeleted } from '../locales/sentences';
import { ruleWins } from '../ruleStats';
import { TopBar } from '../shell/TopBar';
import { displayValue } from '../ui/displayValue';
import { CategoryPanel, type Describe } from './rules/CategoryPanel';
import { RuleComposer } from './rules/RuleComposer';
import { RuleList } from './rules/RuleList';

type ApplyState =
  | { readonly status: 'idle' }
  | { readonly status: 'applying' }
  | { readonly status: 'done'; readonly summary: ApplySummary }
  | { readonly status: 'error'; readonly cause: unknown };

/** What the undo snackbar offers: its sentence, and the call that reverses the delete. */
interface Undoable {
  readonly key: number;
  readonly describe: Describe;
  readonly restore: () => Promise<unknown>;
}

/**
 * `/rules` (plan 08, phase 4): a new rule written as a sentence, the rules as sentences in
 * the order they are tried, and the categories they point at.
 *
 * Categories, rules and rows are the household's copy: an apply re-categorizes rows the
 * list and Überblick show, so every change here reloads it rather than a page-local one.
 */
export function RulesPage() {
  const { t } = useTranslation();
  const { categories, rules, transactions, reload, setRules, error: loadError } = useHousehold();
  // Causes and codes, not sentences, throughout this page: everything is worded at render,
  // so a message already on screen follows a language switch with the rest of the page.
  const [error, setError] = useState<{ readonly cause: unknown } | undefined>(undefined);
  const [apply, setApply] = useState<ApplyState>({ status: 'idle' });
  /*
   * The one undo on offer: the last category or rule deleted. One slot for both, so a
   * second delete of either kind replaces the first rather than stacking two snackbars.
   * `key` is new for every delete, which remounts the snackbar with its own message and a
   * fresh six seconds instead of what was left of the previous one's.
   */
  const [undoable, setUndoable] = useState<Undoable | undefined>(undefined);
  const undoSeq = useRef(0);
  const moveSeq = useRef(0);
  const offerUndo = useCallback((describe: Describe, restore: () => Promise<unknown>) => {
    undoSeq.current += 1;
    setUndoable({ key: undoSeq.current, describe, restore });
  }, []);

  const fail = useCallback((cause: unknown) => {
    setError({ cause });
  }, []);

  /*
   * Every write goes through here. Dropping the apply result is the point: "412 geprüft ·
   * 318 zugeordnet" describes a run against the rule set that existed when the button was
   * pressed, and leaving it up after a rule is edited, deleted or switched off states
   * those counts about a rule set that is gone.
   */
  const changed = useCallback(() => {
    setApply({ status: 'idle' });
    reload();
  }, [reload]);

  const wins = useMemo(() => ruleWins(rules, transactions ?? []), [rules, transactions]);
  const counts = useMemo(() => {
    const byCategory = new Map<string, number>();
    for (const row of transactions ?? []) {
      if (row.categoryId !== null) {
        byCategory.set(row.categoryId, (byCategory.get(row.categoryId) ?? 0) + 1);
      }
    }
    return byCategory;
  }, [transactions]);

  function runRules(): void {
    setApply({ status: 'applying' });
    applyRules()
      .then((summary) => {
        setApply({ status: 'done', summary });
        // The run re-categorized rows the list and Überblick are showing.
        reload();
      })
      .catch((cause: unknown) => {
        setApply({ status: 'error', cause });
      });
  }

  /**
   * A new order, shown at once and saved as one. Only the latest move's answer counts: an
   * earlier one landing late must not put its older order back on screen. On a refusal the
   * order before it goes back, and the rules are reloaded — an earlier move may or may not
   * have been saved, and another tab may have changed them (`RULE_ORDER_STALE`).
   */
  function move(ordered: readonly RulePayload[]): void {
    const before = rules;
    const seq = ++moveSeq.current;
    setRules(() => ordered);
    setApply({ status: 'idle' });
    reorderRules(ordered.map((rule) => rule.id))
      .then((saved) => {
        if (seq === moveSeq.current) {
          setRules(() => saved);
        }
      })
      .catch((cause: unknown) => {
        if (seq !== moveSeq.current) {
          return;
        }
        setRules(() => before);
        fail(cause);
        reload();
      });
  }

  function remove(rule: RulePayload): void {
    // The API answers with the rule as it stood, `createdAt` and all, so an undo puts it
    // back in the same place in the order.
    deleteRule(rule.id)
      .then((deleted) => {
        offerUndo(
          (tr) => describeRuleDeleted(tr, displayValue(rule)),
          () => restoreRule(deleted),
        );
        changed();
      })
      .catch(fail);
  }

  return (
    <>
      <Stack spacing={3}>
        <TopBar
          title={t('common.pages.rules')}
          actions={
            <Button
              variant="outlined"
              onClick={runRules}
              disabled={apply.status === 'applying'}
              startIcon={apply.status === 'applying' ? <CircularProgress size={16} /> : undefined}
            >
              {apply.status === 'applying' ? t('rules.applying') : t('rules.applyRules')}
            </Button>
          }
        />

        {loadError !== undefined && (
          <Alert severity="error">{describeFailure(t, loadError.cause)}</Alert>
        )}
        {error !== undefined && <Alert severity="error">{describeFailure(t, error.cause)}</Alert>}
        {apply.status === 'done' && (
          <Alert severity="success">{describeApplySummary(t, apply.summary)}</Alert>
        )}
        {apply.status === 'error' && (
          <Alert severity="error">{describeFailure(t, apply.cause)}</Alert>
        )}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 300px' },
            gap: 2.5,
            alignItems: 'start',
          }}
        >
          <Stack spacing={2.5} sx={{ minWidth: 0 }}>
            <RuleComposer
              categories={categories}
              rules={rules}
              transactions={transactions ?? []}
              onCreated={changed}
              onError={fail}
            />
            <RuleList
              rules={rules}
              categories={categories}
              wins={wins}
              onMove={move}
              onChanged={changed}
              onDelete={remove}
              onError={fail}
            />
          </Stack>
          <CategoryPanel
            categories={categories}
            counts={counts}
            onChanged={changed}
            onError={fail}
            onUndoable={offerUndo}
          />
        </Box>
      </Stack>

      {undoable !== undefined && (
        <Snackbar
          key={undoable.key}
          open
          autoHideDuration={6000}
          message={undoable.describe(t)}
          onClose={(_event, reason) => {
            // A click anywhere else on the page is not a decision about the undo.
            if (reason !== 'clickaway') {
              setUndoable(undefined);
            }
          }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                const { restore } = undoable;
                setUndoable(undefined);
                // A refusal (name taken again, category gone) lands in the page's alert.
                restore().then(changed).catch(fail);
              }}
            >
              {t('rules.undo')}
            </Button>
          }
        />
      )}
    </>
  );
}
