import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

// Component and unit tests (jsdom). Browser e2e lives in e2e/ and runs with Playwright.
export default defineConfig({
  resolve: { alias: { '@': path.join(here, 'src') } },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    // Form-heavy screen tests take ~2.5 s alone and passed the 5 s default with every file in parallel.
    testTimeout: 30_000,
  },
});
