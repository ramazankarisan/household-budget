#!/usr/bin/env node
/**
 * Claude Code Stop hook: runs `pnpm check` before the agent may say it is done — but only
 * when it edited something (mark-edited.mjs left a note).
 *
 * CLAUDE.md says "After every change, run `pnpm check` before saying you are done." As prose
 * that is a request; as a hook it is a gate. Exit 2 keeps the agent working and hands it the
 * failing step's output.
 *
 * The note is removed before the check runs. So:
 * - no edits this turn (a question, or only the user's own uncommitted work) → no check;
 * - check fails → blocked; if the agent then stops without editing again, there is no note
 *   and it may stop and report — no loop; if it edits again, the fix is checked again.
 *
 * HB_STOP_CHECK replaces `pnpm check` with a shell command, for the hook's own tests.
 *
 * .mjs because the root package is "type": "commonjs" while the workspace packages are ESM.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { text } from 'node:stream/consumers';

const input = JSON.parse((await text(process.stdin)) || '{}');
const note = join(tmpdir(), 'claude-hooks', `${String(input.session_id ?? 'unknown')}.edited`);

let roots;
try {
  roots = [...new Set(readFileSync(note, 'utf8').split('\n').filter(Boolean))];
} catch {
  process.exit(0); // no note: the agent edited nothing
}
rmSync(note, { force: true });

const override = process.env['HB_STOP_CHECK'];
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const failures = [];
for (const root of roots) {
  const check = spawnSync(
    override === undefined ? 'pnpm' : 'sh',
    override === undefined ? ['check'] : ['-c', override],
    { cwd: root, encoding: 'utf8', env: { ...env, NO_COLOR: '1' }, maxBuffer: 64 * 1024 * 1024 },
  );
  if (check.status !== 0) {
    const output = `${check.stdout ?? ''}${check.stderr ?? ''}`.trim().split('\n').slice(-80);
    failures.push(`${root}:\n${output.join('\n')}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(
    'pnpm check fails after your edits (Stop hook, .claude/hooks/check-on-stop.mjs). ' +
      'Fix it before finishing. If it cannot be fixed, stop without editing again and say ' +
      'plainly what fails and why.\n\n' +
      `${failures.join('\n\n')}\n`,
  );
  process.exit(2);
}
