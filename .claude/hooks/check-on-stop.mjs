#!/usr/bin/env node
/**
 * Claude Code Stop hook: runs `pnpm check` before the agent may say it is done.
 *
 * CLAUDE.md says "After every change, run `pnpm check` before saying you are done." As prose
 * that is a request; as a hook it is a gate. Exit 2 keeps the agent working and hands it the
 * failing step's output (scripts/check.mjs already prints only the step that failed).
 *
 * When it stays quiet:
 * - the tree is clean, or exactly as it was when the turn began (record-turn-start.mjs) —
 *   the agent changed nothing, so the user's own unfinished work is not its problem;
 * - the tree is exactly the one that last passed;
 * - the agent was already sent back once (`stop_hook_active`) and has changed nothing since
 *   that failure — it may stop and report rather than loop. Any change after a failure is
 *   checked again, so a wrong fix cannot slip through on the second stop.
 *
 * HB_STOP_CHECK replaces `pnpm check` with a shell command. It exists for the hook's own
 * tests (hooks.test.mjs), which cannot afford a real check per case.
 *
 * .mjs because the root package is "type": "commonjs" while the workspace packages are ESM.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

import { fingerprint, readHookInput, readStamp, treeRoot, writeStamp } from './tree.mjs';

const input = await readHookInput();
const root = treeRoot(input);
if (root === undefined) process.exit(0);

const state = fingerprint(root);
if (state === undefined || state === null) process.exit(0);

const turnStart = readStamp(root, `turn-start-${String(input.session_id ?? 'unknown')}`);
if (turnStart !== undefined && turnStart === state) process.exit(0);
if (readStamp(root, 'check-passed') === state) process.exit(0);
if (input.stop_hook_active === true && readStamp(root, 'check-failed') === state) {
  process.exit(0);
}

const override = process.env['HB_STOP_CHECK'];
const check = spawnSync(
  override === undefined ? 'pnpm' : 'sh',
  override === undefined ? ['check'] : ['-c', override],
  {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 64 * 1024 * 1024,
  },
);

if (check.status === 0) {
  writeStamp(root, 'check-passed', state);
  process.exit(0);
}

writeStamp(root, 'check-failed', state);
const output = `${check.stdout ?? ''}${check.stderr ?? ''}`
  .trim()
  .split('\n')
  .slice(-80)
  .join('\n');
process.stderr.write(
  'pnpm check fails on the working tree (Stop hook, .claude/hooks/check-on-stop.mjs). ' +
    'Fix it before finishing. If it cannot be fixed, stop without changing anything and say ' +
    'plainly what fails and why.\n\n' +
    `${output}\n`,
);
process.exit(2);
