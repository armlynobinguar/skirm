import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['test/**/*.test.ts'],
    // Tests that play a full match take seconds alone and can pass 30 s on a loaded CI runner.
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
