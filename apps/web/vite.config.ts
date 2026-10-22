import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { normalizePath, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// 127.0.0.1, not localhost: Node resolves localhost to ::1 first, so anything else
// holding [::1]:3000 gets the proxied /api requests even though the API is listening.
//
// Overridable because the Playwright run puts its own API on another port, so an e2e
// suite and a `pnpm dev` session can be up at the same time without either one reaching
// the other's database.
const API_TARGET = process.env['API_TARGET'] ?? 'http://127.0.0.1:3000';

// normalizePath: Vite ids use forward slashes on every platform, fileURLToPath does not.
const REAL_CLIENT = normalizePath(fileURLToPath(new URL('./src/api/client.ts', import.meta.url)));
const DEMO_CLIENT = normalizePath(fileURLToPath(new URL('./src/demo/client.ts', import.meta.url)));
/** Any specifier that can name the client: `../api/client`, `./client`, with or without `.ts`. */
const CLIENT_SPECIFIER = /(?:^|\/)client(?:\.ts)?$/u;

/**
 * The hosted demo (plan 12): every import of `src/api/client.ts` resolves to the in-memory
 * `src/demo/client.ts` instead, so the build talks to no server at all. Registered only in
 * `--mode demo` — this plugin is the one way into `src/demo/`, and `lint:deps` keeps it so.
 */
function demoClient(): Plugin {
  return {
    name: 'household-budget:demo-client',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // Only a specifier ending in `client` can be the client; everything else resolves once.
      if (!CLIENT_SPECIFIER.test(source)) {
        return null;
      }
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved?.id === REAL_CLIENT ? DEMO_CLIENT : null;
    },
  };
}

/**
 * GitHub Pages has no SPA fallback: an unknown path gets `404.html`. Making that the app
 * itself means a deep link like `/household-budget/rules` still opens the page it names.
 */
function spaFallback(): Plugin {
  let outDir = '';
  return {
    name: 'household-budget:spa-fallback',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    // writeBundle, not closeBundle: it runs only after a build that wrote its files.
    writeBundle() {
      copyFileSync(resolve(outDir, 'index.html'), resolve(outDir, '404.html'));
    },
  };
}

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    plugins: demo ? [demoClient(), spaFallback(), react()] : [react()],
    // The demo is served from a project page, `https://<user>.github.io/<repo>/`.
    base: demo ? (process.env['DEMO_BASE'] ?? '/household-budget/') : '/',
    build: demo ? { outDir: 'dist/demo' } : {},
    server: {
      port: 5173,
      // Same-origin in dev: the browser only ever talks to :5173, so there is no
      // CORS to configure and no API base URL to keep in an env file.
      proxy: {
        '/api': {
          target: API_TARGET,
          changeOrigin: true,
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // See packages/core/vitest.config.ts for how the thresholds are kept.
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/*.d.ts', 'src/main.tsx'],
        reporter: ['text-summary'],
        thresholds: { statements: 82, branches: 76, functions: 78, lines: 82 },
      },
    },
  };
});
