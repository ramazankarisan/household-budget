import {
  type CategoryPayload,
  parseRuleInput,
  type RulePayload,
  type TransactionPayload,
} from '@household-budget/core';
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatBookingDate } from '../../format';
import { previewRule } from '../../inbox';
import { describeRulePreview, describeRuleErrors } from '../../locales/sentences';
import { useShortcuts } from '../../shell/useShortcuts';
import { AmountText } from '../../ui/AmountText';
import { KeyHint } from '../../ui/KeyHint';
import { type RuleCondition, RuleSentenceEditor } from '../../ui/RuleSentence';

interface RuleProposalProps {
  /** The first guess — `proposeRule` for the row just sorted. */
  readonly initial: RuleCondition;
  readonly transactions: readonly TransactionPayload[];
  readonly rules: readonly RulePayload[];
  readonly categories: readonly CategoryPayload[];
  /** Saves the rule and runs every rule once; resolves when both are done. */
  readonly onCreate: (rule: RuleCondition) => Promise<void>;
  readonly onDismiss: () => void;
}

/**
 * „Regel daraus machen?“ — after a row is sorted by hand, the rule that would have sorted
 * it, with what it would reach counted live. The next import then sorts its kind by
 * itself; that is how the inbox gets shorter every month rather than only this one.
 */
export function RuleProposal({
  initial,
  transactions,
  rules,
  categories,
  onCreate,
  onDismiss,
}: RuleProposalProps) {
  const { t } = useTranslation();
  const [rule, setRule] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [marks, setMarks] = useState<Readonly<Record<string, string>>>({});
  const preview = previewRule(rule, transactions, rules);

  function submit(): void {
    // The parser the API runs, so a keyword the server would refuse never leaves.
    const parsed = parseRuleInput({ ...rule, active: true });
    if (!parsed.ok) {
      setMarks(describeRuleErrors(t, parsed.errors));
      return;
    }
    setMarks({});
    setSaving(true);
    void onCreate(rule).finally(() => {
      setSaving(false);
    });
  }

  // `R` saves the proposal on screen; `Esc` leaves it. Bound only while it is shown.
  useShortcuts({
    r: () => {
      if (!saving) {
        submit();
      }
    },
    Escape: onDismiss,
  });

  return (
    <Card component="section" aria-label={t('inbox.proposalTitle')}>
      <Stack spacing={2} sx={{ p: { xs: 2, md: 3 } }}>
        <Stack
          direction="row"
          spacing={1.25}
          useFlexGap
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          <AutoAwesomeRounded aria-hidden fontSize="small" sx={{ color: 'primary.main' }} />
          <Typography variant="h2" component="h2" sx={{ flexGrow: 1 }}>
            {t('inbox.proposalTitle')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('inbox.proposalHint')}
          </Typography>
        </Stack>

        <RuleSentenceEditor rule={rule} categories={categories} onChange={setRule} marks={marks} />

        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
          <Typography
            variant="caption"
            component="p"
            role="status"
            sx={{
              px: 1.75,
              py: 1,
              backgroundColor: 'background.subtle',
              borderRadius: '8px 8px 0 0',
            }}
          >
            {describeRulePreview(t, preview)}
          </Typography>
          {preview.sample.map((row) => (
            <Stack
              key={row.id}
              direction="row"
              spacing={1.75}
              sx={{
                px: 1.75,
                py: 1,
                borderTop: '1px solid',
                borderColor: 'divider',
                alignItems: 'center',
              }}
            >
              <Typography variant="body2" color="text.secondary" sx={{ width: 84, flexShrink: 0 }}>
                {formatBookingDate(row.bookingDate)}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  flexGrow: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.counterpartyName ?? '—'}
              </Typography>
              <AmountText cents={row.amountCents} tone="auto" />
            </Stack>
          ))}
        </Box>

        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            startIcon={<CheckRounded />}
            endIcon={<KeyHint keys="R" />}
            disabled={saving}
            onClick={submit}
          >
            {t('inbox.createAndApply')}
          </Button>
          <Button variant="outlined" endIcon={<KeyHint keys="Esc" />} onClick={onDismiss}>
            {t('inbox.onlyThis')}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
}
