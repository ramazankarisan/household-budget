import {
  type ApplySummary,
  type CategoryPayload,
  operatorsForField,
  parseRuleInput,
  RULE_FIELDS,
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
import Snackbar from '@mui/material/Snackbar';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiError,
  applyRules,
  createCategory,
  createRule,
  deleteCategory,
  deleteRule,
  listCategories,
  listRules,
  restoreRule,
  updateRule,
} from '../api/client';
import {
  describeApplySummary,
  describeCategoryDeleted,
  describeCategoryInUse,
  describeRuleDeleted,
  describeRuleErrors,
  rulesText,
} from '../i18n/rules';
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
  /*
   * The one undo on offer: the last category or rule deleted. One slot for both, so a
   * second delete of either kind replaces the first rather than stacking two snackbars.
   * `key` is new for every delete, which remounts the snackbar with its own message and a
   * fresh six seconds instead of what was left of the previous one's.
   */
  const [undoable, setUndoable] = useState<Undoable | undefined>(undefined);
  const undoSeq = useRef(0);
  const offerUndo = useCallback((message: string, restore: () => Promise<unknown>) => {
    undoSeq.current += 1;
    setUndoable({ key: undoSeq.current, message, restore });
  }, []);

  const fail = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);

  // The load in flight. Every reload goes through it, the mount and the five mutations
  // alike: a rule saved twice in quick succession fires two reloads, and the slower one
  // landing last would put the earlier list back on screen. Aborting the older one is the
  // same guard `AccountPage` uses for its transaction list, and it is what keeps a
  // response arriving after this page unmounts from setting state.
  const inFlight = useRef<AbortController | undefined>(undefined);

  const reload = useCallback(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    Promise.all([listCategories(controller.signal), listRules(controller.signal)])
      .then(([loadedCategories, loadedRules]) => {
        if (!controller.signal.aborted) {
          setCategories(loadedCategories);
          setRules(loadedRules);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          fail(cause);
        }
      });
  }, [fail]);

  useEffect(() => {
    reload();
    return () => {
      inFlight.current?.abort();
    };
  }, [reload]);

  /*
   * Every write goes through here rather than calling `reload` directly. Dropping the
   * apply result is the point: "412 geprüft · 318 zugeordnet" describes a run against the
   * rule set that existed when the button was pressed, and leaving it up after a rule is
   * edited, deleted or switched off states those counts about a rule set that is gone.
   */
  const changed = useCallback(() => {
    setApply({ status: 'idle' });
    reload();
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
          onChanged={changed}
          onError={fail}
          onUndoable={offerUndo}
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
                onChanged={changed}
                onError={fail}
                onUndoable={offerUndo}
              />

              {apply.status === 'done' && <ApplyResult summary={apply.summary} />}
              {apply.status === 'error' && <Alert severity="error">{apply.message}</Alert>}
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      {undoable !== undefined && (
        <Snackbar
          key={undoable.key}
          open
          autoHideDuration={6000}
          message={undoable.message}
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
              {text.undo}
            </Button>
          }
        />
      )}
    </Container>
  );
}

/** What the undo snackbar offers: its sentence, and the call that reverses the delete. */
interface Undoable {
  readonly key: number;
  readonly message: string;
  readonly restore: () => Promise<unknown>;
}

interface CategoryStripProps {
  readonly categories: readonly CategoryPayload[];
  readonly onChanged: () => void;
  readonly onError: (cause: unknown) => void;
  readonly onUndoable: (message: string, restore: () => Promise<unknown>) => void;
}

/**
 * Categories are managed here rather than on a page of their own: a category exists to be
 * pointed at by a rule, and the two are always edited in the same sitting.
 */
