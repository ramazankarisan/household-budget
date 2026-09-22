import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vitest transforms with esbuild, which drops `emitDecoratorMetadata`.
  // NestJS DI needs that metadata, so SWC handles the transform instead.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
