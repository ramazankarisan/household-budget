import { BrowserRouter, Route, Routes } from 'react-router';

import { AccountPage } from './pages/AccountPage';
import { BudgetsPage } from './pages/BudgetsPage';
import { RulesPage } from './pages/RulesPage';
import { AppShell } from './shell/AppShell';

/**
 * Three routes, one per third of the product: import, categorize, report. Each is a page
 * rather than a tab on another, because each loads what it needs and nothing else.
 */
export function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<AccountPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/budgets" element={<BudgetsPage />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
