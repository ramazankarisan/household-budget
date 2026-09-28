#!/usr/bin/env node
/**
 * Claude Code Stop hook: runs `pnpm check` before the agent may say it is done.
 *
 * CLAUDE.md says "After every change, run `pnpm check` before saying you are done." As prose
 * that is a request; as a hook it is a gate. Exit 2 keeps the agent working and hands it the
 * failing step's output (scripts/check.mjs already prints only the step that failed).
 *
 * Three ways it stays out of the way:
 * - a clean tree means nothing changed, so there is nothing to check;
 * - a tree identical to the last one that passed is not checked twice — a turn that only
 *   answered a question costs nothing;
 * - `stop_hook_active` means this stop is already the result of a failed check, and the
 *   agent is allowed to stop and report rather than loop.
 *
 * The fingerprint lives in .git/, which is never committed and belongs to this checkout.
 *
 * .mjs because the root package is "type": "commonjs" while the workspace packages are ESM.
 */
import { spawnSync } from 'node:child_process';
import { hash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { text } from 'node:stream/consumers';

const input = JSON.parse((await text(process.stdin)) || '{}');
if (input.stop_hook_active === true) {
  process.exit(0);
}

const root = process.env['CLAUDE_PROJECT_DIR'] ?? input.cwd ?? process.cwd();
const git = (...args) =>
  spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const status = git('status', '--porcelain', '--untracked-files=all');
if (status.status !== 0 || status.stdout.trim() === '') {
  process.exit(0);
}

// What the tree looks like: tracked changes plus the list of untracked files. Untracked
// contents are not hashed — a new file shows up by name, and editing it again is rare
// enough between two stops that the next real change catches it.
const fingerprint = hash('sha256', `${status.stdout}\n${git('diff', 'HEAD').stdout}`, 'hex');
const stamp = resolve(root, git('rev-parse', '--git-dir').stdout.trim(), 'claude-check-passed');
let lastPassed = '';
try {
  lastPassed = readFileSync(stamp, 'utf8').trim();
} catch {
  // Never passed in this checkout.
}
if (lastPassed === fingerprint) {
  process.exit(0);
}

const check = spawnSync('pnpm', ['check'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, NO_COLOR: '1' },
  maxBuffer: 64 * 1024 * 1024,
});

if (check.status === 0) {
  writeFileSync(stamp, `${fingerprint}\n`);
  process.exit(0);
}

const output = `${check.stdout ?? ''}${check.stderr ?? ''}`
  .trim()
  .split('\n')
  .slice(-80)
  .join('\n');
process.stderr.write(
  'pnpm check fails on the working tree (Stop hook, .claude/hooks/check-on-stop.mjs). ' +
    'Fix it before finishing, or say plainly that it is failing and why.\n\n' +
    `${output}\n`,
);
process.exit(2);
