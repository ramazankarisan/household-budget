import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * apps/api, whether this module runs from src/config (dev, tests, prisma.config.ts)
 * or from dist/config (build output) — both sit two levels below the package root.
 * Resolving from here instead of process.cwd() keeps the default database in
 * apps/api/data even when the process starts at the repo root.
 */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Single source of truth for prisma.config.ts and PrismaService. */
export const DEFAULT_DATABASE_URL = `file:${resolve(packageRoot, 'data', 'budget.db')}`;

/** An empty DATABASE_URL (a copied .env with a blank value) falls back to the default. */
export function resolveDatabaseUrl(): string {
  const url = process.env['DATABASE_URL']?.trim();
  return url === undefined || url === '' ? DEFAULT_DATABASE_URL : url;
}
