import { BrowserRouter, Route, Routes } from 'react-router';

import { AccountPage } from './pages/AccountPage';

/**
 * One route today. The router is here because the product is import → categorize →
 * report, and the next two are pages rather than tabs on this one.
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AccountPage />} />
      </Routes>
    </BrowserRouter>
  );
}
