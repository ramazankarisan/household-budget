import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppShell, MEDIUM, WIDE } from './AppShell';
import { MonthStepper } from './MonthStepper';
import { ALL_MONTHS, useMonth } from './useMonth';
import { shortcutKeyOf, useShortcuts } from './useShortcuts';

const MONTHS = ['2025-10', '2025-09', '2014-03'];

/** What the hook says, and where the URL is, side by side. */
function MonthProbe({ defaultTo }: { readonly defaultTo: 'newest' | 'all' }) {
  const state = useMonth(MONTHS, { defaultTo });
  const location = useLocation();
  return (
    <>
      <output aria-label="month">{state.month}</output>
      <output aria-label="search">{location.search}</output>
      <button type="button" onClick={() => state.step(1)}>
        newer
      </button>
      <button type="button" onClick={() => state.step(-1)}>
        older
      </button>
    </>
  );
}

function renderMonth(defaultTo: 'newest' | 'all', entry = '/') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <MonthProbe defaultTo={defaultTo} />
    </MemoryRouter>,
  );
}

const month = () => screen.getByRole('status', { name: 'month' }).textContent;

describe('useMonth', () => {
  it('opens on the newest month, or on every month, by the page', () => {
    renderMonth('newest');
    expect(month()).toBe('2025-10');
  });

  it('opens on every month where the page allows it', () => {
    renderMonth('all');
    expect(month()).toBe(ALL_MONTHS);
  });

  it('reads the month from the URL', () => {
    renderMonth('newest', '/?m=2025-09');
    expect(month()).toBe('2025-09');
  });

  it('falls back to the default for a month the data does not have', () => {
    renderMonth('newest', '/?m=2020-01');
    expect(month()).toBe('2025-10');
  });

  it('refuses "all" on a page that always shows one month', () => {
    renderMonth('newest', '/?m=all');
    expect(month()).toBe('2025-10');
  });

  it('steps through the months that exist and stops at the ends', () => {
    renderMonth('newest', '/?m=2025-09');

    fireEvent.click(screen.getByRole('button', { name: 'older' }));
    expect(month()).toBe('2014-03');
    expect(screen.getByRole('status', { name: 'search' })).toHaveTextContent('?m=2014-03');

    fireEvent.click(screen.getByRole('button', { name: 'older' }));
    expect(month()).toBe('2014-03');

    fireEvent.click(screen.getByRole('button', { name: 'newer' }));
    fireEvent.click(screen.getByRole('button', { name: 'newer' }));
    fireEvent.click(screen.getByRole('button', { name: 'newer' }));
    expect(month()).toBe('2025-10');
  });

  it('goes from every month to the newest one', () => {
    renderMonth('all');

    fireEvent.click(screen.getByRole('button', { name: 'older' }));
    expect(month()).toBe('2025-10');
  });
});

describe('MonthStepper', () => {
  it('names months rather than showing their keys, with "all" first where allowed', () => {
    render(<MonthStepper month="2025-09" available={MONTHS} allowAll onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Monat wählen: September 2025' }));

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Alle Monate',
      'Oktober 2025',
      'September 2025',
      'März 2014',
    ]);
  });

  it('reports the month picked, and disables an arrow at the end', () => {
    const onChange = vi.fn();
    render(
      <MonthStepper month="2025-10" available={MONTHS} allowAll={false} onChange={onChange} />,
    );

    expect(screen.getByRole('button', { name: 'Nächster Monat' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Vorheriger Monat' }));

    expect(onChange).toHaveBeenCalledWith('2025-09');
  });
});

describe('useShortcuts', () => {
  function Probe({ onKey }: { readonly onKey: () => void }) {
    useShortcuts({ j: onKey, 'Alt+ArrowUp': onKey });
    return <input aria-label="field" />;
  }

  it('fires on a plain key, and not while typing into a field', () => {
    const onKey = vi.fn();
    render(<Probe onKey={onKey} />);

    fireEvent.keyDown(window, { key: 'j' });
    expect(onKey).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'field' }), { key: 'j' });
    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it('leaves the browser its own modifier shortcuts', () => {
    expect(shortcutKeyOf(new KeyboardEvent('keydown', { key: 'j', metaKey: true }))).toBe(
      undefined,
    );
    expect(shortcutKeyOf(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true }))).toBe(
      undefined,
    );
    expect(shortcutKeyOf(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true }))).toBe(
      'Alt+ArrowUp',
    );
  });
});

describe('AppShell', () => {
  const original = window.matchMedia;

  afterEach(() => {
    window.matchMedia = original;
  });

  /** A window of `width` px, as far as `useMediaQuery` can tell. */
  function atWidth(width: number): void {
    window.matchMedia = ((query: string) => ({
      matches:
        (query === WIDE && width >= 1024) || (query === MEDIUM && width >= 720) ? true : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;
  }

  function renderShell(entry = '/rules?m=2025-09') {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <AppShell>
          <p>content</p>
        </AppShell>
      </MemoryRouter>,
    );
  }

  it('has a sidebar with the name and the nav on a wide window', () => {
    atWidth(1440);
    renderShell();

    const nav = screen.getByRole('navigation', { name: 'Hauptnavigation' });
    expect(nav).toHaveTextContent('Haushaltsbuch');
    expect(screen.getByRole('link', { name: 'Regeln' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('main')).toHaveTextContent('content');
  });

  it('keeps the month on every nav link', () => {
    atWidth(1440);
    renderShell();

    expect(screen.getByRole('link', { name: 'Umsätze' })).toHaveAttribute('href', '/?m=2025-09');
  });

  it('is a rail of named icons on a medium window', () => {
    atWidth(900);
    renderShell();

    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Budgets' })).toBeInTheDocument();
    expect(screen.queryByText('Haushaltsbuch')).toBeNull();
  });

  it('is a bar at the bottom with the rest behind „Mehr“ on a phone', () => {
    atWidth(390);
    renderShell();

    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    act(() => {
      screen.getByRole('button', { name: 'Mehr' }).click();
    });
    expect(screen.getByRole('group', { name: 'Sprache' })).toBeInTheDocument();
  });
});
