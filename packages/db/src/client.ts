// Database handles: node-postgres for the apps, PGlite (in-process Postgres) for tests.
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** A database handle or an open transaction; repositories accept either. */
export type Executor = Db | Tx;

export interface CreateDbOptions {
  /** Pool size (default 10). */
  max?: number;
}

/** Postgres through node-postgres. Close with `closeDb(db)`. */
export function createDb(url: string, opts: CreateDbOptions = {}): Db {
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 10 });
  // Never log query parameters: they can carry ciphertext and receipts.
  pool.on('error', (err) => {
    console.error(`[db] idle client error: ${err.message}`);
  });
  return drizzle({ client: pool, schema }) as unknown as Db;
}

/** Closes the underlying pool or PGlite instance. */
export async function closeDb(db: Db): Promise<void> {
  const client = (
    db as unknown as { $client?: { end?: () => Promise<void>; close?: () => Promise<void> } }
  ).$client;
  if (client?.end) await client.end();
  else if (client?.close) await client.close();
}

const localLocks = new WeakMap<object, Map<number, Promise<unknown>>>();

/**
 * Runs `fn` while holding the Postgres session advisory lock `key` on a dedicated pool connection,
 * so concurrent callers in any process run one after another (the lock is released when `fn`
 * settles, or by Postgres if the process dies). On a handle without a pool (PGlite in tests) the
 * callers are serialised in-process instead.
 */
export async function withAdvisoryLock<T>(db: Db, key: number, fn: () => Promise<T>): Promise<T> {
  const pool = (db as unknown as { $client?: unknown }).$client;
  if (pool instanceof pg.Pool) {
    const client = await pool.connect();
    try {
      await client.query('select pg_advisory_lock($1)', [key]);
      try {
        return await fn();
      } finally {
        await client.query('select pg_advisory_unlock($1)', [key]);
      }
    } finally {
      client.release();
    }
  }
  const owner = (pool ?? db) as object;
  const locks = localLocks.get(owner) ?? new Map<number, Promise<unknown>>();
  localLocks.set(owner, locks);
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  locks.set(key, run);
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}
