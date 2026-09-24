import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { theme } from '../theme';
import { AppHeader } from './AppHeader';

beforeEach(() => {
  localStorage.clear();
  // jsdom has no `matchMedia`; the theme button asks it which scheme the OS prefers.
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
});

describe('AppHeader', () => {
  it('renders the title, the three nav links and the theme button', async () => {
    // ThemeProvider, or the theme button renders nothing; a router, because Nav is NavLinks.
    render(
      <ThemeProvider theme={theme}>
        <MemoryRouter>
          <AppHeader />
        </MemoryRouter>
      </ThemeProvider>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Household Budget' })).toBeVisible();
    for (const name of ['Umsätze', 'Regeln', 'Budgets']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    expect(await screen.findByRole('button', { name: 'Dunkles Design' })).toBeInTheDocument();
  });
});
