import { defineConfig, devices } from '@playwright/test';

/*
 * Ports of their own, not the dev server's 3000 and 5173.
 *
 * `env: { DATABASE_URL }` below only applies to a server Playwright starts itself. On the
 * shared ports, `reuseExistingServer` would hand the suite a running `pnpm dev` instead —
 * an API bound to the real budget.db — and the run would create its account and import its
 * fixtures straight into the developer's own data while wiping an e2e.db nothing was using.
 * Separate ports mean the two never meet, and both can run at once.
 */
const API_PORT = 3100;
const WEB_PORT = 5174;
const API_URL = `http://127.0.0.1:${String(API_PORT)}`;
const WEB_URL = `http://127.0.0.1:${String(WEB_PORT)}`;
// Playwright accepts 200 <= status < 404, and this route answers [] on an empty
// database. Whatever it points at has to exist: an unreachable probe does not fail
// fast, it waits out the 120 s timeout below.
const API_READY_URL = `${API_URL}/api/accounts`;

/** The e2e run gets its own SQLite file — see the note on webServer below. */
const E2E_DATABASE_URL = 'file:./data/e2e.db';

/**
 * End-to-end config for apps/web. Unit tests stay in Vitest (see vite.config.ts) — this
 * covers the one thing Vitest cannot: that core, the API, SQLite and the browser actually
 * talk to each other.
 *
 * Both servers are started here rather than assumed. The test drives :5173 and lets the Vite
 * proxy forward /api, which is the same single-origin path a real browser takes.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? 'dot' : [['list']],

  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
  },

  // Chromium only. This is a smoke test for wiring, not a cross-browser matrix.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: 'pnpm --filter @household-budget/api dev',
      url: API_READY_URL,
      // Never reused: a server on this port is a leftover from an interrupted run, and its
      // handle on the deleted e2e.db would make this run's fixtures land in a file nobody
      // reads afterwards.
      reuseExistingServer: false,
      // nest start --watch compiles before it listens.
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
      /*
       * Its own database, deleted by the test:e2e script before db:push. Without this
       * the suite passes once and then fails: Account.iban is @unique, so the second
       * run's account creation conflicts, and "0 imported on the second upload" becomes
       * true on the *first* upload of run two.
       */
      env: { DATABASE_URL: E2E_DATABASE_URL, PORT: String(API_PORT) },
    },
    {
      // --strictPort: without it Vite silently binds the next free port when this one is
      // taken, and every test then fails against a baseURL nothing is listening on.
      // --host 127.0.0.1: Vite otherwise binds only [::1], which the readiness probe and
      // the browser reach by that address alone.
      command:
        `pnpm --filter @household-budget/web exec vite --host 127.0.0.1 ` +
        `--port ${String(WEB_PORT)} --strictPort`,
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
      // Points this Vite at the e2e API rather than the dev one on :3000.
      env: { API_TARGET: API_URL },
    },
  ],
});
