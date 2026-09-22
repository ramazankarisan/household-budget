import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// 127.0.0.1, not localhost: Node resolves localhost to ::1 first, so anything else
// holding [::1]:3000 gets the proxied /api requests even though the API is listening.
const API_TARGET = 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
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
  },
});
