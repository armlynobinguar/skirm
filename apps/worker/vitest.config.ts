import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['test/**/*.test.ts'],
    // Full matches (engine, ledger, pglite) take ~10 s alone and >30 s on a loaded CI runner.
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
