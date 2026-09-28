import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  type CategoryPayload,
  parseRuleInput,
  type RuleInputError,
  type RulePayload,
} from '@household-budget/core';
import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import DragIndicatorRounded from '@mui/icons-material/DragIndicatorRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { type KeyboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { updateRule } from '../../api/client';
import { describeRuleErrors } from '../../locales/sentences';
import { displayValue } from '../../ui/displayValue';
import { type RuleCondition, RuleSentence, RuleSentenceEditor } from '../../ui/RuleSentence';
import { StatusIcon } from '../../ui/StatusIcon';
import { ruleErrorsOf } from './ruleErrors';

interface RuleListProps {
  /** In the engine's order, which is the order shown: position is priority. */
  readonly rules: readonly RulePayload[];
  readonly categories: readonly CategoryPayload[];
  /** Rows each rule wins now, by id (`ruleWins`). */
  readonly wins: ReadonlyMap<string, number>;
  /** A new order, first to last; the page saves it and puts it back if refused. */
  readonly onMove: (ordered: readonly RulePayload[]) => void;
  readonly onChanged: () => void;
  readonly onDelete: (rule: RulePayload) => void;
  readonly onError: (cause: unknown) => void;
}

/**
 * The rules as sentences, in the order they are tried (plan 08, phase 4). The order is
 * changed by dragging, by the ↑/↓ buttons, or with `Alt+↑`/`Alt+↓` on a focused row — all
 * three the same move, saved through one `PUT /api/rules/order`.
 */
export function RuleList({
  rules,
  categories,
  wins,
  onMove,
  onChanged,
  onDelete,
  onError,
}: RuleListProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function move(from: number, to: number): void {
    if (from === to || to < 0 || to >= rules.length) {
      return;
    }
    onMove(arrayMove([...rules], from, to));
  }

  function onDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (over === null || active.id === over.id) {
      return;
    }
    move(
      rules.findIndex((rule) => rule.id === active.id),
      rules.findIndex((rule) => rule.id === over.id),
    );
  }

  return (
    <Card component="section" aria-label={t('rules.rulesTitle')}>
      <Stack spacing={0.5} sx={{ px: { xs: 2, md: 2.5 }, pt: 2, pb: 1.5 }}>
        <Typography variant="h2" component="h2">
          {t('rules.rulesTitle')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('rules.orderHint')}
        </Typography>
      </Stack>
      {rules.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2.5, pb: 2 }}>
          {t('rules.noRules')}
        </Typography>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={rules.map((rule) => rule.id)}
            strategy={verticalListSortingStrategy}
          >
            <Box
              component="ol"
              aria-label={t('rules.rulesTitle')}
              sx={{ listStyle: 'none', m: 0, p: 0 }}
            >
              {rules.map((rule, index) => (
                <SortableRule
                  key={rule.id}
                  rule={rule}
                  position={index + 1}
                  last={index === rules.length - 1}
                  categories={categories}
                  wins={wins.get(rule.id) ?? 0}
                  editing={editing === rule.id}
                  onEdit={() => {
                    setEditing(rule.id);
                  }}
                  onEditDone={(saved) => {
                    setEditing(undefined);
                    if (saved) {
                      onChanged();
                    }
                  }}
                  onMove={(delta) => {
                    move(index, index + delta);
                  }}
                  onDelete={() => {
                    onDelete(rule);
                  }}
                  onChanged={onChanged}
                  onError={onError}
                />
              ))}
            </Box>
          </SortableContext>
        </DndContext>
      )}
    </Card>
  );
}

interface SortableRuleProps {
  readonly rule: RulePayload;
  readonly position: number;
  readonly last: boolean;
  readonly categories: readonly CategoryPayload[];
  readonly wins: number;
  readonly editing: boolean;
  readonly onEdit: () => void;
  readonly onEditDone: (saved: boolean) => void;
  readonly onMove: (delta: -1 | 1) => void;
  readonly onDelete: () => void;
  readonly onChanged: () => void;
  readonly onError: (cause: unknown) => void;
}

