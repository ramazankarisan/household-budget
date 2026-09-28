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

import { isBankExport, isDatabaseFile, isEnvFile } from './data-patterns.mjs';

/** Each rule explains itself, because a hook that just says "blocked" gets bypassed. */
const RULES = [
  {
    // Banks export OFX/QFX/QIF and spreadsheets as readily as CSV.
    test: isBankExport,
    reason:
      'bank export outside fixtures/ — real statements never get committed. Synthetic test data goes in fixtures/.',
  },
  {
    test: isEnvFile,
    reason: 'environment file — only .env.example belongs in git.',
  },
  {
    test: isDatabaseFile,
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

/**
 * `--all` checks every tracked file instead of the staged set. CI runs it that way: a hook
 * can be skipped with `LEFTHOOK=0` or beaten with `git add -f`, and what reached the
 * repository is what matters there.
 */
function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
}

const files = process.argv.includes('--all') ? trackedFiles() : stagedFiles();

const offenders = [];
for (const file of files) {
  const rule = RULES.find((r) => r.test(file));
  if (rule) {
    offenders.push(`  ${file}\n    ${rule.reason}`);
  }
}

if (offenders.length > 0) {
  console.error(`\nBlocked ${offenders.length} file(s):\n`);
  console.error(offenders.join('\n'));
  console.error('\nUnstage them with `git restore --staged <file>`.');
  console.error('If a file is genuinely synthetic test data, put it under fixtures/.');
  // Name the narrow bypass, so nobody reaches for --no-verify and disables the secret scan too.
  console.error('To override this one gate: `LEFTHOOK_EXCLUDE=data-guard git commit ...`\n');
  process.exit(1);
}
