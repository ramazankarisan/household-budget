import '@testing-library/jest-dom/vitest';

import { afterEach } from 'vitest';

import i18n from '../locales/i18n';

// Every test starts German, the default a first visit gets, with nothing stored.
afterEach(async () => {
  await i18n.changeLanguage('de');
  localStorage.clear();
});

/*
 * jsdom has no layout and no `ResizeObserver`. A chart without a fixed width measures its
 * container with one; this stub lets it mount (at zero size) instead of throwing.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
