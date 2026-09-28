#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit hook: remembers what the tree looked like when the turn began.
 *
 * check-on-stop.mjs compares against this, so it checks what the agent changed during the
 * turn — not whatever uncommitted work the user already had. Without it, a question asked
 * over a half-finished branch would end with the agent told to fix code nobody asked it to
 * touch.
 *
 * Silent on purpose: a UserPromptSubmit hook's stdout is added to the prompt.
 *
 * .mjs because the root package is "type": "commonjs" while the workspace packages are ESM.
 */
import { fingerprint, readHookInput, treeRoot, writeStamp } from './tree.mjs';

const input = await readHookInput();
const root = treeRoot(input);
if (root !== undefined) {
  const state = fingerprint(root);
  if (state !== undefined) {
    writeStamp(root, `turn-start-${String(input.session_id ?? 'unknown')}`, state);
  }
}
