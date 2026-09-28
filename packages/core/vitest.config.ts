import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * The repo's fixtures/. Tests import them by relative path; Stryker runs the suite in a
 * sandbox copy two folders deeper and passes the real location in FIXTURES_DIR.
 */
const FIXTURES_DIR =
  process.env['FIXTURES_DIR'] ?? resolve(import.meta.dirname, '..', '..', 'fixtures');

export default defineConfig({
  resolve: {
    alias: [{ find: /^(?:\.\.\/)+fixtures\//u, replacement: `${FIXTURES_DIR}/` }],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /*
     * Enforced only under `--coverage` (`pnpm test:coverage`, which `pnpm check` runs).
     * Thresholds sit just under what the suite measured when they were set — a ratchet,
     * not a target: raise them when coverage rises, never lower them to make a change
     * pass. Core carries the money math, so it holds the highest bar. docs/plans/09.
     */
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reporter: ['text-summary'],
      thresholds: { statements: 95, branches: 87, functions: 97, lines: 95 },
    },
  },
});
