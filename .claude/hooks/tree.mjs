/**
 * What the working tree looks like, as one hash, plus the few stamps the Stop hook keeps.
 *
 * Shared by record-turn-start.mjs (UserPromptSubmit) and check-on-stop.mjs (Stop): the turn
 * start and the turn end have to be measured the same way, or "nothing changed" means
 * nothing.
 *
 * .mjs because the root package is "type": "commonjs" while the workspace packages are ESM.
 */
import { spawnSync } from 'node:child_process';
import { hash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { text } from 'node:stream/consumers';

const BUFFER = 256 * 1024 * 1024;

export async function readHookInput() {
  return JSON.parse((await text(process.stdin)) || '{}');
}

/**
 * No inherited GIT_* variables: set by an outer git (a hook, a rebase), GIT_DIR would make
 * `git -C root` describe some other repository.
 */
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
);

function git(root, args, input) {
  return spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env,
    maxBuffer: BUFFER,
    ...(input === undefined ? {} : { input }),
  });
}

/**
 * The checkout the session is working in: its cwd when that is a git tree (a harness
 * worktree under .claude/worktrees/ included), else the project directory.
 */
export function treeRoot(input) {
  for (const candidate of [input.cwd, process.env['CLAUDE_PROJECT_DIR'], process.cwd()]) {
    if (typeof candidate !== 'string' || candidate === '') continue;
    const top = git(candidate, ['rev-parse', '--show-toplevel']);
    if (top.status === 0) return top.stdout.trim();
  }
  return undefined;
}

/**
 * A hash of every uncommitted byte, or `null` for a clean tree.
 *
 * - `--binary`, because the fixtures are `-diff` in .gitattributes: a plain diff prints the
 *   same "Binary files differ" line whatever the new bytes are.
 * - untracked files by content, not only by name: a new file edited twice is two states.
 */
export function fingerprint(root) {
  const status = git(root, ['status', '--porcelain', '-z', '--untracked-files=all']);
  if (status.status !== 0) return undefined;
  if (status.stdout === '') return null;

  const tracked = git(root, ['diff', 'HEAD', '--binary']).stdout;
  const untrackedPaths = git(root, ['ls-files', '--others', '--exclude-standard', '-z'])
    .stdout.split('\0')
    .filter(Boolean);
  const untracked =
    untrackedPaths.length === 0
      ? ''
      : git(root, ['hash-object', '--stdin-paths'], untrackedPaths.join('\n')).stdout;

  return hash('sha256', `${status.stdout}\0${tracked}\0${untracked}`, 'hex');
}

/** Stamps live in this checkout's own git dir: never committed, never shared between trees. */
function stampPath(root, name) {
  const gitDir = git(root, ['rev-parse', '--absolute-git-dir']).stdout.trim();
  const dir = resolve(gitDir, 'claude-hooks');
  mkdirSync(dir, { recursive: true });
  return resolve(dir, name.replace(/[^\w.-]/g, '_'));
}

/** `null` is stored as the word "clean", so a clean tree is a state like any other. */
export function readStamp(root, name) {
  try {
    const value = readFileSync(stampPath(root, name), 'utf8').trim();
    return value === 'clean' ? null : value;
  } catch {
    return undefined;
  }
}

export function writeStamp(root, name, value) {
  writeFileSync(stampPath(root, name), `${value ?? 'clean'}\n`);
}
