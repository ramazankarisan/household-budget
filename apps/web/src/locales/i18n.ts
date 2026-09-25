import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { de } from './de';
import { en } from './en';
import { type Locale, LOCALES, toLocale } from './messages';

/** Where the chosen language is kept between visits. Absent means a first visit: German. */
export const LOCALE_STORAGE_KEY = 'hb-locale';

/** The stored language, or `undefined` when there is none — or storage is unavailable. */
export function storedLocale(): Locale | undefined {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored === null ? undefined : toLocale(stored);
  } catch {
    return undefined;
  }
}

/*
 * Synchronous: the resources are bundled objects, not files to load, so the first render
 * already has its words — no flash, and no async in tests.
 */
void i18next.use(initReactI18next).init({
  resources: { de: { translation: de }, en: { translation: en } },
  lng: storedLocale() ?? 'de',
  fallbackLng: 'de',
  supportedLngs: LOCALES,
  // React escapes; escaping here too would print `„Wohnen“` as entities.
  interpolation: { escapeValue: false },
  initAsync: false,
});

i18next.on('languageChanged', (lng) => {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, toLocale(lng));
  } catch {
    // Private mode or blocked storage: the switch still works for this visit.
  }
  document.documentElement.lang = toLocale(lng);
});

document.documentElement.lang = toLocale(i18next.language);

export default i18next;
