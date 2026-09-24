import '@testing-library/jest-dom/vitest';

import { afterEach } from 'vitest';

import i18n from '../locales/i18n';

// Every test starts German, the default a first visit gets, with nothing stored.
afterEach(async () => {
  await i18n.changeLanguage('de');
  localStorage.clear();
});
