import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * One flat config for the whole workspace — `pnpm lint` runs `eslint .` from the root.
 *
 * Type-aware rules are off for the bulk of the config: `pnpm typecheck` already runs tsc
 * with the full strict set from tsconfig.base.json, so lint stays fast and stays out of the
 * "file is not in any project" failure mode.
 *
 * The one exception is the floating-promise overlay near the bottom. Those two rules cannot
 * work without type information and catch the one class of bug tsc does not: a promise that
 * is never awaited. It is scoped to src/ only, so config files stay out of the project service.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'apps/api/src/generated/**',
      'apps/api/prisma/migrations/**',
      'data/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/blob-report/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strict,

  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Node-side packages.
  {
    files: ['apps/api/**/*.ts', 'packages/core/**/*.ts', '*.{js,mjs,cjs,ts}', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // NestJS leans on parameter decorators and class metadata.
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
      // A constructor parameter type looks type-only to this rule, but Nest
      // reads it at runtime via design:paramtypes. Rewriting those to `import
      // type` silently breaks dependency injection.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },

  // Browser-side app.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
  },

  // Test files get the Vitest globals (`globals: true` in both vitest configs).
  // Playwright specs are *.spec.ts under apps/web/e2e and import their own helpers, but they
  // run in Node and need the same treatment.
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.ts', 'apps/web/e2e/**/*.spec.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },

  // Type-aware overlay. Only these two rules need type information, and they are the
  // reason the rest of the config can stay type-unaware: an unawaited promise is invisible
  // to both tsc and non-type-aware lint. Scoped to src/ so vite.config.ts, prisma.config.ts
  // and this file are never handed to the project service.
  {
    files: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },

  // Same two rules for the Playwright specs — a Playwright `expect(...)` without `await` is
  // the single most common way an e2e spec silently passes. These files need an explicit
  // `project`: the project service only auto-discovers tsconfig.json, and e2e is covered by
  // apps/web/tsconfig.e2e.json.
  {
    files: ['apps/web/e2e/**/*.spec.ts', 'apps/web/playwright.config.ts'],
    languageOptions: {
      parserOptions: {
        project: './apps/web/tsconfig.e2e.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },

  // Must stay last: turns off every rule that fights Prettier.
  prettier,
);
