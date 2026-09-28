import MenuBookRounded from '@mui/icons-material/MenuBookRounded';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { LanguageToggle } from '../pages/LanguageToggle';
import { ThemeToggle } from '../pages/ThemeToggle';
import { NavItemLink } from './NavItemLink';
import { useNavItems } from './navItems';

/** The app's name as a mark: the one place Newsreader appears outside a title or a hero. */
export function Brand({ compact = false }: { readonly compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', px: compact ? 0 : 1.25 }}>
      <Box
        aria-hidden
        sx={{
          width: 30,
          height: 30,
          borderRadius: 2,
          backgroundColor: 'primary.main',
          color: 'primary.contrastText',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <MenuBookRounded fontSize="small" />
      </Box>
      {compact ? null : (
        <Typography
          component="span"
          sx={{ fontFamily: 'h1.fontFamily', typography: 'h6', fontWeight: 500 }}
        >
          {t('common.appTitle')}
        </Typography>
      )}
    </Stack>
  );
}

/** ≥ 1024 px: name, nav, whatever the phase puts in `extra`, and the preferences. */
export function Sidebar({ extra }: { readonly extra?: ReactNode }) {
  const { t } = useTranslation();
  const items = useNavItems();

  return (
    <Box
      component="nav"
      aria-label={t('common.navLabel')}
      sx={{
        width: 232,
        flexShrink: 0,
        boxSizing: 'border-box',
        position: 'sticky',
        top: 0,
        height: '100vh',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        px: 1.75,
        py: 2.5,
        backgroundColor: 'background.paper',
        borderRight: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box sx={{ pb: 2.5 }}>
        <Brand />
      </Box>
      {items.map((item) => (
        <NavItemLink key={item.to} item={item}>
          {({ isActive, label, icon }) => (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                height: 40,
                px: 1.25,
                borderRadius: 1,
                typography: 'body1',
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'primary.main' : 'text.secondary',
                backgroundColor: isActive ? 'primary.soft' : 'transparent',
                '&:hover': { backgroundColor: isActive ? 'primary.soft' : 'background.subtle' },
              }}
            >
              {icon}
              <span>{label}</span>
            </Box>
          )}
        </NavItemLink>
      ))}
      <Box sx={{ flexGrow: 1 }} />
      {extra}
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}
      >
        <LanguageToggle />
        <Box sx={{ flexGrow: 1 }} />
        <ThemeToggle />
      </Stack>
    </Box>
  );
}
