import 'i18next';

import { type de } from './de';

/** Makes `t()` keys checked against the German source: `t('no.such.key')` fails typecheck. */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof de };
  }
}
