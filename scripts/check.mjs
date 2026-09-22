#!/usr/bin/env node
/**
 * The single "is this repo healthy" command.
 *
 *   pnpm check       fast set — no servers, no browser. Run this after every change.
 *   pnpm check:all   everything, including Playwright. Run by the pre-push hook.
 *
 * Each step's output is buffered and thrown away on success, so a green run is one line per
 * step and nothing else. On failure the buffered output is printed in full for that step and
 * the run stops there — you get the failure, not the failure buried under four passing tools.
 *
 * .mjs because the root package is "type": "commonjs" while the workspace packages are ESM.
 */
import { spawnSync } from 'node:child_process';

const runAll = process.argv.includes('--all');

/** Ordered cheapest-to-most-expensive, so the common failure surfaces soonest. */
const STEPS = [
  { label: 'format', script: 'format:check' },
  { label: 'lint', script: 'lint' },
  { label: 'deps', script: 'lint:deps' },
  { label: 'types', script: 'typecheck' },
  { label: 'unit', script: 'test' },
  { label: 'e2e', script: 'test:e2e', only: 'all' },
];

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const DIM = '\u001b[2m';
const RESET = '\u001b[0m';
// Respect NO_COLOR and non-tty output, so piping check into a log stays readable.
const plain = !process.stdout.isTTY || process.env['NO_COLOR'];
const paint = (color, text) => (plain ? text : `${color}${text}${RESET}`);

const steps = STEPS.filter((step) => step.only !== 'all' || runAll);
let failed = null;

for (const step of steps) {
  const startedAt = Date.now();
  const result = spawnSync('pnpm', ['run', step.script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (result.status === 0) {
    console.log(`${paint(GREEN, '✓')} ${step.label} ${paint(DIM, `${seconds}s`)}`);
    continue;
  }

  console.log(`${paint(RED, '✗')} ${step.label} ${paint(DIM, `${seconds}s`)}`);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd();
  if (output) {
    console.log(`\n${output}\n`);
  }
  // spawnSync sets .error when the binary itself could not be run.
  if (result.error) {
    console.log(`Could not run \`pnpm run ${step.script}\`: ${result.error.message}\n`);
  }
  failed = step;
  break;
}

if (failed) {
  console.log(paint(RED, `check failed at: ${failed.label}`));
  process.exit(1);
}

if (!runAll) {
  console.log(paint(DIM, 'ok — run `pnpm check:all` to include Playwright'));
}
