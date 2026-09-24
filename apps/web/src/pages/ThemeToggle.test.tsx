import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { theme } from '../theme';
import { ThemeToggle } from './ThemeToggle';

/** jsdom has no `matchMedia`; MUI asks it which scheme the OS prefers. Light, here. */
function stubMatchMedia(): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

beforeEach(() => {
  // The cases below write MUI's `mui-mode`; each starts from a first visit.
  localStorage.clear();
  stubMatchMedia();
});

describe('ThemeToggle', () => {
  it('offers dark mode on a light OS, and flips on each click', async () => {
    render(
      <ThemeProvider theme={theme}>
        <ThemeToggle />
      </ThemeProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Dunkles Design' }));
    expect(await screen.findByRole('button', { name: 'Helles Design' })).toBeInTheDocument();
    expect(localStorage.getItem('mui-mode')).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: 'Helles Design' }));
    expect(await screen.findByRole('button', { name: 'Dunkles Design' })).toBeInTheDocument();
    expect(localStorage.getItem('mui-mode')).toBe('light');
  });

  it('renders nothing outside a ThemeProvider', () => {
    // `useColorScheme()` is a no-op there, and a button that does nothing is worse than none.
    const { container } = render(<ThemeToggle />);
    expect(container).toBeEmptyDOMElement();
  });
});
