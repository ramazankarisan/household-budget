/**
 * Architecture enforcement for packages/core.
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
    /*
     * Teaches the resolver to read a package's "exports" map. Without it a subpath export
     * such as `csv-parse/sync` is unresolvable — the bare package name resolves, the subpath
     * does not — and `not-to-unresolvable` reports it. That would be a false positive: the
     * import is real, resolvable by Node, tsc and Vite alike. The point of this block is to
     * keep the tripwire meaningful rather than to switch it off.
     */
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
