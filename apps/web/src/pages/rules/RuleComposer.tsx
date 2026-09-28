import {
  type CategoryPayload,
  parseRuleInput,
  type RuleInputError,
  type RulePayload,
  type TransactionPayload,
} from '@household-budget/core';
import AddRounded from '@mui/icons-material/AddRounded';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { createRule } from '../../api/client';
import { previewRule } from '../../rulePreview';
import { describeRulePreview, describeRuleErrors } from '../../locales/sentences';
import { type RuleCondition, RuleSentenceEditor } from '../../ui/RuleSentence';
import { ruleErrorsOf } from './ruleErrors';

interface RuleComposerProps {
  readonly categories: readonly CategoryPayload[];
  readonly rules: readonly RulePayload[];
  readonly transactions: readonly TransactionPayload[];
  readonly onCreated: () => void;
  readonly onError: (cause: unknown) => void;
}

/**
 * A new rule, written as the sentence it will be read as, with what it would reach
 * counted while it is typed. No priority to type: it is appended (plan 08, decision 8),
 * and the preview says which place that is.
 */
export function RuleComposer({
  categories,
  rules,
  transactions,
  onCreated,
  onError,
}: RuleComposerProps) {
  const { t } = useTranslation();
  const first = categories[0]?.id ?? '';
  const [draft, setDraft] = useState<RuleCondition>({
    field: 'counterpartyName',
    operator: 'contains',
    value: '',
    categoryId: first,
  });
  // Core's errors, not their sentences; worded at render.
  const [errors, setErrors] = useState<readonly RuleInputError[]>([]);
  // A category deleted while it was chosen, or none chosen before the list arrived.
  const current = categories.some((category) => category.id === draft.categoryId)
    ? draft
    : { ...draft, categoryId: first };
  const preview = previewRule(current, transactions, rules);

  function submit(): void {
    // The parser the API runs, so the common mistake never leaves the browser.
    const parsed = parseRuleInput({ ...current, active: true });
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors([]);
    const { priority: _default, ...appended } = parsed.rule;
    createRule(appended)
      .then(() => {
        setDraft({ ...current, value: '' });
        onCreated();
      })
      .catch((cause: unknown) => {
        const refused = ruleErrorsOf(cause);
        if (refused.length > 0) {
          setErrors(refused);
          return;
        }
        onError(cause);
      });
  }

  return (
    <Card component="section" aria-label={t('rules.newRule')}>
      <Stack
        component="form"
        spacing={1.75}
        sx={{ p: { xs: 2, md: 2.5 } }}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Typography variant="h2" component="h2">
          {t('rules.newRule')}
        </Typography>
        {categories.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('rules.noCategories')}
          </Typography>
        ) : (
          <>
            <RuleSentenceEditor
              rule={current}
              categories={categories}
              onChange={setDraft}
              marks={describeRuleErrors(t, errors)}
            />
            <Typography variant="body2" color="text.secondary" role="status">
              {describeRulePreview(t, preview)} ·{' '}
              {t('rules.willBeRule', { position: rules.length + 1 })}
            </Typography>
          </>
        )}
        <Button
          type="submit"
          variant="contained"
          startIcon={<AddRounded />}
          disabled={categories.length === 0}
          sx={{ alignSelf: 'flex-start' }}
        >
          {t('rules.addRule')}
        </Button>
      </Stack>
    </Card>
  );
}
