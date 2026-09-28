#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook for the file tools: refuses the operations that break an
 * invariant of this repo before they happen.
 *
 * Writes (Edit, MultiEdit, Write, NotebookEdit): fixtures, the generated Prisma client, .env
 * files, bank exports, databases. Reads (Read, Grep, Glob): the user's own data.
 *
 * Exit 2 blocks the tool call and hands stderr back to the agent as the reason. Every rule
 * says what to do instead, because a refusal without a way forward just gets retried.
 *
 * Patterns match at any depth, so a harness worktree under .claude/worktrees/ is guarded
 * like the checkout it came from. What counts as the user's data is scripts/data-patterns.mjs,
 * shared with the commit gate.
 *
 * .mjs because the root package is "type": "commonjs" while the workspace packages are ESM.
 */
import { isAbsolute, relative, resolve } from 'node:path';
import process from 'node:process';
import { text } from 'node:stream/consumers';

import {
  isBankExport,
  isDatabaseFile,
  isEnvFile,
  isFixture,
  isLocalDataPath,
  isThrowawayDatabase,
} from '../../scripts/data-patterns.mjs';

const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);

/** Throwaway test databases are synthetic; everything else under apps/api/data is not. */
const isUserData = (p) =>
  !isThrowawayDatabase(p) && (isLocalDataPath(p) || isDatabaseFile(p) || /\.db\*?$/.test(p));

const WRITE_RULES = [
  {
    // Edit and Write emit UTF-8 with LF. The fixtures are CRLF, and the primary one is
    // Windows-1252; one "small fix" through these tools silently changes what every parser
    // test is testing.
    test: (p) => isFixture(p) && /\.csv$/i.test(p),
    reason:
      'fixtures/*.csv are byte-exact test data (CRLF, Windows-1252). Edit/Write would re-encode ' +
      'them as UTF-8 with LF. Generate fixtures with ' +
      '.claude/skills/add-bank-format/scripts/make_fixture.py and check them with check_fixture_bytes.py.',
  },
  {
    test: (p) => /(^|\/)apps\/api\/src\/generated\//.test(p),
    reason:
      'apps/api/src/generated/ is the Prisma client, regenerated from apps/api/prisma/schema.prisma. ' +
      'Change the schema and run `pnpm --filter @household-budget/api prisma:generate`.',
  },
  {
    test: isEnvFile,
    reason:
      '.env files are the user’s local configuration. Change apps/api/.env.example and say what ' +
      'the user should copy.',
  },
  {
    test: isBankExport,
    reason:
      'bank exports outside fixtures/ are real statements and never get written by the agent. ' +
      'Synthetic test data goes in fixtures/ (see CLAUDE.md RULES).',
  },
  {
    test: isUserData,
    reason:
      'apps/api/data/ and database files hold the user’s real bank history. The test suites ' +
      'create their own (test.db, e2e.db).',
  },
];

const READ_RULES = [
  {
    // The local database is one person's bank history. Reading it puts that history into
    // the model's context, which "nothing is uploaded anywhere" (CLAUDE.md WHY) rules out.
    test: isUserData,
    reason:
      'apps/api/data/ holds the user’s real bank history. Do not read it; reproduce the case with a ' +
      'synthetic fixture and the test database (apps/api/data/test.db) instead.',
  },
];

/** The path a tool call touches, per tool. */
function targetPath(input) {
  const tool = input.tool_input ?? {};
  if (input.tool_name === 'NotebookEdit') return tool.notebook_path;
  // A search without a path searches the cwd, where apps/api/data is git-ignored and so not
  // searched; the rules only care when the path points at data.
  if (input.tool_name === 'Grep') return tool.path;
  if (input.tool_name === 'Glob') {
    // A Glob pattern is itself a path (`apps/api/data/*`, `**/*.db`); Grep's is a regex.
    return [tool.path, tool.pattern].filter((v) => typeof v === 'string').join('/');
  }
  return tool.file_path;
}

const input = JSON.parse((await text(process.stdin)) || '{}');
const tool = input.tool_name;
const filePath = targetPath(input);
if (typeof filePath !== 'string' || filePath === '') process.exit(0);

const root = process.env['CLAUDE_PROJECT_DIR'] ?? input.cwd ?? process.cwd();
const absolute = isAbsolute(filePath) ? filePath : resolve(input.cwd ?? root, filePath);
const rel = relative(root, absolute).split('\\').join('/');
// Outside the project is not this hook's business.
if (rel.startsWith('../')) process.exit(0);

const rules = WRITE_TOOLS.has(tool) ? WRITE_RULES : READ_TOOLS.has(tool) ? READ_RULES : [];
const hit = rules.find((rule) => rule.test(rel));
if (hit) {
  process.stderr.write(`Blocked by .claude/hooks/protect-files.mjs: ${rel}\n${hit.reason}\n`);
  process.exit(2);
}
