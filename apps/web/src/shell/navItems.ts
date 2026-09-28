import ReceiptLongRounded from '@mui/icons-material/ReceiptLongRounded';
import SpaceDashboardRounded from '@mui/icons-material/SpaceDashboardRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import { type SvgIconComponent } from '@mui/icons-material';

export interface NavItem {
  readonly to: string;
  readonly labelKey:
    'common.nav.overview' | 'common.nav.transactions' | 'common.nav.rules' | 'common.nav.budgets';
  readonly Icon: SvgIconComponent;
  /** A number of things to do there; hidden at zero. */
  readonly badge?: number | undefined;
}

/**
 * The nav, once, for all three layouts (sidebar, rail, bottom bar), so they cannot drift.
 * Order is the product's: import → categorize → report reads best as overview first.
 */
export function useNavItems(): readonly NavItem[] {
  return [
    { to: '/', labelKey: 'common.nav.transactions', Icon: ReceiptLongRounded },
    { to: '/rules', labelKey: 'common.nav.rules', Icon: TuneRounded },
    { to: '/budgets', labelKey: 'common.nav.budgets', Icon: SpaceDashboardRounded },
  ];
}
