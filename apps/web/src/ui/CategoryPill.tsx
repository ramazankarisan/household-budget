import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import { type SxProps, type Theme } from '@mui/material/styles';
import { type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { categoryColor } from './categoryColor';

interface PillCategory {
  readonly name: string;
  readonly colorIndex: number;
}

interface CategoryPillProps {
  /** `null` is the uncategorized bucket: no colour, a dashed outline. */
  readonly category: PillCategory | null;
  /** Makes the pill a button with a chevron. */
  readonly onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  readonly disabled?: boolean;
  /** The button's accessible name; defaults to what it shows. */
  readonly 'aria-label'?: string | undefined;
  readonly title?: string | undefined;
  readonly sx?: SxProps<Theme>;
}

/** The colour dot of a category. Always rendered beside the name, never alone. */
export function CategoryDot({
  colorIndex,
  size = 8,
}: {
  readonly colorIndex: number;
  readonly size?: number;
}) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={(theme) => ({
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        backgroundColor: categoryColor(theme, colorIndex),
      })}
    />
  );
}

/**
 * A category as the eye finds it: dot + name (DESIGN.md §2.2 — a colour never appears
 * without its name). Clickable variant is a real `button`.
 */
export function CategoryPill({
  category,
  onClick,
  disabled = false,
  'aria-label': ariaLabel,
  title,
  sx,
}: CategoryPillProps) {
  const { t } = useTranslation();
  const name = category?.name ?? t('common.uncategorized');
  const content: ReactNode = (
    <>
      {category === null ? null : <CategoryDot colorIndex={category.colorIndex} />}
      <Box
        component="span"
        sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
      >
        {name}
      </Box>
      {onClick === undefined ? null : (
        <ExpandMoreRounded aria-hidden sx={{ fontSize: '1.1em', color: 'text.secondary' }} />
      )}
    </>
  );

  const base: SxProps<Theme> = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0.75,
    maxWidth: '100%',
    height: 26,
    px: 1.25,
    borderRadius: 999,
    typography: 'caption',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    border: '1px solid',
    borderColor: 'divider',
    borderStyle: category === null ? 'dashed' : 'solid',
    ...(category === null
      ? { borderColor: 'border.strong', color: 'text.secondary' }
      : { color: 'text.primary', backgroundColor: 'background.paper' }),
  };

  if (onClick === undefined) {
    return (
      <Box component="span" title={title} sx={[base, ...(Array.isArray(sx) ? sx : [sx])]}>
        {content}
      </Box>
    );
  }

  return (
    <ButtonBase
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      aria-haspopup="menu"
      sx={[
        base,
        { '&:hover': { backgroundColor: 'background.subtle' } },
        disabled ? { opacity: 0.6 } : {},
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {content}
    </ButtonBase>
  );
}
