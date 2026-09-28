#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook for Bash: refuses the shell commands that would switch off this
 * repo's gates or reach the user's real data.
 *
 * The git hooks (lefthook.yml) only protect the repo if nobody skips them, and `--no-verify`
 * or `LEFTHOOK=0` skips all of them at once. A human may still do that in an emergency — the
 * command is theirs to type — but the agent may not.
 *
 * Exit 2 blocks the call; stderr is the reason the agent sees.
 *
 * .mjs because the root package is "type": "commonjs" while the workspace packages are ESM.
 */
import process from 'node:process';
import { text } from 'node:stream/consumers';

const RULES = [
  {
    test: (c) => /\bgit\b[^;&|\n]*\b(commit|push|merge|rebase)\b[^;&|\n]*--no-verify\b/.test(c),
    reason:
      '--no-verify skips every lefthook gate (data guard, gitleaks, format, lint, typecheck, tests). ' +
      'Fix what the gate reports instead; if it is genuinely wrong, tell the user.',
  },
  {
    // `git commit -n` is the short form of --no-verify. Anchored to commit: `-n` means
    // something else for other subcommands.
    test: (c) => /\bgit\b[^;&|\n]*\bcommit\b[^;&|\n]*\s-[a-zA-Z]*n[a-zA-Z]*\b/.test(c),
    reason: '`git commit -n` is --no-verify. Fix what the gate reports instead.',
  },
  {
    test: (c) => /\bLEFTHOOK(_EXCLUDE)?=/.test(c) || /\bcore\.hooksPath\b/.test(c),
    reason:
      'LEFTHOOK=0, LEFTHOOK_EXCLUDE and core.hooksPath switch the git hooks off. CLAUDE.md keeps ' +
      'that bypass for a human in a real emergency, not for the agent.',
  },
  {
    test: (c) =>
      /\bgit\b[^;&|\n]*\badd\b[^;&|\n]*(\s-f\b|--force\b)/.test(c) &&
      /(\.(csv|ofx|qfx|qif|xlsx?|db|sqlite3?)\b|\bdata\/|\.env\b)/i.test(c),
    reason:
      'force-adding an ignored bank export, database or .env gets around .gitignore on purpose. ' +
      'Real data never enters git; synthetic test data goes in fixtures/.',
  },
  {
    // Anything that names the dev database: sqlite3, cat, strings, cp — all of them put the
    // user's bank history in front of the model or somewhere it should not be.
    test: (c) => /\bbudget\.db\b/.test(c) || /\bapps\/api\/data\/(?!(test|e2e)\.db\b)/.test(c),
    reason:
      'apps/api/data/budget.db is the user’s real bank history. Do not read, copy or query it; use ' +
      'a synthetic fixture and the test database (apps/api/data/test.db) instead.',
  },
];

const input = JSON.parse((await text(process.stdin)) || '{}');
const command = input.tool_input?.command;
if (typeof command !== 'string') {
  process.exit(0);
}

// A heredoc body is data — a commit message or a PR description that *mentions* budget.db or
// --no-verify is not a command that uses them. The line that opens the heredoc still counts.
const withoutHeredocs = command.replace(
  /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\n|$)/g,
  '<<heredoc',
);

const hit = RULES.find((rule) => rule.test(withoutHeredocs));
if (hit) {
  process.stderr.write(`Blocked by .claude/hooks/guard-bash.mjs\n${hit.reason}\n`);
  process.exit(2);
}
