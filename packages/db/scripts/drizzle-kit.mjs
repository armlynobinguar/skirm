// Runs drizzle-kit with `drizzle-orm` resolved from this package.
// npm installed drizzle-orm under packages/db/node_modules (not hoisted), so drizzle-kit, which
// lives in the root node_modules, cannot find it on its own.
// Usage: node scripts/drizzle-kit.mjs generate
import { readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('drizzle-orm'));
const exportsMap = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).exports;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'drizzle-orm' || specifier.startsWith('drizzle-orm/')) {
      const sub = specifier === 'drizzle-orm' ? '.' : `./${specifier.slice('drizzle-orm/'.length)}`;
      const entry = exportsMap[sub];
      if (entry) {
        const isImport = (context.conditions ?? []).includes('import');
        const rel = (isImport ? entry.import : entry.require)?.default ?? entry.default;
        return { url: pathToFileURL(join(pkgDir, rel)).href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
});

const bin = join(dirname(require.resolve('drizzle-kit')), 'bin.cjs');
process.argv = [process.argv[0], bin, ...process.argv.slice(2)];
require(bin);
