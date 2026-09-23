import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { NavLink } from 'react-router';

import { budgetsText } from '../i18n/budgets';
import { rulesText } from '../i18n/rules';

/**
 * The app's navigation. Three links, because the product is import → categorize →
 * report, and each of those is a page of its own.
 */
export function Nav() {
  const text = rulesText();

  return (
    <Stack component="nav" direction="row" spacing={2} sx={{ alignItems: 'center' }}>
      <NavItem to="/" label={text.navTransactions} />
      <NavItem to="/rules" label={text.navRules} />
      <NavItem to="/budgets" label={budgetsText().navBudgets} />
    </Stack>
  );
}

function NavItem({ to, label }: { readonly to: string; readonly label: string }) {
  return (
    <NavLink to={to} end style={{ textDecoration: 'none' }}>
      {({ isActive }) => (
        <Typography
          variant="body1"
          // aria-current is NavLink's own, on the anchor; the weight is for everyone else.
          sx={{
            fontWeight: isActive ? 600 : 400,
            color: isActive ? 'primary.main' : 'text.secondary',
          }}
        >
          {label}
        </Typography>
      )}
    </NavLink>
  );
}