function SortableRule({
  rule,
  position,
  last,
  categories,
  wins,
  editing,
  onEdit,
  onEditDone,
  onMove,
  onDelete,
  onChanged,
  onError,
}: SortableRuleProps) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: rule.id });
  const shown = displayValue(rule);

  function onKeyDown(event: KeyboardEvent): void {
    if (!event.altKey) {
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onMove(-1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      onMove(1);
    }
  }

  return (
    <Box
      component="li"
      ref={setNodeRef}
      onKeyDown={onKeyDown}
      sx={{
        transform: CSS.Transform.toString(transform),
        transition,
        position: 'relative',
        zIndex: isDragging ? 1 : 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        minHeight: 60,
        pl: 1,
        pr: { xs: 1, md: 2 },
        py: 1,
        borderTop: '1px solid',
        borderColor: 'divider',
        backgroundColor: isDragging ? 'background.subtle' : 'background.paper',
        opacity: rule.active ? 1 : 0.6,
        flexWrap: { xs: 'wrap', md: 'nowrap' },
      }}
    >
      <IconButton
        ref={setActivatorNodeRef}
        size="small"
        aria-label={`${t('rules.dragHandle')}: ${shown}`}
        {...attributes}
        {...listeners}
        sx={{ cursor: 'grab', color: 'text.disabled' }}
      >
        <DragIndicatorRounded fontSize="small" />
      </IconButton>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ width: 20, textAlign: 'right', flexShrink: 0 }}
      >
        {position}
      </Typography>

      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        {editing ? (
          <RuleEditor rule={rule} categories={categories} onDone={onEditDone} onError={onError} />
        ) : (
          <RuleSentence rule={rule} categories={categories} />
        )}
      </Box>

      {!editing && (
        <Stack
          direction="row"
          spacing={0.5}
          sx={{ alignItems: 'center', flexShrink: 0, ml: 'auto' }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ width: 80, textAlign: 'right', whiteSpace: 'nowrap' }}
          >
            {rule.active ? t('rules.wins', { count: wins }) : t('rules.inactive')}
          </Typography>
          <Switch
            size="small"
            checked={rule.active}
            slotProps={{ input: { 'aria-label': `${t('rules.active')}: ${shown}` } }}
            onChange={(event) => {
              updateRule(rule.id, { ...rule, active: event.target.checked })
                .then(onChanged)
                .catch(onError);
            }}
          />
          <IconButton
            size="small"
            aria-label={`${t('rules.moveUp')}: ${shown}`}
            disabled={position === 1}
            onClick={() => {
              onMove(-1);
            }}
          >
            <ArrowUpwardRounded fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            aria-label={`${t('rules.moveDown')}: ${shown}`}
            disabled={last}
            onClick={() => {
              onMove(1);
            }}
          >
            <ArrowDownwardRounded fontSize="small" />
          </IconButton>
          <IconButton size="small" aria-label={t('rules.editRule')} onClick={onEdit}>
            <EditRounded fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            aria-label={`${t('rules.deleteRule')}: ${shown}`}
            onClick={onDelete}
            sx={{ color: 'status.over.main' }}
          >
            <StatusIcon kind="clear" />
          </IconButton>
        </Stack>
      )}
    </Box>
  );
}

/** The row's sentence, editable in place. Sends the stored priority: an edit never moves it. */
function RuleEditor({
  rule,
  categories,
  onDone,
  onError,
}: {
  readonly rule: RulePayload;
  readonly categories: readonly CategoryPayload[];
  readonly onDone: (saved: boolean) => void;
  readonly onError: (cause: unknown) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<RuleCondition>({ ...rule, value: displayValue(rule) });
  const [errors, setErrors] = useState<readonly RuleInputError[]>([]);

  function save(): void {
    const parsed = parseRuleInput({ ...draft, priority: rule.priority, active: rule.active });
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    updateRule(rule.id, parsed.rule)
      .then(() => {
        onDone(true);
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
    <Stack
      component="form"
      spacing={1.25}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <RuleSentenceEditor
        rule={draft}
        categories={categories}
        onChange={setDraft}
        marks={describeRuleErrors(t, errors)}
        autoFocusValue
      />
      <Stack direction="row" spacing={1}>
        <Button type="submit" variant="contained" size="small">
          {t('rules.saveRule')}
        </Button>
        <Button
          size="small"
          onClick={() => {
            onDone(false);
          }}
        >
          {t('rules.cancel')}
        </Button>
      </Stack>
    </Stack>
  );
}
