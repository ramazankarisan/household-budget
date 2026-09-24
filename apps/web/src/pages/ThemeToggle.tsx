import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import IconButton from '@mui/material/IconButton';
import { useColorScheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

/**
 * Light ↔ dark, on MUI's own colour-scheme state — which is also what stores the choice
 * (`localStorage['mui-mode']`) and what follows the OS until the first click.
 *
 * The button shows the scheme a click goes *to*. It renders nothing while `mode` is
 * unknown: before MUI's mount effect has run, and outside a `ThemeProvider` altogether,
 * where `useColorScheme()` is a no-op.
 */
export function ThemeToggle() {
  const { t } = useTranslation();
  const { mode, systemMode, setMode } = useColorScheme();
  if (mode === undefined) {
    return null;
  }
  const dark = (mode === 'system' ? systemMode : mode) === 'dark';

  return (
    <IconButton
      aria-label={dark ? t('common.theme.toLight') : t('common.theme.toDark')}
      onClick={() => {
        setMode(dark ? 'light' : 'dark');
      }}
    >
      {dark ? <LightModeIcon /> : <DarkModeIcon />}
    </IconButton>
  );
}
