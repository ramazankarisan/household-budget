# Best practices: backpressure and workflow

How this repo was built with Claude Code as the implementing agent, and the gates that push back
on it.

## Premise

As taught in the ACF training, an agent is a tool and a collaborator. It can read and write files, run commands, and make decisions. It can also be wrong, and it can forget. The repo's workflow and guardrails are designed to catch both.

What the repo does about it: CLAUDE.md says "after every change, run `pnpm check` before saying
you are done". The Stop hook makes that true whether or not the agent remembers
([Layer 1](#layer-1-claude-code-hooks)).

## Workflow: research → plan → implement

Every feature went through three vendored skills (`rpi-research`, `rpi-plan`, `rpi-implement`),
each leaving a committed file:

| Step      | Output                                   | What it is for                                                              |
| --------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| Research  | `docs/research/NN-topic.md`              | Facts found once: a bank's CSV format, SQLite's case folding, a UI pattern. |
| Plan      | `docs/plans/NN-topic.md`                 | Decisions, phases, acceptance criteria — reviewed before any code.          |
| Implement | code + the plan's _Implementation Notes_ | Each phase verified before the next; every departure written down.          |

Plans are evidence, not living specs. Once implemented they are not rewritten: a departure goes
under _Implementation Notes_, a later change under _Later changes_, and the state at the end in
an _Outcome_ note at the top.

A few departures the notes recorded:

- **Plan 01:** two fixtures became UTF-8 instead of Windows-1252, because core's tests read
  them through Vite's `?raw`, which would have turned the umlauts into mojibake.
- **Plan 05:** syncing a ref during render failed lint (`react-hooks/refs`), so it moved into
  an effect declared before the fetch effect.
- **Plan 09:** Stryker's Vitest plugin never activated a mutant — every mutant "survived",
  including an emptied `matchRule`, for a score of 36% that measured nothing. Replaced by the
  command runner.

## Checking the build against the plan

Evaluating the implementation against the plan is necessary because even with plan.md file, deviations can come in.
Either the agent misread the plan or interpreted it differently, or the plan was wrong. I saw it with same points.

What the history shows:

- PR reviews (`/code-review`) found real gaps after the agent reported done: three holes in the
  list filters (`adab39b`), gaps in the Claude Code hooks themselves (`abfb5c8`).

## Backpressure, layer by layer

Each check runs once, as early as it can run cheaply, and CI repeats everything where nobody can
skip it.

| Layer                | Runs                                                                                                      | Catches                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1. Claude Code hooks | on every agent tool call, and when the agent stops                                                        | the agent touching what it must not; the agent stopping red |
| 2. pre-commit        | data guard → gitleaks → Prettier → ESLint, staged files only, stops at first failure                      | bank data, secrets, format, lint                            |
| 3. commit-msg        | commitlint                                                                                                | non-Conventional-Commits messages                           |
| 4. pre-push          | `check.mjs --push`: architecture rules, unused code, duplicated code, typecheck, unit tests with coverage | whole-project breakage                                      |
| 5. CI, every PR      | data guard over every tracked file, gitleaks over history, `pnpm audit`, `pnpm check:all`                 | anything skipped locally; browser-level breakage            |
| 6. CI, weekly        | Stryker mutation tests over `packages/core`                                                               | tests that pass without asserting anything                  |

### Layer 1: Claude Code hooks

Git hooks only protect the repo if nobody skips them, and the agent can type `--no-verify` as
easily as a person can. So the agent gets gates of its own (`.claude/settings.json`,
`.claude/hooks/`):

| Hook                | Event                 | Does                                                                                                                                                                                |
| ------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protect-files.mjs` | before Edit/Write     | Refuses writes to `fixtures/*.csv` (Edit/Write would re-encode byte-exact CRLF/Windows-1252 files), the generated Prisma client, `.env` files, bank exports, databases.             |
| `protect-files.mjs` | before Read/Grep/Glob | Refuses reads of the user's real database — reading it would put their bank history into the model's context.                                                                       |
| `guard-bash.mjs`    | before Bash           | Refuses `--no-verify`, `commit -n`, `LEFTHOOK=0`, `LEFTHOOK_EXCLUDE=`, and shell commands that reach the real data.                                                                 |
| `mark-edited.mjs`   | after Edit/Write      | Notes that the agent changed a file this session.                                                                                                                                   |
| `check-on-stop.mjs` | when the agent stops  | If it edited something, runs `pnpm check`. On failure, exit 2 keeps the agent working with the failing step's output. Runs once per edit, so a failure it cannot fix does not loop. |

Every refusal says what to do instead — a refusal without a way forward just gets retried. The
hooks have their own tests (`.claude/hooks/hooks.test.mjs`, part of `pnpm test`), which drive
them the way Claude Code does: JSON on stdin, exit code out.

What counts as "the user's data" is one file, `scripts/data-patterns.mjs`, shared by the agent's
hooks and the commit-time data guard, so the two cannot disagree.

### Why they came second

I thought the git hooks were enough, then I realized the agent could skip them. The hooks came later.
That was a cautious choice.

## Growing the guardrails

I added as a first step guardrails in the repo but then I asked to agent and even more suggestions came from it. The agent suggested to add a11y checks, commitlint, and Stryker mutation tests. I agreed and added them.
For CI, I was not planning as well but again agent can skip any local check, so I added CI to run all checks on every PR and weekly Stryker mutation tests.

What came out of it ([plan 09](plans/09-guardrails.md)), each check placed where it fits:

| Guardrail                       | Where        | Why this one                                                                                                                                                            |
| ------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI (`pnpm check:all`)           | every PR     | The one gate `LEFTHOOK=0` does not skip.                                                                                                                                |
| Coverage thresholds             | `pnpm check` | A ratchet: set just under the measured value, raised when coverage rises, never lowered to let a change through.                                                        |
| dependency-cruiser              | `pnpm check` | The architecture as rules: each [boundary](architecture.md#boundaries-and-why-they-exist) proven by planting a violation.                                               |
| knip                            | `pnpm check` | Unused files, exports and dependencies. Its first run removed eight needless exports.                                                                                   |
| jscpd                           | `pnpm check` | Copy-paste detection over `src/` and `scripts/`, tests excluded. A ratchet like coverage: baseline 0.31%, threshold 0.5%; extract the shared code rather than raise it. |
| Property tests (fast-check)     | `pnpm check` | State what example tests only sample: every German amount spelling round-trips to exact cents; rule order is total; dedup keys are stable.                              |
| Mutation tests (Stryker)        | weekly       | Asks whether the tests would notice a change. Baseline 81.6%, break at 81; the survivors name the next tests worth writing.                                             |
| jsx-a11y, axe                   | lint, e2e    | WCAG 2.1 AA on every page in both themes, contrast included.                                                                                                            |
| `pnpm audit --audit-level high` | CI           | Any new high advisory fails the PR; the two ignored ones are listed by id, with the reason.                                                                             |

Property and mutation tests are core-only on purpose: core is where a silent off-by-one costs
money, its functions are pure, and its suite runs in milliseconds.

The first CI run earned its place: an e2e spec failed only on the runner, because it clicked the
month menu before the page had switched. Reproduced locally at 6× CPU throttling and fixed.

## `pnpm check`: one command, quiet when green

`scripts/check.mjs` runs format → lint → deps → unused → dupes → types → unit, cheapest first. A green run
prints one line per step. On failure it prints that step's full output and stops — the agent gets
the failure, not the failure buried under four passing tools. That matters for an agent: its
context is finite, and noise from passing steps crowds out the one line that matters.

## CLAUDE.md as the contract

[CLAUDE.md](../CLAUDE.md) is what the agent reads first, and kept short enough to be read:

- **WHAT / HOW / WHY / RULES** — layout, commands, the local-only constraint, the four hard rules.
- **Invariants with their reasons.** Each links to the research that made it, and says "do not
  undo one without reading it" — so the agent meets the reason before the temptation.
- **Link, do not inline.** Anything longer than a few lines lives under `docs/` and is linked.
- **One verification rule:** run `pnpm check` before saying you are done — which the Stop hook
  enforces.

## Project skills

| Skill                                       | For                                                                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commit`                                    | Runs `pnpm check` and stops if it fails, refuses `data/` and `.env` files, writes a Conventional Commits message from the staged diff.                                                                        |
| `add-bank-format`                           | The five artefacts a new bank needs, in order: research note, synthetic byte-exact fixture (generated by a script, checked byte by byte), dialect parser, tests, and the API/UI/Playwright wiring. Has evals. |
| `rpi-research`, `rpi-plan`, `rpi-implement` | The workflow above. Vendored, with their output paths overridden to `docs/research/` and `docs/plans/`.                                                                                                       |

A repeated multi-step task became a skill once it had a shape worth repeating. The Deutsche Bank
format ([plan 10](plans/10-deutsche-bank-csv.md)) went in as the second bank.

## Verification beyond tests

Tests check what someone thought to assert. Two sessions looked for what nobody had:

- **Dogfood** (the `dogfood` skill driving a real browser through agent-browser,
  [report](reports/2026-09-23-dogfood.md)): 13 issues, from a budget field that dropped the
  thousands separator to category deletes with no undo. Seven fixed, two handled by the language
  switch (plan 07), two won't-fix for now, one not reproducible, and one review claim shown not
  to be a bug. Two of the findings came from the user exercising the app alongside it.
- **Security review** ([report](reports/2026-09-24-security-review.html)): one high finding —
  the API listened on all interfaces, with no login and CORS accepting any origin, so the LAN
  and any web page could reach it — and six low ones: missing multer limits, a MIME check that
  trusted the client, uncapped row errors, log injection through file names, and two
  `.gitignore` gaps. Fixed in [plan 06](plans/06-security-hardening.md): loopback bind,
  Host/Origin guard, no CORS, upload limits, capped and sanitised errors and logs.

Still the agent was able to find some open points and suggest improvements. That was surprising for me. Especially for agent-browser it was doing it with browser and was very fast. I was using normally playwright and it was taking a lot of time to find the issues. But agent-browser was doing it in seconds. I was surprised.

## Data safety

The app handles bank statements, so the most expensive mistake is committing one. Four layers
stop it, each independent of the others:

1. Test data is synthetic, in `fixtures/`, generated by a script — never a real export.
2. `.gitignore` excludes `data/`, `*.db`, `*.csv` (with `fixtures/**/*.csv` as the one exception).
3. The pre-commit data guard (`scripts/check-staged-data.mjs`) runs first, before anything else.
4. CI runs the same guard over every tracked file, so `git add -f` plus `LEFTHOOK=0` still fails.

And the agent's hooks refuse to read the real database at all.

## Lessons

- small goals for RPI skills, with a clear output path, make it easier to review and verify the agent's work.
- new guardrails like fast-check and Stryker mutation tests are worth the effort, because they catch what the agent misses.
- always use dogfood and security review to find what the agent cannot find. The agent is fast, but it is not perfect.
