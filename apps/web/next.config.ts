import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const nextConfig: NextConfig = {
  // Workspace packages export TypeScript source (no build step), so Next compiles them.
  transpilePackages: ['@skirm/ui', '@skirm/shared', '@skirm/engine'],
  // The npm workspace root holds node_modules and the lockfile.
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  // NEXT_DIST_DIR lets several builds or dev servers share this folder (e.g. parallel e2e runs).
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // The Docker image (docker/node.Dockerfile, APP=web) builds with NEXT_OUTPUT=standalone and runs
  // the self-contained server.js. Off by default: `next start` (dev, Playwright) warns under it.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' as const } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
