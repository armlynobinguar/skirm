// In-process Postgres (PGlite) with migrations applied, for tests. PGlite is a dev dependency, so
// it is imported lazily: production bundles never load it.
import type { Db } from './client';
import * as schema from './schema';
import { migrate } from './migrator';

export async function createTestDb(): Promise<Db> {
  const [{ PGlite }, { drizzle }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
  ]);
  const client = new PGlite();
  const db = drizzle({ client, schema }) as unknown as Db;
  await migrate(db);
  return db;
}

/**
 * A fresh, empty Postgres database next to `baseUrl` (a throwaway server's URL), so test files
 * that drop schemas don't collide when turbo runs packages in parallel. `drop()` removes it.
 */
export async function scratchDatabase(
  baseUrl: string,
  label: string,
): Promise<{ url: string; drop: () => Promise<void> }> {
  const { default: pg } = await import('pg');
  const name = `skirm_t_${label.replace(/\W/g, '_')}_${process.pid}`.toLowerCase();
  const admin = async (sql: string) => {
    const c = new pg.Client({ connectionString: baseUrl });
    await c.connect();
    try {
      await c.query(sql);
    } finally {
      await c.end();
    }
  };
  await admin(`drop database if exists ${name} with (force)`);
  await admin(`create database ${name}`);
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return { url: url.toString(), drop: () => admin(`drop database if exists ${name} with (force)`) };
}
