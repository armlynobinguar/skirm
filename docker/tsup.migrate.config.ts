// Bundles the @skirm/db migrate CLI (packages/db/src/migrate.ts) into one ESM file for the
// `migrate` image (docker-compose service, Cloud Run job). Run from the repo root:
//   npx tsup --config docker/tsup.migrate.config.ts      -> dist/migrate/main.js
// drizzle-orm lives only in packages/db/node_modules (not hoisted), so it is bundled. pg stays
// external: it lazily requires the optional `pg-native`, which esbuild cannot resolve. The
// createRequire banner lets bundled CommonJS code call require() for node builtins under ESM.
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { main: 'packages/db/src/migrate.ts' },
  outDir: 'dist/migrate',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  noExternal: [/^@skirm\//, /^drizzle-orm(\/|$)/],
  external: ['pg', 'pg-native'],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
