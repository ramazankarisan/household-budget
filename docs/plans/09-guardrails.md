---
date: 2026-09-28
branch: chore/guardrails
topic: 'Guardrails: CI, coverage ratchets, property and mutation tests, unused-code, architecture, a11y, commit and dependency hygiene'
tags: [plan, tooling, ci, testing, packages-core, apps-api, apps-web]
status: implemented
---

# PLAN: Guardrails

Before this, the gates were format, lint, one dependency-cruiser rule, typecheck, unit tests
and Playwright, all run by git hooks on the developer's machine, where `LEFTHOOK=0` skips
them. This plan adds the checks those miss and puts each one only where it fits, so `pnpm
check` stays fast enough to run after every change.

## Where each guardrail runs

| Guardrail                       | core | api | web | Runs in                             |
| ------------------------------- | :--: | :-: | :-: | ----------------------------------- |
| CI (`pnpm check:all`)           |  ✓   |  ✓  |  ✓  | GitHub Actions, every PR and `main` |
| Coverage thresholds             |  ✓   |  ✓  |  ✓  | `pnpm check` (`unit` step)          |
| Unused code/deps (knip)         |  ✓   |  ✓  |  ✓  | `pnpm check` (`unused` step)        |
| Architecture rules              |  ✓   |  ✓  |  ✓  | `pnpm check` (`deps` step)          |
| Property tests (fast-check)     |  ✓   |     |     | `pnpm check` (ordinary unit tests)  |
| Mutation tests (Stryker)        |  ✓   |     |     | `pnpm mutation`, by hand            |
| a11y lint (jsx-a11y)            |      |     |  ✓  | `pnpm check` (`lint` step)          |
| a11y in the browser (axe)       |      |     |  ✓  | `pnpm check:all` (`wcag.spec.ts`)   |
| Commit messages (commitlint)    |  —   |  —  |  —  | `commit-msg` hook                   |
| `pnpm audit --audit-level high` |  —   |  —  |  —  | CI                                  |
| Dependabot                      |  —   |  —  |  —  | GitHub, weekly                      |

Property and mutation tests are core-only on purpose: core is where a silent off-by-one costs
money, its functions are pure, and its suite runs in milliseconds. The apps' logic is mostly
wiring that example tests and Playwright already cover.

## Decisions

1. **Coverage thresholds are a ratchet.** Each package's `coverage.thresholds` sits just
   under what its suite measured when they were set, with `include: src/**` so an untested
   file counts. Raise them when coverage rises; never lower them to let a change through.
   Set at: core 95/87/97/95, api 85/80/73/85, web 82/76/78/82 (statements, branches,
   functions, lines).
2. **Property tests state the invariants the example tests sample.** Every German amount
   spelling round-trips to exact cents; every real date round-trips; `monthlyReport` totals
   exactly the money out, ignores row order, and marks a category over only when strictly
   over; `normalize` is idempotent; rule order is total, so load order cannot change the
   winner; dedup keys are unique within a file and stable when a later export extends it.
3. **Stryker uses the command runner, not `@stryker-mutator/vitest-runner`.** Under Vitest 5
   the plugin never activated a mutant: every mutant "survived", including an emptied
   `matchRule`, for a score of 36% that measured nothing. The command runner activates each
   mutant through an environment variable. It is slower (no per-test coverage, ~2.5 min for
   core) and honest. `concurrency: 4`, because each worker is a whole Vitest process.
   Baseline 78.4%, break at 78. Weakest: `csv/parse.ts` 60%, `csv/header.ts` 61%. Those
   survivors are the next tests worth writing.
4. **dependency-cruiser covers all three packages.** New rules: core never imports the apps;
   the apps import core's built package, never `packages/core/src`; api and web never import
   each other; web never imports NestJS, Prisma, Node built-ins or `@household-budget/core/csv`;
   no cycles. Each rule was proven by planting a violation and seeing it fail. Node built-ins
   need their own rule because dependency-cruiser tags them by type (`core`), not by path.
5. **knip removed eight exports that nothing outside their own file used.** They are not dead
   code, just needlessly exported. `@prisma/client` is ignored because only the git-ignored
   generated client imports it.
6. **jsx-a11y's `no-autofocus` uses `ignoreNonDOM`.** Every `autoFocus` here is on a MUI field
   inside a popover or form the user just opened, which is the accessible behaviour. The rule
   targets focus stolen on page load, and still applies to raw DOM elements.
7. **axe runs with transitions off.** On `/rules` the add button fades from disabled to
   enabled once categories load, and axe measured it mid-fade (#81a39d on white, 2.74:1). The
   settled colours pass. Named `wcag.spec.ts` rather than `a11y`, because specs run
   alphabetically against one database and `import.spec.ts` must meet it empty.
8. **commitlint allows any subject case and long body lines.** Subjects name German UI terms
   (`feat: Regeln as sentences`), and bodies link docs.
9. **Two audit advisories are ignored by id** in `pnpm-workspace.yaml`, both transitive
   through the Prisma CLI and both unreachable here: `mysql2` (no MySQL connection is ever
   opened) and `deepmerge-ts` (it only merges our own `prisma.config.ts`). Any new high
   advisory still fails CI. Drop the ignores once Prisma ships the patched versions.
10. **Dependabot skips the deliberate pins** README lists: TypeScript minor/major and Prisma
    major. pnpm's minimum-release-age quarantine may hold a days-old Dependabot bump until it
    ages or gets a `minimumReleaseAgeExclude` entry.

## Not done

- Mutation testing in CI: 2.5 minutes of CPU on every push, for a signal that changes only
  when core's tests do. Run `pnpm mutation` when changing the parser or the budget math.
- Type-aware lint beyond the floating-promise overlay: tsc strict already covers it (see
  `eslint.config.mjs`).
