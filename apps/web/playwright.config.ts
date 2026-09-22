import { defineConfig, devices } from '@playwright/test';

const WEB_URL = 'http://localhost:5173';
const API_READY_URL = 'http://localhost:3000/api/hello';

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
      reuseExistingServer: !process.env['CI'],
      // nest start --watch compiles before it listens.
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // --strictPort: without it Vite silently binds 5174 when 5173 is taken, and every
      // test then fails against a baseURL nothing is listening on.
      command: 'pnpm --filter @household-budget/web exec vite --port 5173 --strictPort',
      url: WEB_URL,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
