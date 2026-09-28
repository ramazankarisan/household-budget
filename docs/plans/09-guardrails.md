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

| Guardrail                       | core | api | web | Runs in                              |
| ------------------------------- | :--: | :-: | :-: | ------------------------------------ |
| CI (`pnpm check:all`)           |  ✓   |  ✓  |  ✓  | GitHub Actions, every PR and `main`  |
| Bank-data guard, gitleaks       |  —   |  —  |  —  | pre-commit (staged) and CI (all)     |
| Coverage thresholds             |  ✓   |  ✓  |  ✓  | `pnpm check` (`unit` step)           |
| Unused code/deps (knip)         |  ✓   |  ✓  |  ✓  | `pnpm check` (`unused` step)         |
| Architecture rules              |  ✓   |  ✓  |  ✓  | `pnpm check` (`deps` step)           |
| Property tests (fast-check)     |  ✓   |     |     | `pnpm check` (ordinary unit tests)   |
| Mutation tests (Stryker)        |  ✓   |     |     | CI weekly (Mon), and `pnpm mutation` |
| a11y lint (jsx-a11y)            |      |     |  ✓  | `pnpm check` (`lint` step)           |
| a11y in the browser (axe)       |      |     |  ✓  | `pnpm check:all` (`wcag.spec.ts`)    |
| Commit messages (commitlint)    |  —   |  —  |  —  | `commit-msg` hook                    |
| `pnpm audit --audit-level high` |  —   |  —  |  —  | CI                                   |

The hooks run each check once. pre-commit: data guard, gitleaks, format and lint on the
staged files. pre-push: `check.mjs --push` — deps, unused, types, unit with coverage, the
checks that are whole-project by nature. Playwright runs in CI only; CI is the gate that
cannot be skipped, so the hooks exist to catch the common mistake early, not to repeat it.

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
   mutant through an environment variable. It is slower (no per-test coverage, ~3 min for
   core) and honest. `concurrency: 4`, because each worker is a whole Vitest process. The
   sandbox is a copy of core two folders deeper, so a test's `../../../../fixtures/` would
   miss; `vitest.config.ts` aliases every fixtures import to `FIXTURES_DIR`, which Stryker
   sets. Baseline 81.6% after the Deutsche Bank rewrite (78.4% before it), break at 81.
   Weakest: `csv/errors.ts` 57%, `csv/header.ts` 65%, `csv/parse.ts` 70%. Those survivors
   are the next tests worth writing. It runs weekly in CI (`mutation.yml`, Mondays, and on
   demand from the Actions tab) rather than per PR: ~3 minutes for a signal that only moves
   when core or its tests change. A drop below the break fails that run and GitHub emails
   it; the HTML report of the survivors is kept as an artifact for 30 days.
4. **dependency-cruiser covers all three packages.** New rules: core never imports the apps;
   the apps import core's built package, never `packages/core/src`; api and web never import
   each other; web never imports NestJS, Prisma, Node built-ins or `@household-budget/core/csv`
   at runtime, and never reaches `csv-parse` through any chain — the indirect path, core's
   root entry re-exporting the parser, is the likely one; no cycles. Each rule was proven by
   planting a violation and seeing it fail. Node built-ins need their own rule because
   dependency-cruiser tags them by type (`core`), not by path. Type-only imports into web are
   allowed: they are erased before the browser sees them.
5. **knip removed eight exports that nothing outside their own file used.** They are not dead
   code, just needlessly exported. `@prisma/client` is ignored because only the git-ignored
   generated client imports it.
6. **jsx-a11y's `no-autofocus` stays strict**, with a line-level exception, reason included, on
   the two `autoFocus` uses: the category menu's search and the inline rule editor, both
   opened by the user. `ignoreNonDOM` would have exempted every MUI component, which is almost
   every element here.
7. **axe runs with transitions off.** On `/rules` the add button fades from disabled to
   enabled once categories load, and axe measured it mid-fade (#81a39d on white, 2.74:1). The
   settled colours pass. Named `wcag.spec.ts` rather than `a11y`, because specs run
   alphabetically against one database and `import.spec.ts` must meet it empty. It seeds with
   `withFixture`, not `importFixture`: a repeated upload replaces the vorgemerkt rows.
8. **commitlint allows any subject case and long body lines.** Subjects name German UI terms
   (`feat: Regeln as sentences`), and bodies link docs.
9. **Two audit advisories are ignored by id** in `pnpm-workspace.yaml`, both transitive
   through the Prisma CLI and both unreachable here: `mysql2` (no MySQL connection is ever
   opened) and `deepmerge-ts` (it only merges our own `prisma.config.ts`). Any new high
   advisory still fails CI. Drop the ignores once Prisma ships the patched versions.
10. **CI runs the bank-data guard over every tracked file** (`check-staged-data.mjs --all`).
    The hook sees only staged files and can be skipped; a CSV committed with `git add -f` and
    `LEFTHOOK=0` would otherwise reach the repository with CI green.
11. **CI uploads `apps/web/test-results/` on failure.** CI runs Playwright with the dot
    reporter, so there is no HTML report; traces and screenshots are in `test-results/`.
    The first CI run showed why it matters: `monthly-budgets.spec.ts` failed only on the
    runner — it opened the month menu before Überblick had replaced Umsätze, so the click
    landed on the old page's menu. Reproduced locally at 6× CPU throttling and fixed in the
    spec by waiting for the Überblick heading.

## Not done

- Dependabot or Renovate: dependency updates stay manual, by choice. `pnpm audit` in CI
  still fails on a new high advisory.
- Type-aware lint beyond the floating-promise overlay: tsc strict already covers it (see
  `eslint.config.mjs`).
- Building core once per `pnpm check` instead of in each of deps, types and unit: about a
  second each, and each script staying correct when run alone is what caught the fresh-
  checkout failure of `lint:deps`.
- `eslint-plugin-jsx-a11y@6.10.2` declares ESLint ≤ 9 as its peer; it works on ESLint 10 here.
  Revisit when a release declares 10.
