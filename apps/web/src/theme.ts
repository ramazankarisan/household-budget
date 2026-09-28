import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/newsreader/500.css';

import { createTheme, type PaletteOptions } from '@mui/material/styles';

/**
 * DESIGN.md §2 as a theme. Every colour a page shows comes from here; `pages/`, `ui/` and
 * `shell/` name palette paths, never hex values.
 *
 * `colorSchemes` without `cssVariables` (plan 08, decision 14): with CSS variables on and
 * both schemes declared, MUI switches schemes by media query and ignores the choice
 * `ThemeToggle` stores in `mui-mode`.
 */

const SANS = [
  '"IBM Plex Sans"',
  'system-ui',
  '-apple-system',
  '"Segoe UI"',
  'Roboto',
  'sans-serif',
].join(',');
const SERIF = ['Newsreader', 'Georgia', 'serif'].join(',');
export const MONO = [
  '"IBM Plex Mono"',
  'ui-monospace',
  'SFMono-Regular',
  'Menlo',
  'monospace',
].join(',');

/** DESIGN.md §2.2, in index order. Stored on a category as its index, never as a hex. */
const CATEGORY_LIGHT = [
  '#2A78D6',
  '#EB6834',
  '#1BAF7A',
  '#EDA100',
  '#E87BA4',
  '#008300',
  '#4A3AA7',
  '#A8641C',
] as const;
const CATEGORY_DARK = [
  '#3987E5',
  '#D95926',
  '#199E70',
  '#C98500',
  '#D55181',
  '#008300',
  '#9085E9',
  '#C07A30',
] as const;

const light: PaletteOptions = {
  mode: 'light',
  primary: { main: '#0E5A4B', soft: '#E1EFEA', contrastText: '#FFFFFF' },
  error: { main: '#B42318', soft: '#FBE9E7' },
  warning: { main: '#A15C00', soft: '#FBEFD9' },
  success: { main: '#1D7442', soft: '#E3F1E8' },
  background: { default: '#F6F5F1', paper: '#FFFFFF', subtle: '#EFEDE7' },
  divider: '#E2DFD7',
  text: { primary: '#1A1C1B', secondary: '#5B605D', disabled: '#8E928F' },
  border: { main: '#E2DFD7', strong: '#878C89' },
  status: {
    income: { main: '#1D7442', soft: '#E3F1E8' },
    ok: { main: '#1D7442', soft: '#E3F1E8' },
    near: { main: '#A15C00', soft: '#FBEFD9' },
    over: { main: '#B42318', soft: '#FBE9E7' },
    pending: { main: '#4D5E80', soft: '#E8ECF4' },
  },
  category: CATEGORY_LIGHT,
};

const dark: PaletteOptions = {
  mode: 'dark',
  primary: { main: '#62C7AE', soft: '#15302A', contrastText: '#0F1211' },
  error: { main: '#F4776B', soft: '#3A1916' },
  warning: { main: '#F0B24A', soft: '#3A2C12' },
  success: { main: '#5FCB8C', soft: '#16301F' },
  background: { default: '#0F1211', paper: '#171B1A', subtle: '#1E2321' },
  divider: '#2A302E',
  text: { primary: '#ECEDEA', secondary: '#A3AAA6', disabled: '#6E7572' },
  border: { main: '#2A302E', strong: '#6A716E' },
  status: {
    income: { main: '#5FCB8C', soft: '#16301F' },
    ok: { main: '#5FCB8C', soft: '#16301F' },
    near: { main: '#F0B24A', soft: '#3A2C12' },
    over: { main: '#F4776B', soft: '#3A1916' },
    pending: { main: '#9DB0D6', soft: '#1E2533' },
  },
  category: CATEGORY_DARK,
};

export const theme = createTheme({
  colorSchemes: {
    light: { palette: light },
    dark: { palette: dark },
  },
  shape: {
    borderRadius: 6,
  },
  typography: {
    fontFamily: SANS,
    display: { fontFamily: SERIF, fontSize: '3rem', lineHeight: 1.08, fontWeight: 500 },
    h1: { fontFamily: SERIF, fontSize: '1.75rem', lineHeight: 1.2, fontWeight: 500 },
    h2: { fontSize: '1rem', lineHeight: 1.5, fontWeight: 600 },
    h3: { fontSize: '0.875rem', lineHeight: 1.43, fontWeight: 600 },
    h6: { fontSize: '1rem', lineHeight: 1.5, fontWeight: 600 },
    subtitle1: { fontSize: '0.875rem', lineHeight: 1.43, fontWeight: 600 },
    body1: { fontSize: '0.875rem', lineHeight: 1.43 },
    body2: { fontSize: '0.8125rem', lineHeight: 1.38 },
    caption: { fontSize: '0.75rem', lineHeight: 1.33 },
    button: { textTransform: 'none', fontWeight: 500, fontSize: '0.875rem' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { fontVariantNumeric: 'tabular-nums' },
        kbd: { fontFamily: MONO },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
    },
    MuiButtonBase: {
      styleOverrides: {
        root: ({ theme }) => ({
          '&.Mui-focusVisible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
          },
        }),
      },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: { root: { borderRadius: 10 } },
    },
    MuiPaper: {
      styleOverrides: {
        outlined: ({ theme }) => ({ borderColor: theme.palette.divider }),
      },
    },
    MuiChip: {
      styleOverrides: { root: { borderRadius: 999 } },
    },
    MuiTableCell: {
      styleOverrides: {
        head: ({ theme }) => ({
          ...theme.typography.caption,
          color: theme.palette.text.secondary,
        }),
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        notchedOutline: ({ theme }) => ({ borderColor: theme.palette.border.strong }),
      },
    },
  },
});
