import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import i18n from '../locales/i18n';
import { LanguageToggle } from './LanguageToggle';

describe('LanguageToggle', () => {
  it('starts German, and switches, stores and announces English', async () => {
    render(<LanguageToggle />);

    expect(screen.getByRole('group', { name: 'Sprache' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'DE' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'EN' }));

    expect(await screen.findByRole('group', { name: 'Language' })).toBeInTheDocument();
    expect(i18n.language).toBe('en');
    expect(localStorage.getItem('hb-locale')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the language when the pressed button is clicked again', async () => {
    render(<LanguageToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    await screen.findByRole('group', { name: 'Language' });
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));

    expect(i18n.language).toBe('en');
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');
  });
});
