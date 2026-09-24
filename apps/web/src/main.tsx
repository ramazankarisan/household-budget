import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './locales/i18n';

import { App } from './App';
import { theme } from './theme';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    {/*
      noSsr: the app only ever renders in the browser, so the stored scheme can be read on
      the first render instead of after a mount effect — no light frame on a dark reload,
      and the theme button is in the header from the start rather than popping in.
    */}
    <ThemeProvider theme={theme} noSsr>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </StrictMode>,
);
