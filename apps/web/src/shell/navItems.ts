import InboxRounded from '@mui/icons-material/InboxRounded';
import ReceiptLongRounded from '@mui/icons-material/ReceiptLongRounded';
import SpaceDashboardRounded from '@mui/icons-material/SpaceDashboardRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import { type SvgIconComponent } from '@mui/icons-material';

import { uncategorizedRows } from '../filter';
import { useHousehold } from '../household/context';

export interface NavItem {
  readonly to: string;
  readonly labelKey:
    'common.nav.overview' | 'common.nav.transactions' | 'common.nav.inbox' | 'common.nav.rules';
  readonly Icon: SvgIconComponent;
  /** A number of things to do there; hidden at zero. */
  readonly badge?: number | undefined;
}

/**
 * The nav, once, for all three layouts (sidebar, rail, bottom bar), so they cannot drift.
 * Order is the product's: import → categorize → report reads best as overview first.
 */
export function useNavItems(): readonly NavItem[] {
  const { transactions } = useHousehold();
  // The same function the list's chip and the Überblick callout count with.
  const unsorted = uncategorizedRows(transactions ?? []).length;
  return [
    { to: '/', labelKey: 'common.nav.overview', Icon: SpaceDashboardRounded },
    { to: '/transactions', labelKey: 'common.nav.transactions', Icon: ReceiptLongRounded },
    { to: '/inbox', labelKey: 'common.nav.inbox', Icon: InboxRounded, badge: unsorted },
    { to: '/rules', labelKey: 'common.nav.rules', Icon: TuneRounded },
  ];
}
