import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  colorSchemes: {
    light: true,
    dark: true,
  },
  shape: {
    borderRadius: 10,
  },
  typography: {
    fontFamily: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'].join(','),
  },
});
