import { BrowserRouter, Route, Routes } from 'react-router';

import { AccountPage } from './pages/AccountPage';
import { RulesPage } from './pages/RulesPage';

/**
 * Two routes. The third — reporting — is the remaining third of the product, and is a
 * page rather than a tab on either of these for the same reason.
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AccountPage />} />
        <Route path="/rules" element={<RulesPage />} />
      </Routes>
    </BrowserRouter>
  );
}
