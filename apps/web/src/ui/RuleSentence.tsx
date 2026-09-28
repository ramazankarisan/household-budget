import {
  type CategoryPayload,
  operatorsForField,
  RULE_FIELDS,
  type RuleField,
  type RuleOperator,
} from '@household-budget/core';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { MONO } from '../theme';
import { CategoryDot, CategoryPill } from './CategoryPill';
import { displayValue } from './displayValue';

/** The part of a rule a sentence says: everything but its place and its switch. */
export interface RuleCondition {
  readonly field: RuleField;
  readonly operator: RuleOperator;
  readonly value: string;
  readonly categoryId: string;
}

interface RuleSentenceProps {
  readonly rule: RuleCondition;
  readonly categories: readonly CategoryPayload[];
}

/**
 * A rule the way it reads (plan 08, phase 4): „Wenn Empfänger enthält ‚rewe‘ → Lebensmittel“
 * rather than five table cells. An IBAN is shown upper-case and without quotes.
 */
export function RuleSentence({ rule, categories }: RuleSentenceProps) {
  const { t } = useTranslation();
  const category = categories.find((candidate) => candidate.id === rule.categoryId);
  const iban = rule.field === 'counterpartyIban';

  return (
    <Stack
      direction="row"
      spacing={0.875}
      useFlexGap
      sx={{ alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}
    >
      <Typography component="span" color="text.secondary">
        {t('rulePreview.ruleIf')}
      </Typography>
      <Typography component="span" sx={{ fontWeight: 500 }}>
        {t(`rules.fields.${rule.field}`)}
      </Typography>
      <Typography component="span" color="text.secondary">
        {t(`rules.operators.${rule.operator}`)}
      </Typography>
      <Box
        component="span"
        sx={{
          px: 1,
          py: 0.25,
          borderRadius: 1,
          backgroundColor: 'background.subtle',
          fontFamily: MONO,
          fontSize: '0.8125rem',
          overflowWrap: 'anywhere',
        }}
      >
        {iban ? displayValue(rule) : `„${rule.value}“`}
      </Box>
      <ArrowForwardRounded aria-hidden fontSize="small" sx={{ color: 'text.disabled' }} />
      {category === undefined ? '—' : <CategoryPill category={category} />}
    </Stack>
  );
}

interface RuleSentenceEditorProps {
  readonly rule: RuleCondition;
  readonly categories: readonly CategoryPayload[];
  readonly onChange: (rule: RuleCondition) => void;
  /** Per-field messages from core's parser, keyed by field name. */
  readonly marks?: Readonly<Record<string, string>>;
  readonly autoFocusValue?: boolean;
}

/**
 * The same sentence with its parts editable. Only the operators core allows for the field
 * are offered, and switching to IBAN while „enthält“ is chosen moves to one it allows —
 * a form whose only outcome is a rejection is not offered.
 */
export function RuleSentenceEditor({
  rule,
  categories,
  onChange,
  marks = {},
  autoFocusValue = false,
}: RuleSentenceEditorProps) {
  const { t } = useTranslation();

  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}
    >
      <Typography component="span" color="text.secondary" sx={{ lineHeight: '40px' }}>
        {t('rulePreview.ruleIf')}
      </Typography>
      <TextField
        select
        size="small"
        value={rule.field}
        error={marks['field'] !== undefined}
        helperText={marks['field']}
        slotProps={{ select: { 'aria-label': t('rules.field') } }}
        onChange={(event) => {
          const field = event.target.value as RuleField;
          const allowed = operatorsForField(field);
          onChange({
            ...rule,
            field,
            operator: allowed.includes(rule.operator)
              ? rule.operator
              : (allowed[0] ?? rule.operator),
          });
        }}
      >
        {RULE_FIELDS.map((field) => (
          <MenuItem key={field} value={field}>
            {t(`rules.fields.${field}`)}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        size="small"
        value={rule.operator}
        error={marks['operator'] !== undefined}
        helperText={marks['operator']}
        slotProps={{ select: { 'aria-label': t('rules.operator') } }}
        onChange={(event) => {
          onChange({ ...rule, operator: event.target.value as RuleOperator });
        }}
      >
        {operatorsForField(rule.field).map((operator) => (
          <MenuItem key={operator} value={operator}>
            {t(`rules.operators.${operator}`)}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        size="small"
        value={rule.value}
        autoFocus={autoFocusValue}
        error={marks['value'] !== undefined}
        helperText={marks['value']}
        onChange={(event) => {
          onChange({ ...rule, value: event.target.value });
        }}
        slotProps={{
          htmlInput: {
            'aria-label': t('rules.value'),
            style: { fontFamily: MONO },
          },
        }}
        sx={{ width: 180 }}
      />
      <ArrowForwardRounded aria-hidden fontSize="small" sx={{ color: 'text.disabled', mt: 1.25 }} />
      <TextField
        select
        size="small"
        value={rule.categoryId}
        error={marks['categoryId'] !== undefined}
        helperText={marks['categoryId']}
        slotProps={{ select: { 'aria-label': t('rules.category') } }}
        onChange={(event) => {
          onChange({ ...rule, categoryId: event.target.value });
        }}
        sx={{ minWidth: 170 }}
      >
        {categories.map((category) => (
          <MenuItem key={category.id} value={category.id} sx={{ gap: 1 }}>
            <CategoryDot colorIndex={category.colorIndex} />
            {category.name}
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}
