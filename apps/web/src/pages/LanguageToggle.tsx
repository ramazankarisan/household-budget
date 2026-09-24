import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { useTranslation } from 'react-i18next';

import { LOCALES, toLocale } from '../locales/messages';

/**
 * `DE|EN`. The language is i18next's own state — changing it re-renders every
 * `useTranslation()` consumer, and `locales/i18n.ts` stores it and sets `<html lang>`.
 */
export function LanguageToggle() {
  const { t, i18n } = useTranslation();

  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      aria-label={t('common.language.label')}
      value={toLocale(i18n.resolvedLanguage)}
      onChange={(_event, next: string | null) => {
        // Clicking the pressed button deselects it; a language is always chosen.
        if (next !== null) {
          void i18n.changeLanguage(next);
        }
      }}
    >
      {LOCALES.map((locale) => (
        <ToggleButton key={locale} value={locale} sx={{ px: 1.25, py: 0.25 }}>
          {t(`common.language.${locale}`)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
