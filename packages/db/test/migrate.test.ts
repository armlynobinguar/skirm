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
        'rental_offers',
        'rentals',
        'ledger_accounts',
        'ledger_rows',
        'run_holds',
        'free_budget_days',
        'v2_matches',
        'match_messages',
        'match_timelines',
        'seasons',
        'season_standings',
        'prize_payouts',
        'skill_benchmarks',
        'match_skill_stats',
        'skill_trials',
        'cosmetics_owned',
        'onboarding_progress',
        'elo_decays',
        'campaign_progress',
        'campaign_rewards',
      ]),
    );
    const applied = await db.execute(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect(rowsOf<{ n: number }>(applied)[0]!.n).toBe(embeddedMigrations().length);
    // 0000_init, 0001_agent_rentals, 0002_account_deletion, 0003_onboarding, 0004_ranked_tiers,
    // 0005_match_timelines, 0006_skill_triggers, 0007_replay_shares, 0008_lobbies_tournaments,
    // 0009_external_agents, 0010_skill_roles,
    // 0011_crew_playbooks, 0012_skill_bench, 0013_quests_achievements,
    // 0014_campaign, 0015_daily_challenge, 0016_agent_progression, 0017_community_maps.
    expect(embeddedMigrations()).toHaveLength(18);
  });

  it('refuses a second account linking the same NEAR account', async () => {
    const db = await createTestDb();
    await db.execute(
      sql`insert into accounts (id, handle, near_account_id) values ('acc_a', 'ana', 'dup.testnet'), ('acc_b', 'ben', null)`,
    );
    await expect(
      db.execute(sql`update accounts set near_account_id = 'dup.testnet' where id = 'acc_b'`),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/accounts_near_uq/) }),
    });
  });

  it('commits after a migration that adds an enum value, before a later one may use it', () => {
    // Postgres refuses a new enum value in the transaction that added it; pglite does not, so the
    // batching is checked directly.
    const m = (folderMillis: number, stmt: string) => ({
      sql: [stmt],
      bps: true,
      folderMillis,
      hash: String(folderMillis),
    });
    const all = [
      m(1, 'CREATE TABLE "a" ("id" text)'),
      m(2, `ALTER TYPE "public"."registry_status" ADD VALUE 'local'`),
      m(3, `ALTER TABLE "a" ADD COLUMN "s" "registry_status" DEFAULT 'local'`),
      m(4, `ALTER TYPE "public"."ledger_note" ADD VALUE 'cosmetic'`),
      m(5, 'CREATE TABLE "b" ("id" text)'),
    ];
    const at = (ms: { folderMillis: number }[]) => ms.map((x) => x.folderMillis);
    expect(at(nextBatch(all, null))).toEqual([1, 2]);
    expect(at(nextBatch(all, 2))).toEqual([3, 4]);
    expect(at(nextBatch(all, 4))).toEqual([5]);
    expect(nextBatch(all, 5)).toEqual([]);
  });
});
