import { CATEGORY_COLOR_COUNT, type CategoryPayload } from '@household-budget/core';
import AddRounded from '@mui/icons-material/AddRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Card from '@mui/material/Card';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { type TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError, createCategory, deleteCategory, updateCategory } from '../../api/client';
import {
  categoryUseOf,
  type CategoryUse,
  describeCategoryDeleted,
  describeCategoryInUse,
} from '../../locales/sentences';
import { categoryColor } from '../../ui/categoryColor';
import { StatusIcon } from '../../ui/StatusIcon';

/** A sentence still to be worded, in whatever language is current when it renders. */
export type Describe = (t: TFunction) => string;

interface CategoryPanelProps {
  readonly categories: readonly CategoryPayload[];
  /** Rows per category id, for the count beside each name. */
  readonly counts: ReadonlyMap<string, number>;
  readonly onChanged: () => void;
  readonly onError: (cause: unknown) => void;
  readonly onUndoable: (describe: Describe, restore: () => Promise<unknown>) => void;
}

/**
 * Categories are managed beside the rules rather than on a page of their own: a category
 * exists to be pointed at by a rule, and the two are edited in the same sitting. Each has
 * its colour (DESIGN.md §2.2), chosen here from the eight the palette has.
 */
export function CategoryPanel({
  categories,
  counts,
  onChanged,
  onError,
  onUndoable,
}: CategoryPanelProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  // `undefined` = the colour the server would pick next; shown as chosen, sent only if changed.
  const [color, setColor] = useState<number | undefined>(undefined);
  // The counts of the last refused delete; worded at render.
  const [refusal, setRefusal] = useState<CategoryUse | undefined>(undefined);
  const [recolouring, setRecolouring] = useState<
    { readonly anchor: HTMLElement; readonly category: CategoryPayload } | undefined
  >(undefined);
  const nextColor = categories.length % CATEGORY_COLOR_COUNT;

  function add(): void {
    if (name.trim() === '') {
      return;
    }
    createCategory(name)
      .then((created) =>
        color === undefined || color === created.colorIndex
          ? created
          : updateCategory(created.id, { colorIndex: color }),
      )
      .then(() => {
        setName('');
        setColor(undefined);
        setRefusal(undefined);
        onChanged();
      })
      .catch(onError);
  }

  /*
   * Deleting stays one click and immediate; the snackbar offers the way back. Undo is a
   * re-create by name, and that loses nothing: the API refuses to delete a category any
   * rule, budget or live row points at, so the one that went was only ever a name.
   */
  function remove(category: CategoryPayload): void {
    // The refusal is not cleared before the request: a repeat click on a category still
    // in use would drop the warning and put it back (dogfood ISSUE-012).
    deleteCategory(category.id)
      .then(() => {
        setRefusal(undefined);
        onUndoable(
          (tr) => describeCategoryDeleted(tr, category.name),
          () => createCategory(category.name),
        );
        onChanged();
      })
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.code === 'CATEGORY_IN_USE') {
          setRefusal(categoryUseOf(cause.details));
          return;
        }
        // The counts on screen belong to the last refused category, and the warning does
        // not name it: left up next to this error, they would read as this one's.
        setRefusal(undefined);
        onError(cause);
      });
  }

  return (
    <Card component="section" aria-label={t('rules.categoriesTitle')}>
      <Typography variant="h2" component="h2" sx={{ px: 2.5, pt: 2, pb: 1.5 }}>
        {t('rules.categoriesTitle')}
      </Typography>

      {categories.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2.5, pb: 2 }}>
          {t('rules.noCategories')}
        </Typography>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {categories.map((category) => (
            <Stack
              component="li"
              key={category.id}
              direction="row"
              spacing={1.25}
              sx={{
                alignItems: 'center',
                minHeight: 44,
                px: 2,
                borderTop: '1px solid',
                borderColor: 'divider',
              }}
            >
              <ButtonBase
                aria-label={`${t('rules.changeColor')}: ${category.name}`}
                onClick={(event) => {
                  setRecolouring({ anchor: event.currentTarget, category });
                }}
                sx={(theme) => ({
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  backgroundColor: categoryColor(theme, category.colorIndex),
                })}
              />
              <Typography variant="body1" sx={{ fontWeight: 500, flexGrow: 1, minWidth: 0 }} noWrap>
                {category.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('rules.rowCount', { count: counts.get(category.id) ?? 0 })}
              </Typography>
              <IconButton
                size="small"
                aria-label={`${t('rules.deleteCategory')}: ${category.name}`}
                onClick={() => {
                  remove(category);
                }}
              >
                <StatusIcon kind="clear" />
              </IconButton>
            </Stack>
          ))}
        </Box>
      )}

      {refusal !== undefined && (
        <Alert severity="warning" sx={{ mx: 2, mt: 1.5 }}>
          {describeCategoryInUse(t, refusal)}
        </Alert>
      )}

      <Stack
        component="form"
        spacing={1.25}
        sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider', mt: 1.5 }}
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <TextField
          size="small"
          label={t('rules.categoryName')}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <ColorPicker label={t('rules.colorLabel')} value={color ?? nextColor} onChange={setColor} />
        <Button
          type="submit"
          variant="outlined"
          startIcon={<AddRounded />}
          sx={{ alignSelf: 'flex-start' }}
        >
          {t('rules.addCategory')}
        </Button>
      </Stack>

      <Popover
        open={recolouring !== undefined}
        anchorEl={recolouring?.anchor}
        onClose={() => {
          setRecolouring(undefined);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 1.5 } } }}
      >
        {recolouring !== undefined && (
          <ColorPicker
            label={`${t('rules.changeColor')}: ${recolouring.category.name}`}
            value={recolouring.category.colorIndex}
            onChange={(colorIndex) => {
              const { category } = recolouring;
              setRecolouring(undefined);
              updateCategory(category.id, { colorIndex }).then(onChanged).catch(onError);
            }}
          />
        )}
      </Popover>
    </Card>
  );
}

/** The eight colours as a radio group, each swatch named „Farbe n“ and checked when chosen. */
function ColorPicker({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly onChange: (colorIndex: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <Stack direction="row" spacing={1} role="radiogroup" aria-label={label}>
      {Array.from({ length: CATEGORY_COLOR_COUNT }, (_, index) => (
        <ButtonBase
          key={index}
          role="radio"
          aria-checked={index === value}
          aria-label={t('rules.colorN', { n: index + 1 })}
          onClick={() => {
            onChange(index);
          }}
          sx={(theme) => ({
            width: 24,
            height: 24,
            borderRadius: '50%',
            backgroundColor: categoryColor(theme, index),
            boxShadow:
              index === value
                ? `0 0 0 2px ${theme.palette.background.paper}, 0 0 0 4px ${theme.palette.text.primary}`
                : 'none',
          })}
        />
      ))}
    </Stack>
  );
}
