/**
 * The Claude Code hooks, driven the way Claude Code drives them: a JSON payload on stdin,
 * exit 2 to block. Run by `pnpm test` (and so by `pnpm check`) with `node --test`, because
 * there is no root Vitest and these scripts belong to no package.
 *
 * The Stop hook runs against a throwaway git repository with HB_STOP_CHECK standing in for
 * `pnpm check`, so each case costs milliseconds and records whether the check ran at all.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const hooks = dirname(fileURLToPath(import.meta.url));
const project = resolve(hooks, '..', '..');

/**
 * The environment without any GIT_* variable. `pnpm test` runs inside the pre-push hook,
 * where git exports GIT_DIR and friends; inherited, they point every `git -C <tmp repo>`
 * below at the real repository instead. That once committed into this repo and rewrote its
 * config — every git call here goes through this.
 */
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
);

function run(script, payload, env = {}) {
  const result = spawnSync('node', [join(hooks, script)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...cleanEnv, CLAUDE_PROJECT_DIR: project, ...env },
  });
  return { code: result.status, stderr: result.stderr, stdout: result.stdout };
}

describe('protect-files', () => {
  const at = (p) => join(project, p);
  const cases = [
    ['Edit', { file_path: at('fixtures/sparkasse-camt-18.csv') }, true],
    ['Write', { file_path: 'fixtures/new.csv' }, true],
    ['MultiEdit', { file_path: at('fixtures/sparkasse-camt-17.csv') }, true],
    ['Edit', { file_path: at('apps/api/src/generated/prisma/client.ts') }, true],
    [
      'Edit',
      { file_path: at('.claude/worktrees/x/apps/api/src/generated/prisma/client.ts') },
      true,
    ],
    ['Write', { file_path: at('apps/api/.env') }, true],
    ['Write', { file_path: at('apps/api/.env.example') }, false],
    ['Write', { file_path: at('Statement Jan.csv') }, true],
    ['Write', { file_path: at('apps/api/data/budget.db') }, true],
    ['Write', { file_path: at('notes.sqlite') }, true],
    ['NotebookEdit', { notebook_path: at('fixtures/x.csv') }, true],
    ['Edit', { file_path: at('packages/core/src/csv/parse.ts') }, false],
    ['Write', { file_path: '/tmp/outside-the-repo.csv' }, false],
    ['Read', { file_path: at('apps/api/data/budget.db') }, true],
    ['Read', { file_path: at('.claude/worktrees/x/apps/api/data/budget.db') }, true],
    ['Read', { file_path: at('apps/api/data/test.db') }, false],
    ['Read', { file_path: at('fixtures/sparkasse-camt-18.csv') }, false],
    ['Read', { file_path: at('README.md') }, false],
    ['Grep', { pattern: 'Müller', path: at('apps/api/data') }, true],
    ['Grep', { pattern: 'apps/api/data', path: at('docs') }, false],
    ['Grep', { pattern: 'x' }, false],
    ['Glob', { pattern: 'apps/api/data/*' }, true],
    ['Glob', { pattern: '**/*.db' }, true],
    ['Glob', { pattern: '**/*.ts' }, false],
  ];
  for (const [tool, toolInput, blocked] of cases) {
    test(`${tool} ${JSON.stringify(toolInput).replaceAll(project, '')} → ${blocked ? 'blocked' : 'allowed'}`, () => {
      const { code, stderr } = run('protect-files.mjs', {
        tool_name: tool,
        tool_input: toolInput,
        cwd: project,
      });
      assert.equal(code, blocked ? 2 : 0, stderr);
    });
  }
});

describe('guard-bash', () => {
  const cases = [
    ['git commit --no-verify -m x', true],
    ['git commit --no-verif -m x', true],
    ['git push --no-veri', true],
    ['git commit -nm "x"', true],
    ['git commit --no-verbose -m x', false],
    ['git commit -m "fix: x"', false],
    ['git commit --amend --no-edit', false],
    ['git log --grep=--no-verify', false],
    ['LEFTHOOK=0 git commit -m x', true],
    ['LEFTHOOK_EXCLUDE=gitleaks git commit -m x', true],
    ['git -c core.hooksPath=/dev/null commit -m x', true],
    ['pnpm exec lefthook uninstall && git commit -m x', true],
    ['rm .git/hooks/pre-commit', true],
    ['echo exit 0 > .git/hooks/pre-commit', true],
    ['ls .git/hooks', false],
    ['git add -f statement.csv', true],
    ['git add --force apps/api/data/budget.db', true],
    ['git add -f apps/api/data', true],
    ['git add -f apps/api/.env', true],
    ['git add README.md', false],
    ['sqlite3 apps/api/data/budget.db "select 1"', true],
    ['cd apps/api && sqlite3 data/*.db', true],
    ['cd apps/api && cat data/budget.db', true],
    ['cp apps/api/data/budget.db /tmp/', true],
    ['ls apps/api/data', true],
    ['rm -f apps/api/data/test.db apps/api/data/e2e.db', false],
    ['pnpm --filter @household-budget/api db:push', false],
    ['git commit -m "fix: import data per account"', false],
    ['pnpm check', false],
    ["git commit -F - <<'EOF'\ndocs: never read budget.db, never use --no-verify\nEOF", false],
    ["gh pr create --body-file - <<'EOF'\nLEFTHOOK=0 is for humans\nEOF", false],
    ["LEFTHOOK=0 git commit -F - <<'EOF'\nx\nEOF", true],
    ['git commit -F - <<EOF --no-verify\nx\nEOF', true],
    ["cat <<'SQL' | sqlite3 apps/api/data/budget.db\nselect 1;\nSQL", true],
    ["python3 - <<'EOF'\nimport sqlite3\nsqlite3.connect('apps/api/data/budget.db')\nEOF", true],
    ["bash <<'EOF'\nLEFTHOOK=0 git commit -m x\nEOF", true],
    ["cat <<'EOF' > apps/api/.env.example\nDATABASE_URL=\nEOF", false],
  ];
  for (const [command, blocked] of cases) {
    test(`${JSON.stringify(command)} → ${blocked ? 'blocked' : 'allowed'}`, () => {
      const { code, stderr } = run('guard-bash.mjs', {
        tool_name: 'Bash',
        tool_input: { command },
      });
      assert.equal(code, blocked ? 2 : 0, stderr);
    });
  }
});

