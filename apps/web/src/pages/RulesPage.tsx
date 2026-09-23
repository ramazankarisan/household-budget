import {
  type ApplySummary,
  type CategoryPayload,
  parseRuleInput,
  RULE_FIELDS,
  RULE_OPERATORS,
  type RuleField,
  type RuleInput,
  type RuleInputError,
  type RuleOperator,
  type RulePayload,
} from '@household-budget/core';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';

import {
  ApiError,
  applyRules,
  createCategory,
  createRule,
  deleteCategory,
  deleteRule,
  listCategories,
  listRules,
  updateRule,
} from '../api/client';
import { describeCategoryInUse, describeRuleErrors, rulesText } from '../i18n/rules';
import { Nav } from './Nav';

type ApplyState =
  | { readonly status: 'idle' }
  | { readonly status: 'applying' }
  | { readonly status: 'done'; readonly summary: ApplySummary }
  | { readonly status: 'error'; readonly message: string };

/** What the form holds while it is being typed: priority is a string until it parses. */
interface RuleDraft {
  readonly id?: string;
  readonly field: RuleField;
  readonly operator: RuleOperator;
  readonly value: string;
  readonly priority: string;
  readonly categoryId: string;
  readonly active: boolean;
}

const EMPTY_DRAFT: RuleDraft = {
  field: 'counterpartyName',
  operator: 'contains',
  value: '',
  priority: '100',
  categoryId: '',
  active: true,
};

/** `'10'` → `10`, and anything else through unchanged so core is the one that rejects it. */
function toBody(draft: RuleDraft): unknown {
  const priority = Number(draft.priority);
  return {
    field: draft.field,
    operator: draft.operator,
    value: draft.value,
    priority: draft.priority.trim() === '' || Number.isNaN(priority) ? draft.priority : priority,
    categoryId: draft.categoryId,
    active: draft.active,
  };
}

/** A rejection the API stated as `RULE_INVALID`, unpacked back into core's own errors. */
function ruleErrorsOf(error: unknown): readonly RuleInputError[] {
  if (!(error instanceof ApiError) || error.code !== 'RULE_INVALID') {
    return [];
  }
  const { errors } = error.details as { errors?: unknown };
  return Array.isArray(errors) ? (errors as RuleInputError[]) : [];
}

export function RulesPage() {
  const text = rulesText();
  const [categories, setCategories] = useState<readonly CategoryPayload[]>([]);
  const [rules, setRules] = useState<readonly RulePayload[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [apply, setApply] = useState<ApplyState>({ status: 'idle' });

  const fail = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);

  const reload = useCallback(
    (signal?: AbortSignal) => {
      Promise.all([listCategories(signal), listRules(signal)])
        .then(([loadedCategories, loadedRules]) => {
          if (signal?.aborted !== true) {
            setCategories(loadedCategories);
            setRules(loadedRules);
          }
        })
        .catch((cause: unknown) => {
          if (signal?.aborted !== true) {
            fail(cause);
          }
        });
    },
    [fail],
  );

  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal);
    return () => {
      controller.abort();
    };
  }, [reload]);

  function runRules(): void {
    setApply({ status: 'applying' });
    applyRules()
      .then((summary) => {
        setApply({ status: 'done', summary });
      })
      .catch((cause: unknown) => {
        setApply({
          status: 'error',
          message: cause instanceof Error ? cause.message : String(cause),
        });
      });
  }

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Stack direction="row" spacing={3} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
          <Typography variant="h4" component="h1">
            Household Budget
          </Typography>
          <Nav />
        </Stack>

        {error !== undefined && <Alert severity="error">{error}</Alert>}

        <CategoryStrip
          categories={categories}
          onChanged={() => {
            reload();
          }}
          onError={fail}
        />

        <Card variant="outlined">
          <CardContent>
            <Stack spacing={3}>
              <Stack
                direction="row"
                spacing={2}
                sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
              >
                <Typography variant="h6" component="h2">
                  {text.rulesTitle}
                </Typography>
                <Button
                  variant="contained"
                  onClick={runRules}
                  disabled={apply.status === 'applying'}
                  startIcon={
                    apply.status === 'applying' ? <CircularProgress size={16} /> : undefined
                  }
                >
                  {apply.status === 'applying' ? text.applying : text.applyRules}
                </Button>
              </Stack>

              <RuleTable
                rules={rules}
                categories={categories}
                onChanged={() => {
                  reload();
                }}
                onError={fail}
              />

              {apply.status === 'done' && <ApplyResult summary={apply.summary} />}
              {apply.status === 'error' && <Alert severity="error">{apply.message}</Alert>}
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Container>
  );
}

