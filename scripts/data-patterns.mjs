/**
 * The one definition of "the user's data" in this repo's tooling.
 *
 * Read by the commit gate (scripts/check-staged-data.mjs) and by the Claude Code hooks
 * (.claude/hooks/). They used to keep a list each, and the lists had already drifted apart;
 * a new export format added here reaches every gate at once.
 *
 * Paths are repo-relative with forward slashes. Every pattern matches at any depth, so a
 * path inside a nested checkout (`.claude/worktrees/x/…`) is judged like the same path at
 * the root.
 *
 * .mjs because the root package is "type": "commonjs" while the workspace packages are ESM.
 */

/** fixtures/ at any depth — the only place synthetic bank files may live. */
export const isFixture = (p) => /(^|\/)fixtures\//.test(p);

/** Extensions banks export statements in: CSV, but OFX/QFX/QIF and spreadsheets as readily. */
export const BANK_EXPORT_EXTENSIONS = ['csv', 'ofx', 'qfx', 'qif', 'xls', 'xlsx'];

/** A bank export outside fixtures/ — a real statement until proven otherwise. */
export const isBankExport = (p) =>
  new RegExp(`\\.(${BANK_EXPORT_EXTENSIONS.join('|')})$`, 'i').test(p) && !isFixture(p);

/** `.env` and `.env.*`, except the committed template. */
export const isEnvFile = (p) =>
  /(^|\/)\.env$/.test(p) || (/(^|\/)\.env\./.test(p) && !p.endsWith('.env.example'));

/** SQLite files and their sidecars. */
export const isDatabaseFile = (p) => /\.(db|db-journal|db-wal|db-shm|sqlite|sqlite3)$/i.test(p);

/**
 * The databases the test suites create and delete (apps/api/vitest.config.ts,
 * scripts/reset-e2e-db.mjs). Synthetic by construction — every other database is the user's.
 */
export const isThrowawayDatabase = (p) => /(^|\/)(test|e2e)\.db(-journal|-wal|-shm)?$/.test(p);

/** apps/api/data — where the user's own budget.db lives. */
export const isLocalDataPath = (p) => /(^|\/)apps\/api\/data(\/|$)/.test(p);
