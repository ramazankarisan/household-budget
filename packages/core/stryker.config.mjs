import { resolve } from 'node:path';

const FIXTURES_DIR = resolve(import.meta.dirname, '..', '..', 'fixtures');

/**
 * Mutation testing for core: Stryker changes the source one small edit at a time (`<` to
 * `<=`, `+` to `-`, a condition to `true`) and reruns the tests. A mutant the tests still
 * pass on is a behaviour nobody asserts.
 *
 * Core only, because core is where a silent off-by-one costs money, and because its suite
 * runs in milliseconds with no server or database. Minutes per run, so it is not in
 * `pnpm check` — run `pnpm mutation` before touching the parser or the budget math, and
 * open reports/mutation/index.html for the survivors. docs/plans/09.
 */
export default {
  /*
   * The command runner, not @stryker-mutator/vitest-runner: under Vitest 5 that plugin
   * never activates a mutant, so every mutant "survives" — an empty `matchRule` body
   * included — and the score is fiction. The command runner hands each mutant to the
   * instrumented code through an environment variable and reruns the suite. Slower (no
   * per-test coverage), honest. Revisit when the plugin supports Vitest 5.
   */
  testRunner: 'command',
  /*
   * FIXTURES_DIR because the sandbox is a copy of this package two folders deeper than the
   * package itself, so a test's `../../../../fixtures/…` would miss the repo's fixtures/.
   * vitest.config.ts resolves every fixtures import through it.
   */
  commandRunner: {
    command: `FIXTURES_DIR=${FIXTURES_DIR} pnpm exec vitest run --bail=1 --reporter=dot`,
  },
  mutate: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
    '!src/csv/index.ts',
    '!src/api.ts',
  ],
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  // Break is a ratchet like the coverage thresholds: just under the score it was set at.
  thresholds: { high: 90, low: 80, break: 81 },
  tempDirName: '.stryker-tmp',
  // Each worker is a whole Vitest process; the default (one per core) runs out of memory.
  concurrency: 4,
};
