#!/usr/bin/env node
/**
 * Claude Code PostToolUse hook for the file-editing tools: notes that the agent changed a
 * file in this repo during the session, so check-on-stop.mjs knows there is something to check.
 *
 * The note is a file in the OS temp dir, one per session, listing the checkout(s) that were
 * edited — the main one or a worktree. Only the agent's own edits set it, never the user's.
 * Edits made through Bash (sed -i, a generator) do not; the git hooks still check those at
 * commit and push.
 *
 * .mjs because the root package is "type": "commonjs" while the workspace packages are ESM.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { text } from 'node:stream/consumers';

const input = JSON.parse((await text(process.stdin)) || '{}');
const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
if (typeof file !== 'string' || file === '') process.exit(0);

// Which checkout the file is in. GIT_* is dropped so an outer git cannot redirect the answer.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const top = spawnSync('git', ['-C', dirname(file), 'rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
  env,
});
const root = top.status === 0 ? top.stdout.trim() : '';
// Only a checkout of this repo has `pnpm check`; a scratch file or another repo does not.
if (root === '' || !existsSync(join(root, 'scripts', 'check.mjs'))) process.exit(0);

const dir = join(tmpdir(), 'claude-hooks');
mkdirSync(dir, { recursive: true });
appendFileSync(join(dir, `${String(input.session_id ?? 'unknown')}.edited`), `${root}\n`);
