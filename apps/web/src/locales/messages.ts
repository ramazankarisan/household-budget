/** The languages the UI speaks. German is the default and the fallback. */
export const LOCALES = ['de', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * The shape a translation has to have: the same keys as the German source, every leaf a
 * string. `en` is typed with this, so a key missing from it — or one it has that German
 * does not — is a compile error rather than a key printed on screen.
 */
export type Messages<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : Messages<T[K]>;
};

/**
 * i18next types `language` and `resolvedLanguage` as `string | undefined`. Anything that
 * is not English is German, which is also what i18next falls back to.
 */
export function toLocale(lng: string | undefined): Locale {
  return lng === 'en' ? 'en' : 'de';
}
