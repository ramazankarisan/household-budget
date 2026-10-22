---
date: 2026-10-22T08:45:05Z
git_commit: 835b9b81c382734de2979baa0f86e44192ca04e8
branch: feat/hosted-demo
topic: 'A hosted demo on GitHub Pages: the real UI over an in-memory API, no backend'
tags: [plan, apps-web, demo, github-pages, security]
status: implemented
---

# PLAN: Hosted read-only demo

The README shows screenshots and an animated demo; a visitor still cannot _use_ the app
without cloning it. This puts the real UI on a public URL, with synthetic data, without
putting the API anywhere but on the owner's own machine.

## Options

|                            | A. Static web build, in-memory client (chosen)        | B. Deploy the API with a demo flag                 |
| -------------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| Loopback guard             | Untouched — the API is not deployed at all            | Needs a bypass switch in the guard                 |
| Hosting                    | GitHub Pages, free for a public repo                  | A Node host with a disk (Fly, Render…), an account |
| What a visitor's edits hit | Their own tab; a reload starts over                   | One shared SQLite file, needs resetting            |
| Abuse surface              | None — static files                                   | Uploads, rate limits, a server to keep alive       |
| Fidelity                   | Reports and rule matching run core, as the API does   | Exact                                              |
| Cost                       | One alternative `client.ts` to keep in step with HTTP | A second deployment to secure and pay for          |

B fails the brief twice: a flag that turns the guard off is a flag that can be left on (plan
06 exists to make that impossible), and it needs a paid account. A wins.

## Decisions

1. **Same UI, different transport.** `pnpm --filter @household-budget/web build:demo` runs
   `vite build --mode demo`. In that mode only, a small Vite plugin resolves
   `src/api/client.ts` to `src/demo/client.ts`, which exports the same functions over an
   in-memory store. No page, hook or component knows it is a demo except the banner. The
   normal `build` and `dev` never see `src/demo/` — the plugin is the only way in, and
   `lint:deps` forbids importing `src/demo/` from anywhere else in `src`.
2. **`ApiError` moves to `src/api/error.ts`**, re-exported by the real client unchanged, so
   the demo client can throw the same class without importing the module it replaces.
3. **The demo client reuses core, as the API does.** `parseRuleInput`, `orderRules`,
   `matchingRule`, `isValidIban`, `normalize` — the same refusals (`RULE_INVALID`,
   `CATEGORY_IN_USE`, `RULE_ORDER_STALE`, …) with the same `ApiError` shape, so error wording
   in `src/locales` works unchanged. Apply writes `null` as well as matches, and respects the
   lock, exactly like `RuleService.applyAll`.
4. **One synthetic generator.** The six-month Sparkasse household (`bookings()`, `SETUP`, the
   IBAN) moves from `e2e/docs-images.capture.ts` to `src/demo/household.ts`. The capture keeps
   building its CSV from it; the demo turns the same bookings straight into
   `TransactionPayload`s, then creates the six categories, rules and three months of limits
   and applies the rules — the state the README images show. Never a real statement.
5. **Read-only towards the outside, writable inside the tab.** Rules, categories, budgets and
   manual picks all work and live in memory; a reload starts from the seed again. Uploading a
   file is refused with `DEMO_READ_ONLY` („Im Demo wird keine Datei gelesen …“): the CSV
   parser is Node-only (`@household-budget/core/csv`), and a portfolio demo should not invite
   anyone to drop a real statement onto a public page, even one that would never send it.
   Removing and restoring the seeded upload on /imports works.
6. **A banner says so** on every page: synthetic data, changes stay in this tab, link to the
   repo to run it locally. Worded in `de` and `en`.
7. **Served under `/household-budget/`.** `base` comes from `DEMO_BASE` (default
   `/household-budget/`), `BrowserRouter` gets `basename={import.meta.env.BASE_URL}` — `/` in
   the real app, so nothing changes there. Pages has no SPA fallback, so the build copies
   `index.html` to `404.html`; a deep link like `/household-budget/regeln` then still loads.
8. **Deploy by Actions**, `.github/workflows/demo.yml`: on push to `main` (and by hand),
   build core, `build:demo`, `actions/upload-pages-artifact`, `actions/deploy-pages`. Least
   privilege: `contents: read`, `pages: write`, `id-token: write`. CI (`ci.yml`) also runs
   `build:demo` so a client change that breaks the demo fails the PR, not the deploy.
9. **Owner's account, owner's say.** Enabling Pages (Source: GitHub Actions) touches the
   owner's account, so it was asked first. Until it is on, the deploy job fails visibly and
   nothing else is affected.

## Tests

- `src/demo/client.test.ts`: seed shape (accounts, six categories, rules applied, budgets for
  three months); apply clears a deleted rule's rows and spares locked ones; `CATEGORY_IN_USE`
  counts; reorder stale; upload refused with `DEMO_READ_ONLY`; returned rows are copies.
- E2E: `demo.spec.ts` against `vite preview` of the demo build — Überblick renders the report,
  a rule edit re-categorizes, a deep link loads, and **no request goes to `/api`**.
- Real app unchanged: existing suite green; `pnpm build` output contains no demo code.

## Implementation notes

- Approved by the owner on 2026-10-22, with the import refused (decision 5) and Pages enabled
  by `gh api -X POST repos/ramazankarisan/household-budget/pages -f build_type=workflow` at
  their request.
- **The demo's months follow the calendar.** `bookings(end)` takes the export day: the demo
  passes today, so a visitor always lands on a current month with six months behind it; the
  README capture passes 20 October 2026, and its CSV is byte-identical to the one the capture
  built before the generator moved.
- **Built to `dist/demo`**, already git- and lint-ignored under `dist`. The real `vite build`
  empties `dist/`, demo included; the two are never shipped together.
- **CI covers it without a new step.** The `demo` Playwright project builds the demo and
  serves it with `vite preview`, so `pnpm check:all` fails a change that breaks it. The deploy
  workflow (`demo.yml`) only builds and publishes, on push to `main`.
- **Isolation is enforced, not hoped for.** `demo-only-through-its-build` in
  `.dependency-cruiser.cjs` refuses any import of `src/demo/` from the rest of `src/`; the
  banner sits behind `import.meta.env.MODE === 'demo'`, which Vite folds to `false` in the real
  build. `demo.spec.ts` builds the real app and asserts it carries no demo client or banner
  and still calls `/api`; the demo bundle never does.
- **Review (`/code-review high`)** fixed: the swap now compares normalized paths (Windows) and
  only resolves specifiers ending in `client`; `404.html` is written in `writeBundle`, so a
  failed build is not masked; the seeded upload reads `utf-8`, as the README capture's does.
  Left as is: the demo server starts for every Playwright run (one ~1 s build), and the
  client mirrors the API services rather than sharing them through core — moving apply,
  reorder and the in-use check into core is a refactor of the API, not part of this plan.

## Not doing

- Importing a file in the browser (needs a browser build of the parser; revisit if wanted).
- Persisting demo edits in `localStorage` — a fresh seed per visit is the point.
