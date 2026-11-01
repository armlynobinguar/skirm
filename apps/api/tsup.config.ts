import { defineConfig } from 'tsup';

// Bundles the api into one ESM file. Workspace packages (@skirm/*) are bundled from source, and so is
// drizzle-orm (installed only under packages/db/node_modules, so it cannot be resolved at runtime
// from apps/api). Other third-party deps stay external and resolve from the root node_modules.
// tsup runs @swc/core over the sources because tsconfig sets emitDecoratorMetadata (Nest DI).
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: [/^@skirm\//, /^drizzle-orm/],
  // Google Cloud SDKs (the KMS vault in @skirm/server) load protos and JSON from
  // their package dirs, so they stay external and resolve from the root node_modules at runtime.
  external: [/^@google-cloud\//],
  // CommonJS deps bundled into ESM (pg via drizzle, bullmq, ioredis) call require(); give them one.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
