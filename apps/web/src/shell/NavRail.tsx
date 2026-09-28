import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import { useTranslation } from 'react-i18next';

import { ThemeToggle } from '../pages/ThemeToggle';
import { NavItemLink } from './NavItemLink';
import { useNavItems } from './navItems';
import { Brand } from './Sidebar';

/** 720–1023 px: the sidebar's nav as a 64 px column of icons, each named by a tooltip. */
export function NavRail() {
  const { t } = useTranslation();
  const items = useNavItems();

  return (
    <Box
      component="nav"
      aria-label={t('common.navLabel')}
      sx={{
        width: 64,
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.5,
        py: 2.5,
        backgroundColor: 'background.paper',
        borderRight: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box sx={{ pb: 2.5 }}>
        <Brand compact />
      </Box>
      {items.map((item) => (
        <NavItemLink key={item.to} item={item}>
          {({ isActive, label, icon }) => (
            <Tooltip title={label} placement="right">
              <Box
                aria-label={label}
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isActive ? 'primary.main' : 'text.secondary',
                  backgroundColor: isActive ? 'primary.soft' : 'transparent',
                  '&:hover': { backgroundColor: isActive ? 'primary.soft' : 'background.subtle' },
                }}
              >
                {icon}
              </Box>
            </Tooltip>
          )}
        </NavItemLink>
      ))}
      <Box sx={{ flexGrow: 1 }} />
      <Stack sx={{ alignItems: 'center' }}>
        <ThemeToggle />
      </Stack>
    </Box>
  );
}
