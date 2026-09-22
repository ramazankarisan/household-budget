import { resolve } from 'node:path';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Kept in step with src/test/global-setup.ts, which creates the schema in this file.
// Set here rather than in the setup because apps/api/src/config/database.ts is read
// when PrismaService is constructed, which happens inside the worker.
const TEST_DATABASE_URL = `file:${resolve(import.meta.dirname, 'data', 'test.db')}`;

export default defineConfig({
  // Vitest transforms with esbuild, which drops `emitDecoratorMetadata`.
  // NestJS DI needs that metadata, so SWC handles the transform instead.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['./src/test/global-setup.ts'],
    env: { DATABASE_URL: TEST_DATABASE_URL },
  },
});
