import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';
import { embeddedMigrations, migrate, nextBatch } from '../src/index';
import { createTestDb } from '../src/testing';
import { rowsOf } from '../src/repos/util';

const folder = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'migrations');

describe('migrations', () => {
  it('embedded copy matches migrations/ (run `npm run generate -w @skirm/db` after schema edits)', () => {
    expect(embeddedMigrations()).toEqual(readMigrationFiles({ migrationsFolder: folder }));
  });

  it('creates every table and is idempotent', async () => {
    const db = await createTestDb();
    await migrate(db);
    await migrate(db, { migrationsFolder: folder });
    const res = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = rowsOf<{ table_name: string }>(res).map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        'accounts',
        'agents',
        'agent_skills',
        'unlock_items',
        'skills',
        'skill_versions',
        'skill_ownership',
        'listings',
        'sales',
        'ledger_accounts',
        'ledger_rows',
        'run_holds',
        'free_budget_days',
        'v2_matches',
        'match_messages',
        'seasons',
        'season_standings',
        'prize_payouts',
        'skill_benchmarks',
        'match_skill_stats',
        'skill_trials',
        'cosmetics_owned',
      ]),
    );
    const applied = await db.execute(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect(rowsOf<{ n: number }>(applied)[0]!.n).toBe(embeddedMigrations().length);
    expect(embeddedMigrations()).toHaveLength(13);
  });

  it('0001 backfills name and summary of versions created before it', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const client = new PGlite();
    const db = drizzle(client);
    const [m0, m1] = embeddedMigrations();
    for (const q of m0!.sql) await db.execute(sql.raw(q));
    await client.exec(`insert into accounts (id, handle) values ('acc_a', 'ana');
      insert into skills (id, creator_id, name, summary) values ('skl_a', 'acc_a', 'Old', 'S');
      insert into skill_versions (skill_id, version, requires_actions, handles_tags, prompt_sha256,
        ciphertext, iv, auth_tag, wrapped_key, key_id)
      values ('skl_a', 1, '[]', '[]', 'h', '\\x00', '\\x00', '\\x00', '\\x00', 'k')`);
    for (const q of m1!.sql) await db.execute(sql.raw(q));
    const res = await db.execute(sql`select name, summary from skill_versions`);
    expect(rowsOf(res)).toEqual([{ name: 'Old', summary: 'S' }]);
    await client.close();
  });

  it('0010 keeps the oldest link of a NEAR account linked twice, then refuses a second link', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const client = new PGlite();
    const db = drizzle(client);
    const all = embeddedMigrations();
    const i10 = 10; // 0010_comms_integrity
    for (const m of all.slice(0, i10)) for (const q of m.sql) await db.execute(sql.raw(q));
    await client.exec(`insert into accounts (id, handle, near_account_id, created_at) values
      ('acc_new', 'new', 'dup.testnet', '2026-10-02'),
      ('acc_old', 'old', 'dup.testnet', '2026-10-01'),
      ('acc_mid', 'mid', 'dup.testnet', '2026-10-01T12:00:00Z'),
      ('acc_one', 'one', 'one.testnet', '2026-10-03'),
      ('acc_none', 'none', null, '2026-10-03')`);
    for (const q of all[i10]!.sql) await db.execute(sql.raw(q));
    const res = await db.execute(sql`select id, near_account_id as near from accounts order by id`);
    expect(rowsOf(res)).toEqual([
      { id: 'acc_mid', near: null },
      { id: 'acc_new', near: null },
      { id: 'acc_none', near: null },
      { id: 'acc_old', near: 'dup.testnet' },
      { id: 'acc_one', near: 'one.testnet' },
    ]);
    await expect(client.exec(`update accounts set near_account_id = 'dup.testnet' where id = 'acc_new'`)).rejects.toThrow(/accounts_near_uq/);
    await client.close();
  });

  it('0012 drops the v1 tables, column and enums, with their rows, and keeps the ledger', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const client = new PGlite();
    const db = drizzle(client);
    const all = embeddedMigrations();
    const i12 = 12; // 0012_retire_v1
    for (const m of all.slice(0, i12)) for (const q of m.sql) await db.execute(sql.raw(q));
    await client.exec(`insert into accounts (id, handle) values ('acc_a', 'ana'), ('acc_b', 'ben');
      insert into runs (id, account_id, mode, map_id, map_version, map_sha256, crew, crew_size, status)
        values ('run_a', 'acc_a', 'solo', 'flood-gate', 1, 'h', '[]', 1, 'ended');
      insert into run_skill_stats (run_id, skill_id, version, tag, map_id, cleared)
        values ('run_a', 'skl_a', 1, 'liquid', 'flood-gate', true);
      insert into badges (id, account_id, kind, run_id) values ('bdg_a', 'acc_a', 'first_clear', 'run_a');
      insert into matches (id, map_id, map_version, mode, side_a_account_id, side_b_account_id, side_a_agents, side_b_agents)
        values ('mch_a', 'flood-gate', 1, 'free', 'acc_a', 'acc_b', '[]', '[]');
      insert into run_holds (run_id, account_id, status, day, agents, step_limit, hold, free_held, paid_held, ticks, lost)
        values ('run_a', 'acc_a', 'settled', '2026-10-31', 1, 30, 30, 30, 0, '[]', '[]');
      insert into ledger_rows (account_id, type, amount, source, run_id) values ('acc_a', 'hold', 30, 'free', 'run_a')`);
    for (const q of all[i12]!.sql) await db.execute(sql.raw(q));

    const tables = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = rowsOf<{ table_name: string }>(tables).map((r) => r.table_name);
    for (const gone of ['runs', 'run_skill_stats', 'matches', 'badges']) expect(names).not.toContain(gone);
    const cols = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'accounts'`,
    );
    expect(rowsOf<{ column_name: string }>(cols).map((r) => r.column_name)).not.toContain('tutorial_runs_left');
    const types = await db.execute<{ typname: string }>(
      sql`select t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typtype = 'e'`,
    );
    const enums = rowsOf<{ typname: string }>(types).map((r) => r.typname);
    for (const gone of ['run_mode', 'run_lifecycle', 'run_result', 'match_mode', 'match_result'])
      expect(enums).not.toContain(gone);
    expect(enums).toEqual(expect.arrayContaining(['match_status', 'registry_status', 'hold_status']));
    expect(rowsOf(await db.execute(sql`select run_id from run_holds`))).toEqual([{ run_id: 'run_a' }]);
    expect(rowsOf(await db.execute(sql`select run_id, amount from ledger_rows`))).toEqual([{ run_id: 'run_a', amount: 30 }]);
    await client.close();
  });
  it('commits after a migration that adds an enum value, before a later one may use it', () => {
    // Postgres refuses a new enum value in the transaction that added it; pglite does not, so the
    // batching is checked directly. 0003 adds registry_status 'local'; 0011 uses it as a default.
    const all = embeddedMigrations();
    const tags = (ms: { folderMillis: number }[]) => ms.map((m) => all.findIndex((a) => a.folderMillis === m.folderMillis));
    const first = nextBatch(all, null);
    expect(tags(first)).toEqual([0, 1, 2, 3]);
    // 0011 uses 'local' and itself adds ledger values, so it closes the second batch.
    const second = nextBatch(all, first[first.length - 1]!.folderMillis);
    expect(tags(second)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(second.some((m) => m.sql.some((s) => s.includes("DEFAULT 'local'")))).toBe(true);
    const third = nextBatch(all, second[second.length - 1]!.folderMillis);
    expect(tags(third)).toEqual(all.slice(12).map((_, i) => i + 12));
    expect(nextBatch(all, all[all.length - 1]!.folderMillis)).toEqual([]);
  });
});
