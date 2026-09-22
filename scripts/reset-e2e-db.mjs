#!/usr/bin/env node
/**
 * Gives the Playwright run a database of its own, starting empty.
 *
 * The e2e suite creates an account and asserts that a second upload of the same file
 * imports zero rows. Both facts depend on starting from nothing: `Account.iban` is
 * `@unique`, so a leftover account makes the second run's creation conflict, and a
 * leftover import makes "0 imported" true on the *first* upload of the next run — the
 * suite would then pass while proving nothing.
 *
 * .mjs because the root package is "type": "commonjs" while the workspace packages are ESM.
 */
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api');

// Kept in step with webServer.env in apps/web/playwright.config.ts.
const DATABASE_URL = 'file:./data/e2e.db';
const databaseFile = resolve(apiRoot, 'data', 'e2e.db');

for (const suffix of ['', '-journal', '-wal', '-shm']) {
  rmSync(`${databaseFile}${suffix}`, { force: true });
}

// --url rather than the environment: prisma.config.ts loads apps/api/.env, and only an
// explicit flag cannot be overridden by it.
execFileSync('pnpm', ['exec', 'prisma', 'db', 'push', '--url', DATABASE_URL], {
  cwd: apiRoot,
  stdio: 'inherit',
});
