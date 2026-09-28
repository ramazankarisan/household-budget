import { defineConfig } from 'vitest/config';

export default defineConfig({
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
      reporter: ['text-summary', 'html'],
      thresholds: { statements: 95, branches: 87, functions: 97, lines: 95 },
    },
  },
});
