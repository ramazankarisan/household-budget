import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * A throwaway SQLite file under `data/`, which is git-ignored. Not the development
 * database: these tests truncate every table between cases.
 */
export const TEST_DATABASE_FILE = resolve(packageRoot, 'data', 'test.db');
export const TEST_DATABASE_URL = `file:${TEST_DATABASE_FILE}`;

/**
 * Creates the schema once, before any test worker starts.
 *
 * The import's whole behaviour — the unique index covering soft-deleted rows, SQLite
 * treating NULL dedup keys as distinct — lives in the queries, so a mocked Prisma would
 * test nothing here. `DATABASE_URL` is set in `vitest.config.ts` rather than here
 * because `resolveDatabaseUrl()` is read when `PrismaService` is constructed.
 */
export default function setup(): void {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    rmSync(`${TEST_DATABASE_FILE}${suffix}`, { force: true });
  }

  // --url rather than the environment: prisma.config.ts loads apps/api/.env, and an
  // explicit flag is the one thing that cannot be overridden by it. The suite must
  // never touch the developer's own budget database.
  execFileSync('pnpm', ['exec', 'prisma', 'db', 'push', '--url', TEST_DATABASE_URL], {
    cwd: packageRoot,
    stdio: 'pipe',
  });
}
