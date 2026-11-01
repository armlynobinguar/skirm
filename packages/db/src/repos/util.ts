import type { Executor } from '../client';

/** Postgres unique_violation (23505), unwrapping Drizzle's query error. */
export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '23505')
      return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** Runs `fn` in a transaction (a savepoint when `db` is already a transaction). */
export function tx<T>(db: Executor, fn: (tx: Executor) => Promise<T>): Promise<T> {
  return (db as { transaction: (f: (t: Executor) => Promise<T>) => Promise<T> }).transaction(fn);
}

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** 00:00 UTC of the day `now` is in. */
export function utcDayStart(now: number): Date {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Next 00:00 UTC after `now`, ISO 8601. */
export function nextUtcMidnight(now: number): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

export type Clock = () => number;

/** node-postgres returns `{ rows }`, PGlite returns `{ rows }` too; normalise either. */
export function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] }).rows ?? []) as T[];
}
