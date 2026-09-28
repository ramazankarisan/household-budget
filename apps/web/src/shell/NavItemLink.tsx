import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router';

import { type NavItem } from './navItems';
import { monthSearch } from './useMonth';

interface NavItemLinkProps {
  readonly item: NavItem;
  readonly children: (state: {
    readonly isActive: boolean;
    readonly label: string;
    readonly icon: ReactNode;
  }) => ReactNode;
  readonly onNavigate?: () => void;
}

/**
 * A nav link that keeps the month: leaving Überblick in September lands on September's
 * transactions. Only `?m` travels — a category filter belongs to the page that set it.
 */
export function NavItemLink({ item, children, onNavigate }: NavItemLinkProps) {
  const { t } = useTranslation();
  const { search } = useLocation();
  const label = t(item.labelKey);
  const badge = item.badge ?? 0;
  const icon = (
    <Badge
      badgeContent={badge}
      color="warning"
      max={999}
      invisible={badge === 0}
      slotProps={{ badge: { 'aria-hidden': true } }}
    >
      <item.Icon fontSize="small" />
    </Badge>
  );

  return (
    <NavLink
      to={{ pathname: item.to, search: monthSearch(search) }}
      end
      onClick={onNavigate}
      aria-label={badge > 0 ? `${label} (${String(badge)})` : undefined}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
    >
      {({ isActive }) => <Box component="span">{children({ isActive, label, icon })}</Box>}
    </NavLink>
  );
}
