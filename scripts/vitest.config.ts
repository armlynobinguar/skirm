import { defineConfig } from 'vitest/config';

// Tests for the repo scripts (none yet). Run: npm run test:scripts
export default defineConfig({
  test: {
    root: __dirname,
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
