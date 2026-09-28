#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook for Bash: refuses the shell commands that would switch off this
 * repo's gates or reach the user's real data.
 *
 * The git hooks (lefthook.yml) only protect the repo if nobody skips them, and `--no-verify`
 * or `LEFTHOOK=0` skips all of them at once. A human may still do that in an emergency — the
 * command is theirs to type — but the agent may not.
 *
 * Pattern matching over shell text makes accidents hard, not bypasses impossible: a command
 * built at runtime (`$(echo --no-ver)ify`) gets through. It is a guard rail; the git hooks,
 * and CI running `pnpm check:all` on every PR, remain the gate.
 *
 * Exit 2 blocks the call; stderr is the reason the agent sees.
 *
 * .mjs because the root package is "type": "commonjs" while the workspace packages are ESM.
 */
import process from 'node:process';
import { text } from 'node:stream/consumers';

import { BANK_EXPORT_EXTENSIONS } from '../../scripts/data-patterns.mjs';

/** One shell command up to the next separator. */
const SEGMENT = String.raw`[^;&|\n]*`;

/**
 * Programs that execute what they read on stdin. A heredoc fed to one of these is code, so
 * its body is checked like the command line; fed to anything else (`git commit -F -`, `cat`,
 * `gh pr create --body-file -`) it is text and may mention whatever it likes.
 */
const INTERPRETER =
  /(^|[\s|;&(])(sh|bash|zsh|fish|dash|python3?|node|deno|bun|ruby|perl|php|sqlite3|psql|mysql|osascript|eval|xargs)(?=\s|$)/;

const EXPORT_OR_DATA = new RegExp(
  String.raw`(\.(${[...BANK_EXPORT_EXTENSIONS, 'db', 'sqlite3?'].join('|')})\b|(^|[\s/'"])data([\s/'"]|$)|\.env\b)`,
  'i',
);

/** A path-like word that reaches the user's data: apps/api/data, budget.db, or a *.db glob. */
function namesUserData(command) {
  const words = command.split(/[\s'"=<>()]+/).filter(Boolean);
  return words.some((word) => {
    if (/(^|\/)(test|e2e)\.db(-journal|-wal|-shm)?$/.test(word)) return false;
    return (
      /\bbudget\.db/.test(word) ||
      /(^|\/)apps\/api\/data(\/|$)/.test(word) ||
      // From inside apps/api: `data/…`. Not the bare word, which a commit message may use.
      /^\.?\/?data\/./.test(word) ||
      // A glob that would expand to the database.
      /\*[^/\s]*\.(db|sqlite3?)\b|\.db\*/.test(word)
    );
  });
}

const RULES = [
  {
    // git accepts any unambiguous prefix of a long option, so `--no-veri` is --no-verify too.
    // `--no-verbose` is the only other --no-ver… option and stays allowed.
    test: (c) =>
      new RegExp(
        String.raw`\bgit\b${SEGMENT}\b(commit|push|merge|rebase|cherry-pick|revert|am)\b${SEGMENT}\s--no-ver(?!b)[a-z]*\b`,
      ).test(c) ||
      new RegExp(String.raw`\bgit\b${SEGMENT}\bcommit\b${SEGMENT}\s-[a-zA-Z]*n[a-zA-Z]*\b`).test(c),
    reason:
      '--no-verify (or `commit -n`) skips every lefthook gate: data guard, gitleaks, format, lint, ' +
      'typecheck, tests. Fix what the gate reports instead; if it is genuinely wrong, tell the user.',
  },
  {
    test: (c) =>
      /\bLEFTHOOK(_EXCLUDE)?=/.test(c) ||
      /\bcore\.hooksPath\b/.test(c) ||
      /\blefthook\s+uninstall\b/.test(c) ||
      new RegExp(String.raw`\b(rm|mv|cp|chmod|ln|truncate|unlink)\b${SEGMENT}\.git/hooks`).test(
        c,
      ) ||
      /[^<]>{1,2}\s*\S*\.git\/hooks/.test(c),
    reason:
      'LEFTHOOK=0, LEFTHOOK_EXCLUDE, core.hooksPath, `lefthook uninstall` and editing .git/hooks all ' +
      'switch the git hooks off. CLAUDE.md keeps that bypass for a human in a real emergency.',
  },
  {
    test: (c) =>
      new RegExp(String.raw`\bgit\b${SEGMENT}\badd\b${SEGMENT}(\s-[a-zA-Z]*f\b|--force\b)`).test(
        c,
      ) && EXPORT_OR_DATA.test(c),
    reason:
      'force-adding an ignored bank export, database, data/ or .env gets around .gitignore on ' +
      'purpose. Real data never enters git; synthetic test data goes in fixtures/.',
  },
  {
    // sqlite3, cat, strings, cp, a Python one-liner — anything that names the dev database puts
    // the user's bank history in front of the model or somewhere it should not be.
    test: namesUserData,
    reason:
      'apps/api/data/ holds the user’s real bank history (budget.db). Do not read, copy or query it; ' +
      'use a synthetic fixture and the test database (apps/api/data/test.db) instead.',
  },
];

/**
 * The command as the rules see it: a heredoc body that is only text is dropped, one that an
 * interpreter will run is kept. The line that opens a heredoc always stays, including
 * anything after the `<<EOF` on it.
 */
function visibleCommand(command) {
  const lines = command.split('\n');
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    kept.push(line);
    const opener = /<<-?\s*(['"]?)(\w+)\1/.exec(line);
    if (opener === null) continue;
    const end = lines.findIndex((l, j) => j > i && l.trim() === opener[2]);
    if (end === -1) continue;
    if (INTERPRETER.test(line)) {
      kept.push(...lines.slice(i + 1, end));
    }
    i = end;
  }
  return kept.join('\n');
}

const input = JSON.parse((await text(process.stdin)) || '{}');
const command = input.tool_input?.command;
if (typeof command !== 'string') process.exit(0);

const visible = visibleCommand(command);
const hit = RULES.find((rule) => rule.test(visible));
if (hit) {
  process.stderr.write(`Blocked by .claude/hooks/guard-bash.mjs\n${hit.reason}\n`);
  process.exit(2);
}
