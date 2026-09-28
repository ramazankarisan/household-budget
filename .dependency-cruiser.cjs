/**
 * Architecture enforcement for the whole workspace: packages/core, apps/api, apps/web.
 *
 * CLAUDE.md RULES: "packages/core must never import NestJS, React, or Prisma [...] A framework
 * import anywhere in packages/core/src is a bug, including a type-only one." That rule was prose
 * until this config existed. `pnpm lint:deps` now fails the build instead.
 *
 * This file is .cjs because the root package is "type": "commonjs" while every workspace
 * package is "type": "module".
 */
module.exports = {
  forbidden: [
    {
      name: 'core-stays-framework-free',
      severity: 'error',
      comment:
        'packages/core holds pure domain logic. It must stay testable without booting a server, ' +
        'a browser or a database, and both apps must be able to import it. Importing NestJS, ' +
        'React or Prisma from core breaks all three. See CLAUDE.md RULES.',
      from: { path: '^packages/core/src' },
      /*
       * Two alternatives on purpose. core declares none of these as dependencies, so an
       * import of one does not resolve and dependency-cruiser reports the bare specifier
       * ("@nestjs/common"). If core ever did depend on one, it would instead resolve to a
       * "node_modules/..." path. Matching only the second form lets the common case — the
       * mistake this rule exists to catch — pass silently.
       */
      to: {
        path: '^(@nestjs|@prisma|react|react-dom)(/|$)|node_modules/(@nestjs|@prisma|react|react-dom)(/|$)',
      },
    },
    {
      name: 'core-stays-out-of-the-apps',
      severity: 'error',
      comment:
        'Dependencies point one way: the apps depend on core, never the reverse. A core module ' +
        'reaching into an app would make core untestable alone and every app a dependency of ' +
        'the other.',
      from: { path: '^packages/core/src' },
      to: { path: '^apps/' },
    },
    {
      name: 'apps-use-built-core',
      severity: 'error',
      comment:
        'Both apps import @household-budget/core — its built dist/ — never its source by ' +
        'relative path. A relative import skips the package exports map, so it can reach ' +
        'the Node-only csv entry from the browser and compiles core twice. CLAUDE.md WHAT.',
      from: { path: '^apps/' },
      to: { path: '^packages/core/src' },
    },
    {
      name: 'apps-stay-apart',
      severity: 'error',
      comment:
        'The API and the web app share nothing but core. A type both need belongs in core ' +
        '(AccountPayload, TransactionPayload, …): that is what makes it the contract.',
      from: { path: '^apps/(api|web)/' },
      to: { path: '^apps/(api|web)/', pathNot: '^apps/$1/' },
    },
    {
      name: 'web-stays-in-the-browser',
      severity: 'error',
      comment:
        'apps/web ships to a browser. NestJS, Prisma and node: built-ins do not run there, and ' +
        '@household-budget/core/csv wraps csv-parse, whose Node build needs Buffer — exporting ' +
        'it to the web bundle breaks it. Parsing happens in the API. CLAUDE.md WHAT. Node ' +
        'built-ins are the next rule: dependency-cruiser tags them by type, not by path.',
      from: { path: '^apps/web/src', pathNot: '\\.test\\.tsx?$|^apps/web/src/test/' },
      to: {
        path:
          '^(@nestjs|@prisma)(/|$)|node_modules/(@nestjs|@prisma)(/|$)|' +
          '^packages/core/dist/csv/',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'web-never-reaches-csv-parse',
      severity: 'error',
      comment:
        'The rule above sees direct imports only. The way csv-parse would actually reach the ' +
        "browser is indirect: core's root entry re-exporting something from csv/. Reachability " +
        "follows the whole chain, through core's built dist/.",
      from: { path: '^apps/web/src', pathNot: '\\.test\\.tsx?$|^apps/web/src/test/' },
      to: { path: '(^|/)csv-parse(/|$)', reachable: true },
    },
    {
      name: 'web-has-no-node-builtins',
      severity: 'error',
      comment:
        'fs, path, crypto and friends do not exist in a browser. See web-stays-in-the-browser.',
      from: { path: '^apps/web/src', pathNot: '\\.test\\.tsx?$|^apps/web/src/test/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'A cycle means neither module can be understood, tested or loaded without the other, ' +
        'and under ESM one of them sees the other half-initialised.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment:
        'An import dependency-cruiser cannot resolve is also an import it cannot check against ' +
        'core-stays-framework-free. Without this tripwire, a future change that breaks module ' +
        'resolution would turn the rule above into a vacuous pass.',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    /*
     * Without this, TypeScript erases `import type` before dependency-cruiser sees the module
     * graph, so `import type { INestApplication } from '@nestjs/common'` would pass silently.
     * CLAUDE.md counts type-only imports as violations, so they have to be visible here.
     */
    tsPreCompilationDeps: true,
    /*
     * Deliberately no `tsConfig` entry. Pointing it at packages/core/tsconfig.json makes
     * dependency-cruiser resolve that file's `extends: "../../tsconfig.base.json"` against the
     * wrong root and fail with TS5083. core has no path aliases, so the compiler defaults are
     * enough — tsPreCompilationDeps alone is what makes type-only imports visible.
     */
    /*
     * Test files are deliberately NOT excluded. CLAUDE.md says a framework import "anywhere in
     * packages/core/src" is a bug, and a react import in hello.test.ts is still core depending
     * on react.
     */
    doNotFollow: { path: 'node_modules' },
    // Written by `prisma generate`, git-ignored, and not ours to hold to these rules.
    exclude: { path: '^apps/api/src/generated/' },
    /*
     * Teaches the resolver to read a package's "exports" map. Without it a subpath export
     * such as `csv-parse/sync` is unresolvable — the bare package name resolves, the subpath
     * does not — and `not-to-unresolvable` reports it. That would be a false positive: the
     * import is real, resolvable by Node, tsc and Vite alike. The point of this block is to
     * keep the tripwire meaningful rather than to switch it off.
     */
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'types', 'default'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
