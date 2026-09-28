import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Drawer from '@mui/material/Drawer';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LanguageToggle } from '../pages/LanguageToggle';
import { ThemeToggle } from '../pages/ThemeToggle';
import { NavItemLink } from './NavItemLink';
import { type NavItem, useNavItems } from './navItems';

/** How many nav items fit on the bar before the rest go into „Mehr“. */
const ON_BAR = 4;

function BarItem({
  item,
  onNavigate,
}: {
  readonly item: NavItem;
  readonly onNavigate?: () => void;
}) {
  return (
    <NavItemLink item={item} {...(onNavigate === undefined ? {} : { onNavigate })}>
      {({ isActive, label, icon }) => (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.25,
            height: 56,
            typography: 'caption',
            fontWeight: 500,
            color: isActive ? 'primary.main' : 'text.secondary',
          }}
        >
          {icon}
          <span>{label}</span>
        </Box>
      )}
    </NavItemLink>
  );
}

/**
 * < 720 px: four items on a bar at the bottom, the rest — and the preferences — in a
 * sheet behind „Mehr“, so nothing the sidebar offers is out of reach on a phone.
 */
export function BottomNav({ extra }: { readonly extra?: ReactNode }) {
  const { t } = useTranslation();
  const items = useNavItems();
  const [open, setOpen] = useState(false);
  const onBar = items.slice(0, ON_BAR);
  const rest = items.slice(ON_BAR);

  return (
    <>
      <Box
        component="nav"
        aria-label={t('common.navLabel')}
        sx={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: (theme) => theme.zIndex.appBar,
          display: 'grid',
          gridTemplateColumns: `repeat(${String(onBar.length + 1)}, minmax(0, 1fr))`,
          pb: 'env(safe-area-inset-bottom)',
          backgroundColor: 'background.paper',
          borderTop: '1px solid',
          borderColor: 'divider',
        }}
      >
        {onBar.map((item) => (
          <BarItem key={item.to} item={item} />
        ))}
        <ButtonBase
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            setOpen(true);
          }}
          sx={{
            flexDirection: 'column',
            gap: 0.25,
            height: 56,
            typography: 'caption',
            fontWeight: 500,
            color: 'text.secondary',
          }}
        >
          <MoreHorizRounded fontSize="small" />
          <span>{t('common.nav.more')}</span>
        </ButtonBase>
      </Box>
      <Drawer
        anchor="bottom"
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        slotProps={{ paper: { sx: { borderRadius: '10px 10px 0 0', p: 2 } } }}
      >
        <Stack spacing={2} aria-label={t('common.nav.more')}>
          <Typography variant="h2" component="h2">
            {t('common.nav.more')}
          </Typography>
          {rest.map((item) => (
            <BarItem
              key={item.to}
              item={item}
              onNavigate={() => {
                setOpen(false);
              }}
            />
          ))}
          {extra}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <LanguageToggle />
            <Box sx={{ flexGrow: 1 }} />
            <ThemeToggle />
          </Stack>
        </Stack>
      </Drawer>
    </>
  );
}
