import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { LanguageToggle } from './LanguageToggle';
import { Nav } from './Nav';
import { ThemeToggle } from './ThemeToggle';

/**
 * The one header every page renders: title and nav on the left, the preferences on the
 * right. Shared so a control cannot appear on one page and push the others around.
 */
export function AppHeader() {
  const { t } = useTranslation();

  return (
    <Stack
      direction="row"
      spacing={2}
      useFlexGap
      sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
    >
      <Stack direction="row" spacing={3} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Typography variant="h4" component="h1">
          {t('common.appTitle')}
        </Typography>
        <Nav />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', ml: 'auto' }}>
        <LanguageToggle />
        <ThemeToggle />
      </Stack>
    </Stack>
  );
}
