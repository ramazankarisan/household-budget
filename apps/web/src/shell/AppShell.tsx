import Box from '@mui/material/Box';
import useMediaQuery from '@mui/material/useMediaQuery';
import { type ReactNode } from 'react';

import { BottomNav } from './BottomNav';
import { NavRail } from './NavRail';
import { Sidebar } from './Sidebar';

/** DESIGN.md §3: sidebar from 1024 px, icon rail from 720 px, bottom bar below. */
export const WIDE = '(min-width:1024px)';
export const MEDIUM = '(min-width:720px)';

/**
 * Every page's frame. The layouts are picked by media query rather than CSS alone so each
 * renders exactly one `nav` landmark — three hidden navs would be three for a screen
 * reader. `noSsr`: the app only renders in the browser, so the first render already knows
 * the width and never flashes the wrong layout.
 */
export function AppShell({
  children,
  sidebarExtra,
}: {
  readonly children: ReactNode;
  /** What the sidebar (and „Mehr“) shows above the preferences — the accounts, from phase 2. */
  readonly sidebarExtra?: ReactNode;
}) {
  const wide = useMediaQuery(WIDE, { noSsr: true });
  const medium = useMediaQuery(MEDIUM, { noSsr: true });

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: 'background.default' }}>
      {wide ? <Sidebar extra={sidebarExtra} /> : medium ? <NavRail /> : null}
      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, pb: medium ? 0 : 10 }}>
        <Box
          sx={{
            maxWidth: 1200,
            mx: 'auto',
            px: { xs: 2, md: 4 },
            pt: { xs: 2, md: 3.5 },
            pb: { xs: 2, md: 5 },
          }}
        >
          {children}
        </Box>
      </Box>
      {medium ? null : <BottomNav extra={sidebarExtra} />}
    </Box>
  );
}