interface CategoryStripProps {
  readonly categories: readonly CategoryPayload[];
  readonly onChanged: () => void;
  readonly onError: (cause: unknown) => void;
}

/**
 * Categories are managed here rather than on a page of their own: a category exists to be
 * pointed at by a rule, and the two are always edited in the same sitting.
 */
function CategoryStrip({ categories, onChanged, onError }: CategoryStripProps) {
  const text = rulesText();
  const [name, setName] = useState('');
  const [refusal, setRefusal] = useState<string | undefined>(undefined);

  function add(): void {
    if (name.trim() === '') {
      return;
    }
    createCategory(name)
      .then(() => {
        setName('');
        setRefusal(undefined);
        onChanged();
      })
      .catch(onError);
  }

  function remove(categoryId: string): void {
    setRefusal(undefined);
    deleteCategory(categoryId)
      .then(onChanged)
      .catch((cause: unknown) => {
        // The counts are the answer to "why not", so they are shown rather than logged.
        if (cause instanceof ApiError && cause.code === 'CATEGORY_IN_USE') {
          const { rules, transactions } = cause.details as {
            rules?: unknown;
            transactions?: unknown;
          };
          setRefusal(
            describeCategoryInUse(
              typeof rules === 'number' ? rules : 0,
              typeof transactions === 'number' ? transactions : 0,
            ),
          );
          return;
        }
        onError(cause);
      });
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6" component="h2">
            {text.categoriesTitle}
          </Typography>

          {categories.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {text.noCategories}
            </Typography>
          ) : (
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {categories.map((category) => (
                <Chip
                  key={category.id}
                  label={category.name}
                  onDelete={() => {
                    remove(category.id);
                  }}
                  // MUI clones this and attaches its own onClick. Supplied rather than
                  // defaulted so the control that deletes has a name that says which
                  // category it deletes.
                  deleteIcon={
                    <Box
                      component="span"
                      role="button"
                      aria-label={`${text.deleteCategory}: ${category.name}`}
                      sx={{ px: 0.5, cursor: 'pointer' }}
                    >
                      ✕
                    </Box>
                  }
                />
              ))}
            </Stack>
          )}

          {refusal !== undefined && <Alert severity="warning">{refusal}</Alert>}

          <Stack
            component="form"
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center' }}
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <TextField
              size="small"
              label={text.categoryName}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <Button type="submit" variant="outlined">
              {text.addCategory}
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

interface RuleTableProps {
  readonly rules: readonly RulePayload[];
  readonly categories: readonly CategoryPayload[];
  readonly onChanged: () => void;
  readonly onError: (cause: unknown) => void;
}

function RuleTable({ rules, categories, onChanged, onError }: RuleTableProps) {
  const text = rulesText();
  const [draft, setDraft] = useState<RuleDraft | undefined>(undefined);
  const nameOf = (categoryId: string) =>
    categories.find((category) => category.id === categoryId)?.name ?? '—';

  return (
    <Stack spacing={2}>
      {rules.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {text.noRules}
        </Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{text.priority}</TableCell>
                <TableCell>{text.field}</TableCell>
                <TableCell>{text.operator}</TableCell>
                <TableCell>{text.value}</TableCell>
                <TableCell>{text.category}</TableCell>
                <TableCell align="right">{text.active}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {/* Rendered in the order the API returned, which is the order the engine
                  walks. Re-sorting here would make the table lie about what wins. */}
              {rules.map((rule) => (
                <TableRow key={rule.id} hover>
                  <TableCell>{rule.priority}</TableCell>
                  <TableCell>{text.fields[rule.field]}</TableCell>
                  <TableCell>{text.operators[rule.operator]}</TableCell>
                  <TableCell>{rule.value}</TableCell>
                  <TableCell>{nameOf(rule.categoryId)}</TableCell>
                  <TableCell align="right">
                    <Switch
                      size="small"
                      checked={rule.active}
                      slotProps={{ input: { 'aria-label': `${text.active}: ${rule.value}` } }}
                      onChange={(event) => {
                        updateRule(rule.id, { ...toRuleInput(rule), active: event.target.checked })
                          .then(onChanged)
                          .catch(onError);
                      }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                      <Button
                        size="small"
                        onClick={() => {
                          setDraft({ ...rule, priority: String(rule.priority) });
                        }}
                      >
                        {text.editRule}
                      </Button>
                      <IconButton
                        size="small"
                        aria-label={`${text.deleteRule}: ${rule.value}`}
                        onClick={() => {
                          deleteRule(rule.id).then(onChanged).catch(onError);
                        }}
                      >
                        ✕
                      </IconButton>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {draft === undefined ? (
        <Button
          variant="outlined"
          sx={{ alignSelf: 'start' }}
          disabled={categories.length === 0}
          onClick={() => {
            setDraft({ ...EMPTY_DRAFT, categoryId: categories[0]?.id ?? '' });
          }}
        >
          {text.addRule}
        </Button>
      ) : (
        <RuleForm
          draft={draft}
          categories={categories}
          onCancel={() => {
            setDraft(undefined);
          }}
          onSaved={() => {
            setDraft(undefined);
            onChanged();
          }}
          onError={onError}
        />
      )}
    </Stack>
  );
}

function toRuleInput(rule: RulePayload): RuleInput {
  return {
    field: rule.field,
    operator: rule.operator,
    value: rule.value,
    priority: rule.priority,
    categoryId: rule.categoryId,
    active: rule.active,
  };
}

interface RuleFormProps {
  readonly draft: RuleDraft;
  readonly categories: readonly CategoryPayload[];
  readonly onCancel: () => void;
  readonly onSaved: () => void;
  readonly onError: (cause: unknown) => void;
}

function RuleForm({ draft, categories, onCancel, onSaved, onError }: RuleFormProps) {
  const text = rulesText();
  const [current, setCurrent] = useState(draft);
  const [marks, setMarks] = useState<Readonly<Record<string, string>>>({});

  function submit(): void {
    // The same parser the API runs, so the common mistake never leaves the browser.
    const parsed = parseRuleInput(toBody(current));
    if (!parsed.ok) {
      setMarks(describeRuleErrors(parsed.errors));
      return;
    }
    setMarks({});

    const saved =
      current.id === undefined ? createRule(parsed.rule) : updateRule(current.id, parsed.rule);

    saved.then(onSaved).catch((cause: unknown) => {
      const errors = ruleErrorsOf(cause);
      if (errors.length > 0) {
        setMarks(describeRuleErrors(errors));
        return;
      }
      onError(cause);
    });
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          component="form"
          spacing={2}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Typography variant="subtitle1">
            {current.id === undefined ? text.addRule : text.editRule}
          </Typography>

          <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <TextField
              select
              size="small"
              label={text.field}
              value={current.field}
              error={marks['field'] !== undefined}
              helperText={marks['field']}
              sx={{ minWidth: 160 }}
              onChange={(event) => {
                setCurrent({ ...current, field: event.target.value as RuleField });
              }}
            >
              {RULE_FIELDS.map((field) => (
                <MenuItem key={field} value={field}>
                  {text.fields[field]}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              size="small"
              label={text.operator}
              value={current.operator}
              error={marks['operator'] !== undefined}
              helperText={marks['operator']}
              sx={{ minWidth: 160 }}
              onChange={(event) => {
                setCurrent({ ...current, operator: event.target.value as RuleOperator });
              }}
            >
              {RULE_OPERATORS.map((operator) => (
                <MenuItem key={operator} value={operator}>
                  {text.operators[operator]}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              size="small"
              label={text.value}
              value={current.value}
              error={marks['value'] !== undefined}
              helperText={marks['value']}
              onChange={(event) => {
                setCurrent({ ...current, value: event.target.value });
              }}
            />

            <TextField
              size="small"
              label={text.priority}
              value={current.priority}
              error={marks['priority'] !== undefined}
              helperText={marks['priority']}
              sx={{ maxWidth: 120 }}
              onChange={(event) => {
                setCurrent({ ...current, priority: event.target.value });
              }}
            />

            <TextField
              select
              size="small"
              label={text.category}
              value={current.categoryId}
              error={marks['categoryId'] !== undefined}
              helperText={marks['categoryId']}
              sx={{ minWidth: 180 }}
              onChange={(event) => {
                setCurrent({ ...current, categoryId: event.target.value });
              }}
            >
              {categories.map((category) => (
                <MenuItem key={category.id} value={category.id}>
                  {category.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <Stack direction="row" spacing={1}>
            <Button type="submit" variant="contained">
              {text.saveRule}
            </Button>
            <Button onClick={onCancel}>{text.cancel}</Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

function ApplyResult({ summary }: { readonly summary: ApplySummary }) {
  return (
    <Alert severity="success">
      <Box component="span">
        {summary.evaluated} geprüft · {summary.assigned} zugeordnet · {summary.cleared} gelöscht ·{' '}
        {summary.locked} manuell
      </Box>
    </Alert>
  );
}
