import { defineConfig } from 'tsup';

// One ESM file with a shebang, so `node packages/mcp/dist/main.js` (or the `skirm-mcp` bin) starts
// the stdio server. `ws` stays external.
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  splitting: false,
  banner: { js: '#!/usr/bin/env node' },
});
