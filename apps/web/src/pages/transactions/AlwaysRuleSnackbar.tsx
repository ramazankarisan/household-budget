import { type ApplySummary } from '@household-budget/core';
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type AlwaysRule } from '../../alwaysRule';
import { applyRules, createRule } from '../../api/client';
import { useHousehold } from '../../household/context';
import { describeApplySummary } from '../../locales/sentences';
import { previewRule } from '../../rulePreview';

/** A category just set by hand, and the rule that would set it every time. */
export interface AlwaysOffer {
  /** New for every offer: remounts the snackbar with its own six seconds. */
  readonly key: number;
  readonly rule: AlwaysRule;
}

type Step =
  | { readonly kind: 'offered' }
  // The rule exists; `uncategorized` rows without a category it would sort on a run.
  | { readonly kind: 'created'; readonly uncategorized: number }
  | { readonly kind: 'applying' }
  | { readonly kind: 'done'; readonly summary: ApplySummary };

interface AlwaysRuleSnackbarProps {
  readonly offer: AlwaysOffer;
  /** Where a refused create or run is reported: the page's inline alert. */
  readonly onError: (cause: unknown) => void;
}

/**
 * „Immer so“: after a category is set by hand on Umsätze, the save is said quietly
 * (DESIGN.md §7) with the one step that saves doing it again next month — a rule for the
 * payee. Then the same offer Regeln makes after a new rule: rules run only on import or on
 * request, so it says how many rows the rule would sort and offers the run.
 *
 * Mounted with `key={offer.key}`: a second pick replaces this one rather than queueing.
 */
export function AlwaysRuleSnackbar({ offer, onError }: AlwaysRuleSnackbarProps) {
  const { t } = useTranslation();
  const { rules, transactions, setRules, reload } = useHousehold();
  const [step, setStep] = useState<Step | undefined>({ kind: 'offered' });

  function create(): void {
    // Counted before the rule exists, as the composer counts it: what a run would sort.
    const { uncategorized } = previewRule(offer.rule, transactions ?? [], rules);
    // Gone at once, so a second click cannot create a second rule.
    setStep(undefined);
    createRule(offer.rule)
      .then((created) => {
        // Appended: it goes after every rule there is, as the API put it.
        setRules((current) => [...current, created]);
        setStep({ kind: 'created', uncategorized });
      })
      .catch(onError);
  }

  function apply(): void {
    setStep({ kind: 'applying' });
    applyRules()
      .then((summary) => {
        setStep({ kind: 'done', summary });
        // The run re-categorized rows the list is showing.
        reload();
      })
      .catch((cause: unknown) => {
        setStep(undefined);
        onError(cause);
      });
  }

  if (step === undefined) {
    return null;
  }

  let message: string;
  let action: { readonly label: string; readonly run: () => void } | undefined;
  switch (step.kind) {
    case 'offered':
      message = t('transactions.always.saved');
      action = { label: t('transactions.always.offer', { name: offer.rule.value }), run: create };
      break;
    case 'created':
      if (step.uncategorized > 0) {
        message = t('rules.applyOffer', { count: step.uncategorized });
        action = { label: t('rules.applyNow'), run: apply };
      } else {
        message = t('transactions.always.created');
      }
      break;
    case 'applying':
      message = t('rules.applying');
      break;
    case 'done':
      message = describeApplySummary(t, step.summary);
      break;
  }

  return (
    <Snackbar
      // Each step its own six seconds; a run in flight stays until it answers.
      key={step.kind}
      open
      autoHideDuration={step.kind === 'applying' ? null : 6000}
      message={message}
      onClose={(_event, reason) => {
        // A click anywhere else on the page is not a decision about the offer.
        if (reason !== 'clickaway') {
          setStep(undefined);
        }
      }}
      action={
        action === undefined ? undefined : (
          <Button color="inherit" size="small" onClick={action.run} sx={{ textAlign: 'left' }}>
            {action.label}
          </Button>
        )
      }
    />
  );
}