function CategoryStrip({ categories, onChanged, onError, onUndoable }: CategoryStripProps) {
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

  /*
   * Deleting stays one click and immediate; the snackbar offers the way back. Undo is a
   * re-create by name, and that loses nothing: the API refuses to delete a category any
   * rule, budget or live row points at, so the one that went was only ever a name. A
   * soft-deleted row that pointed at it is detached, but it is never locked — soft delete
   * releases the lock — so the next apply re-derives its category if it is restored.
   */
  function remove(category: CategoryPayload): void {
    // The refusal is not cleared before the request: a repeat click on a category still
    // in use would drop the warning and put it back 17 ms later, and the form below it
    // jumped both times (dogfood ISSUE-012). It is replaced by the answer instead.
    deleteCategory(category.id)
      .then(() => {
        setRefusal(undefined);
        onUndoable(describeCategoryDeleted(category.name), () => createCategory(category.name));
        onChanged();
      })
      .catch((cause: unknown) => {
        // The counts are the answer to "why not", so they are shown rather than logged.
        if (cause instanceof ApiError && cause.code === 'CATEGORY_IN_USE') {
          const { rules, transactions, budgets } = cause.details as {
            rules?: unknown;
            transactions?: unknown;
            budgets?: unknown;
          };
          const count = (value: unknown) => (typeof value === 'number' ? value : 0);
          setRefusal(
            describeCategoryInUse({
              rules: count(rules),
              transactions: count(transactions),
              budgets: count(budgets),
            }),
          );
          return;
        }
        // The counts on screen belong to the last refused category, and the warning does
        // not name it: left up next to this error, they would read as this one's.
        setRefusal(undefined);
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
                    remove(category);
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
  readonly onUndoable: (message: string, restore: () => Promise<unknown>) => void;
}

function RuleTable({ rules, categories, onChanged, onError, onUndoable }: RuleTableProps) {
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
                  {/* An IBAN is stored normalized — no spaces, lower case, so matching
                      never depends on how it was typed — and `de89370400440532013000` is
                      not how anyone reads one back. Upper-cased for the eye only; the
                      stored value is what a fingerprint was built from. */}
                  <TableCell>{displayValue(rule)}</TableCell>
                  <TableCell>{nameOf(rule.categoryId)}</TableCell>
                  <TableCell align="right">
                    <Switch
                      size="small"
                      checked={rule.active}
                      slotProps={{
                        input: { 'aria-label': `${text.active}: ${displayValue(rule)}` },
                      }}
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
                        aria-label={`${text.deleteRule}: ${displayValue(rule)}`}
                        onClick={() => {
                          // The API answers with the rule as it stood, `createdAt` and all,
                          // so an undo puts it back in the same place in the order.
                          deleteRule(rule.id)
                            .then((deleted) => {
                              onUndoable(describeRuleDeleted(displayValue(rule)), () =>
                                restoreRule(deleted),
                              );
                              onChanged();
                            })
                            .catch(onError);
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
          /*
           * Keyed by the rule being edited. `RuleForm` seeds its editable copy with
           * `useState(draft)`, so without this, clicking "bearbeiten" on a second rule
           * while the form is open changes the prop but not the state: the form keeps
           * showing the first rule's values *and* its id, and saving overwrites the
           * wrong rule with what is on screen.
           */
          key={draft.id ?? 'new'}
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

/** The keyword as the user should read it. Only an IBAN differs from what is stored. */
function displayValue(rule: RulePayload): string {
  return rule.field === 'counterpartyIban' ? rule.value.toUpperCase() : rule.value;
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
                const field = event.target.value as RuleField;
                const allowed = operatorsForField(field);
                setCurrent({
                  ...current,
                  field,
                  // Switching to IBAN while "enthält" is selected — the default for a new
                  // rule — would leave a form whose only outcome is a rejection on submit.
                  operator: allowed.includes(current.operator)
                    ? current.operator
                    : (allowed[0] ?? current.operator),
                });
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
              {/* Only the operators this field allows — core decides which, so the form
                  and the parser cannot disagree about it. */}
              {operatorsForField(current.field).map((operator) => (
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
      <Box component="span">{describeApplySummary(summary)}</Box>
    </Alert>
  );
}