describe('record-turn-start + check-on-stop', () => {
  let repo;
  let log;
  const git = (...args) => {
    const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: cleanEnv });
    assert.equal(r.status, 0, r.stderr);
  };
  const session = 'test-session';
  const startTurn = () => {
    const r = run('record-turn-start.mjs', { session_id: session, cwd: repo });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, '', 'a UserPromptSubmit hook must stay silent: stdout joins the prompt');
  };
  /** Stops with a check that exits `checkExit`; returns the hook's exit and whether it ran. */
  const stop = (checkExit, extra = {}) => {
    writeFileSync(log, '');
    const r = run(
      'check-on-stop.mjs',
      { session_id: session, cwd: repo, ...extra },
      { HB_STOP_CHECK: `echo ran >> "${log}"; exit ${String(checkExit)}` },
    );
    return { code: r.code, ran: readFileSync(log, 'utf8').includes('ran') };
  };

  before(() => {
    repo = mkdtempSync(join(tmpdir(), 'hb-stop-hook-'));
    log = join(repo, '..', `${repo.split('/').pop()}.log`);
    git('init', '-q');
    // Must be the throwaway repo, or nothing below may run.
    const top = spawnSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      env: cleanEnv,
    });
    assert.equal(realpathSync(top.stdout.trim()), realpathSync(repo));
    writeFileSync(join(repo, '.gitattributes'), '*.csv -text -diff\n');
    writeFileSync(join(repo, 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(repo, 'f.csv'), 'x;y\r\n1;2\r\n');
    git('add', '.');
    // Identity per command, never written to any config.
    git('-c', 'user.email=test@example.invalid', '-c', 'user.name=test', 'commit', '-qm', 'init');
  });
  after(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(log, { force: true });
  });

  test('clean tree: nothing to check', () => {
    startTurn();
    assert.deepEqual(stop(1), { code: 0, ran: false });
  });

  test('the user’s own uncommitted work, untouched this turn: not the agent’s problem', () => {
    writeFileSync(join(repo, 'a.ts'), 'export const a = 2; // user WIP, failing\n');
    startTurn();
    assert.deepEqual(stop(1), { code: 0, ran: false });
  });

  test('a change during the turn is checked; a failure keeps the agent working', () => {
    startTurn();
    writeFileSync(join(repo, 'b.ts'), 'export const b = 1;\n');
    assert.deepEqual(stop(1), { code: 2, ran: true });
  });

  test('sent back, changed nothing: may stop and report instead of looping', () => {
    assert.deepEqual(stop(1, { stop_hook_active: true }), { code: 0, ran: false });
  });

  test('sent back, changed something: checked again, so a wrong fix cannot slip through', () => {
    writeFileSync(join(repo, 'b.ts'), 'export const b = 2; // still wrong\n');
    assert.deepEqual(stop(1, { stop_hook_active: true }), { code: 2, ran: true });
  });

  test('a passing tree is stamped, and the same tree is not checked twice', () => {
    writeFileSync(join(repo, 'b.ts'), 'export const b = 3;\n');
    assert.deepEqual(stop(0), { code: 0, ran: true });
    assert.deepEqual(stop(1), { code: 0, ran: false });
  });

  test('an untracked file edited after a pass is checked again', () => {
    startTurn();
    writeFileSync(join(repo, 'b.ts'), 'export const b = 4;\n');
    assert.deepEqual(stop(1), { code: 2, ran: true });
    writeFileSync(join(repo, 'b.ts'), 'export const b = 5;\n');
    assert.deepEqual(stop(0), { code: 0, ran: true });
  });

  test('a -diff fixture whose bytes change after a pass is checked again', () => {
    startTurn();
    writeFileSync(join(repo, 'f.csv'), 'x;y\r\n1;3\r\n');
    assert.deepEqual(stop(0), { code: 0, ran: true });
    writeFileSync(join(repo, 'f.csv'), 'x;y\r\n1;4\r\n');
    assert.deepEqual(stop(1), { code: 2, ran: true });
  });
});
