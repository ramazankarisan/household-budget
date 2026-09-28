import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';

import { HouseholdProvider } from './household/HouseholdProvider';
import { AccountPage } from './pages/AccountPage';
import { InboxPage } from './pages/InboxPage';
import { OverviewPage } from './pages/OverviewPage';
import { RulesPage } from './pages/RulesPage';
import { AccountsList } from './shell/AccountsList';
import { AppShell } from './shell/AppShell';

/** `/budgets` was the report before Überblick answered it; old links land there, month kept. */
function BudgetsRedirect() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/', search }} replace />;
}

/**
 * One route per question (plan 08): how is the month going, what happened, and what the
 * rules do with it. Every page reads the same household, loaded once.
 */
export function App() {
  return (
    <BrowserRouter>
      <HouseholdProvider>
        <AppShell sidebarExtra={<AccountsList />}>
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/transactions" element={<AccountPage />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/budgets" element={<BudgetsRedirect />} />
          </Routes>
        </AppShell>
      </HouseholdProvider>
    </BrowserRouter>
  );
}
