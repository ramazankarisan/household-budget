import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';

import { HouseholdProvider } from './household/HouseholdProvider';
import { ImportsPage } from './pages/ImportsPage';
import { OverviewPage } from './pages/OverviewPage';
import { RulesPage } from './pages/RulesPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { AccountsList } from './shell/AccountsList';
import { AppShell } from './shell/AppShell';
import { CATEGORY_PARAM } from './shell/useMonth';
import { UNCATEGORIZED } from './filter';

/** `/budgets` was the report before Überblick answered it; old links land there, month kept. */
function BudgetsRedirect() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/', search }} replace />;
}

/**
 * `/inbox` was Sortieren, dropped after review: its links land on the list's own
 * „Ohne Kategorie“ filter, month kept.
 */
function InboxRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set(CATEGORY_PARAM, UNCATEGORIZED);
  return <Navigate to={{ pathname: '/transactions', search: `?${params.toString()}` }} replace />;
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
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/inbox" element={<InboxRedirect />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/imports" element={<ImportsPage />} />
            <Route path="/budgets" element={<BudgetsRedirect />} />
            {/* An address no page answers lands on Überblick rather than an empty frame. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      </HouseholdProvider>
    </BrowserRouter>
  );
}
