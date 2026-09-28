#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook for Edit|Write|Read: refuses the file operations that break an
 * invariant of this repo before they happen.
 *
 * Exit 2 blocks the tool call and hands stderr back to the agent as the reason. Every rule
 * says what to do instead, because a refusal without a way forward just gets retried.
 *
 * The lefthook gates stop the same mistakes at commit time; this stops them at the edit, when
 * a corrupted fixture or a copied bank export is still one keystroke old.
 *
 * .mjs because the root package is "type": "commonjs" while the workspace packages are ESM.
 */
import { relative, resolve } from 'node:path';
import process from 'node:process';
import { text } from 'node:stream/consumers';

const WRITE_RULES = [
  {
    // Edit and Write emit UTF-8 with LF. The fixtures are CRLF, and the primary one is
    // Windows-1252; one "small fix" through these tools silently changes what every parser
    // test is testing.
    test: (p) => /(^|\/)fixtures\/.*\.csv$/i.test(p),
    reason:
      'fixtures/*.csv are byte-exact test data (CRLF, Windows-1252). Edit/Write would re-encode ' +
      'them as UTF-8 with LF. Generate fixtures with ' +
      '.claude/skills/add-bank-format/scripts/make_fixture.py and check them with check_fixture_bytes.py.',
  },
  {
    test: (p) => p.startsWith('apps/api/src/generated/'),
    reason:
      'apps/api/src/generated/ is the Prisma client, regenerated from apps/api/prisma/schema.prisma. ' +
      'Change the schema and run `pnpm --filter @household-budget/api prisma:generate`.',
  },
  {
    test: (p) => /(^|\/)\.env(\..+)?$/.test(p) && !p.endsWith('.env.example'),
    reason:
      '.env files are the user’s local configuration. Change apps/api/.env.example and say what ' +
      'the user should copy.',
  },
  {
    test: (p) => /\.(csv|ofx|qfx|qif|xls|xlsx)$/i.test(p) && !/(^|\/)fixtures\//.test(p),
    reason:
      'bank exports outside fixtures/ are real statements and never get written by the agent. ' +
      'Synthetic test data goes in fixtures/ (see CLAUDE.md RULES).',
  },
];

const READ_RULES = [
  {
    // The local database is one person's bank history. Reading it puts that history into
    // the model's context, which "nothing is uploaded anywhere" (CLAUDE.md WHY) rules out.
    test: (p) => /^apps\/api\/data\//.test(p) || /\.(db|db-wal|db-shm|sqlite3?)$/i.test(p),
    reason:
      'apps/api/data/ holds the user’s real bank history. Do not read it; reproduce the case with a ' +
      'synthetic fixture and the test database instead.',
  },
];

const input = JSON.parse((await text(process.stdin)) || '{}');
const filePath = input.tool_input?.file_path;
if (typeof filePath !== 'string' || filePath === '') {
  process.exit(0);
}

const root = process.env['CLAUDE_PROJECT_DIR'] ?? input.cwd ?? process.cwd();
const rel = relative(root, resolve(root, filePath)).split('\\').join('/');
// Outside the repo is not this hook's business.
if (rel.startsWith('../')) {
  process.exit(0);
}

const rules = input.tool_name === 'Read' ? READ_RULES : WRITE_RULES;
const hit = rules.find((rule) => rule.test(rel));
if (hit) {
  process.stderr.write(`Blocked by .claude/hooks/protect-files.mjs: ${rel}\n${hit.reason}\n`);
  process.exit(2);
}
