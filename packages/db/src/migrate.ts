// CLI entry: `node dist/migrate.js` (apps bundle this file as their migrate entry).
// This module RUNS the migration when loaded and exports nothing; to migrate from code, import
// `runMigrateCli` (or `migrate`) from '@skirm/db' instead, which has no side effects on import.
import { runMigrateCli } from './migrator';

runMigrateCli().catch((err: unknown) => {
  console.error(`[migrate] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
