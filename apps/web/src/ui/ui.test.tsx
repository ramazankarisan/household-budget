import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AmountText } from './AmountText';
import { CategoryPill } from './CategoryPill';
import { DelayedSkeleton, SKELETON_DELAY_MS } from './DelayedSkeleton';
import { StatusIcon } from './StatusIcon';

/** `Intl` puts U+00A0 between the amount and the €. */
const plain = (text: string | null): string => (text ?? '').replaceAll(' ', ' ');

describe('StatusIcon', () => {
  it('is named when it carries the meaning', () => {
    render(<StatusIcon kind="pending" label="vorgemerkt" />);

    expect(screen.getByRole('img', { name: 'vorgemerkt' })).toBeInTheDocument();
  });

  it('is hidden when a word beside it already says it', () => {
    const { container } = render(<StatusIcon kind="over" />);

    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('AmountText', () => {
  it('writes money out as the statement does', () => {
    render(<AmountText cents={-83290} tone="auto" />);

    expect(plain(screen.getByText(/832,90/).textContent)).toBe('-832,90 €');
  });

  it('marks money in with a plus, and only when asked to', () => {
    const { rerender } = render(<AmountText cents={245000} tone="auto" />);
    expect(plain(screen.getByText(/2\.450,00/).textContent)).toBe('+2.450,00 €');

    rerender(<AmountText cents={245000} />);
    expect(plain(screen.getByText(/2\.450,00/).textContent)).toBe('2.450,00 €');
  });

  it('never wraps mid-number', () => {
    render(<AmountText cents={-100} />);

    expect(screen.getByText(/1,00/)).toHaveStyle({ whiteSpace: 'nowrap' });
  });
});

describe('CategoryPill', () => {
  it('shows the name beside the colour, never the colour alone', () => {
    render(<CategoryPill category={{ name: 'Wohnen', colorIndex: 3 }} />);

    expect(screen.getByText('Wohnen')).toBeInTheDocument();
  });

  it('names the uncategorized bucket', () => {
    render(<CategoryPill category={null} />);

    expect(screen.getByText('Ohne Kategorie')).toBeInTheDocument();
  });

  it('is a button only when it does something', () => {
    const onClick = vi.fn();
    const { rerender } = render(<CategoryPill category={{ name: 'Wohnen', colorIndex: 0 }} />);
    expect(screen.queryByRole('button')).toBeNull();

    rerender(<CategoryPill category={{ name: 'Wohnen', colorIndex: 0 }} onClick={onClick} />);
    act(() => {
      screen.getByRole('button', { name: 'Wohnen' }).click();
    });
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('DelayedSkeleton', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows nothing for a quick load, then the shape of what is coming', () => {
    vi.useFakeTimers();
    render(<DelayedSkeleton label="Wird geladen" />);

    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS - 1);
    });
    expect(screen.queryByRole('status')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('status', { name: 'Wird geladen' })).toBeInTheDocument();
  });
});
