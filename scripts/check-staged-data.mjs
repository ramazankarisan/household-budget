#!/usr/bin/env node
/**
 * Blocks real household data from entering git history.
 *
 * CLAUDE.md RULES: "Never commit real bank data. Test data is synthetic and lives in
 * fixtures/." .gitignore covers the obvious cases, but a `git add -f`, a renamed export or a
 * path the ignore rules do not anticipate all get through. This runs on the staged set, which
 * is the last point where a mistake is still free to undo.
 *
 * Exits 1 and names every offender. Never rewrites the index — fixing is the human's call.
 */
import { execFileSync } from 'node:child_process';

/** fixtures/ at any depth, not just the repo root. */
const isFixture = (p) => /(^|\/)fixtures\//.test(p);

/** Each rule explains itself, because a hook that just says "blocked" gets bypassed. */
const RULES = [
  {
    // Banks export OFX/QFX/QIF and spreadsheets as readily as CSV.
    test: (p) => /\.(csv|ofx|qfx|qif|xls|xlsx)$/i.test(p) && !isFixture(p),
    reason:
      'bank export outside fixtures/ — real statements never get committed. Synthetic test data goes in fixtures/.',
  },
  {
    test: (p) => /(^|\/)\.env$/.test(p) || (/(^|\/)\.env\./.test(p) && !p.endsWith('.env.example')),
    reason: 'environment file — only .env.example belongs in git.',
  },
  {
    test: (p) => /\.(db|db-journal|db-wal|db-shm|sqlite|sqlite3)$/i.test(p),
    reason: 'database file — the SQLite budget database stays local.',
  },
];

function stagedFiles() {
  /*
   * -z because a real statement is quite likely to be named "Statement Jan 2026.csv", and
   * without it git escapes and quotes such paths. --diff-filter includes R: renaming a bank
   * export into the repo is exactly the case worth catching.
   */
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], {
    encoding: 'utf8',
  });
  return out.split('\0').filter(Boolean);
}

const offenders = [];
for (const file of stagedFiles()) {
  const rule = RULES.find((r) => r.test(file));
  if (rule) {
    offenders.push(`  ${file}\n    ${rule.reason}`);
  }
}

if (offenders.length > 0) {
  console.error(`\nBlocked ${offenders.length} staged file(s):\n`);
  console.error(offenders.join('\n'));
  console.error('\nUnstage them with `git restore --staged <file>`.');
  console.error('If a file is genuinely synthetic test data, put it under fixtures/.');
  // Name the narrow bypass, so nobody reaches for --no-verify and disables the secret scan too.
  console.error('To override this one gate: `LEFTHOOK_EXCLUDE=data-guard git commit ...`\n');
  process.exit(1);
}
