import '@mui/material/styles';
import '@mui/material/Typography';

/**
 * The palette keys DESIGN.md §2 adds to MUI's, declared once so `sx={{ color:
 * 'status.over.main' }}` and `theme.palette.category[i]` typecheck.
 */

interface StatusColor {
  readonly main: string;
  readonly soft: string;
}

interface StatusPalette {
  readonly income: StatusColor;
  readonly ok: StatusColor;
  readonly near: StatusColor;
  readonly over: StatusColor;
  readonly pending: StatusColor;
}

interface BorderPalette {
  /** Dividers and card edges — decorative, below 3:1. */
  readonly main: string;
  /** Input outlines — at least 3:1 against the surface. */
  readonly strong: string;
}

declare module '@mui/material/styles' {
  interface Palette {
    status: StatusPalette;
    border: BorderPalette;
    /** DESIGN.md §2.2, eight entries, indexed by `CategoryPayload.colorIndex`. */
    category: readonly string[];
  }
  interface PaletteOptions {
    status?: StatusPalette;
    border?: BorderPalette;
    category?: readonly string[];
  }
  interface PaletteColor {
    soft?: string;
  }
  interface SimplePaletteColorOptions {
    soft?: string;
  }
  interface TypeBackground {
    subtle: string;
  }
  interface TypographyVariants {
    display: React.CSSProperties;
  }
  interface TypographyVariantsOptions {
    display?: React.CSSProperties;
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    display: true;
  }
}
