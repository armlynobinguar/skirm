// Same flows against a real Postgres through node-postgres. Opt-in: set TEST_DATABASE_URL to a
// THROWAWAY database (the test drops and recreates its schemas), e.g.
//   docker run -d --rm -p 55432:5432 -e POSTGRES_PASSWORD=t postgres:16-alpine
//   TEST_DATABASE_URL=postgres://postgres:t@localhost:55432/postgres npx vitest run test/postgres.test.ts
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  createDb,
  createRepos,
  embeddedMigrations,
  migrate,
  STARTER_SKILL,
  type Db,
} from '../src/index';
import { scratchDatabase } from '../src/testing';
import { FakeSealer } from './helpers';

const baseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!baseUrl)('node-postgres (real Postgres)', () => {
  let db: Db;
  let url: string;
  let dropScratch: () => Promise<void>;
  beforeAll(async () => {
    // Its own database: other packages' real-Postgres tests run in parallel under turbo.
    ({ url, drop: dropScratch } = await scratchDatabase(baseUrl!, 'db'));
    db = createDb(url, { max: 8 });
    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`create schema public`);
    // api, worker and realtime migrate at boot at the same time: concurrent runs must serialise
    // (without the advisory lock two of these fail with a pg_type unique violation).
    const others = [createDb(url, { max: 2 }), createDb(url, { max: 2 })];
    try {
      await Promise.all([migrate(db), ...others.map((o) => migrate(o))]);
    } finally {
      for (const o of others) await closeDb(o);
    }
    await migrate(db);
    const applied = await db.execute(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect((applied as unknown as { rows: { n: number }[] }).rows[0]!.n).toBe(
      embeddedMigrations().length,
    );
  });
  afterAll(async () => {
    if (db) await closeDb(db);
    await dropScratch?.();
  });

  it('creates accounts, keeps bytea intact and serialises concurrent holds with FOR UPDATE', async () => {
    const repos = createRepos(db);
    const sealer = new FakeSealer();
    const users = await Promise.all(
      ['p1', 'p2', 'p1'].map((handle) => repos.accounts.getOrCreate({ handle }, sealer)),
    );
    expect(users[0]!.account.id).toBe(users[2]!.account.id);
    const acc = users[0]!.account;
    expect((await repos.agents.listByOwner(acc.id)).map((a) => a.name)).toEqual([
      'Rook',
      'Wren',
      'Moss',
    ]);

    const sealed = await repos.skills.loadSealed(STARTER_SKILL.id, 1);
    expect(sealed!.ciphertext).toBeInstanceOf(Uint8Array);
    expect(sealed!.iv.length).toBe(12);

    // 10 parallel 1-agent holds of 30 credits: only 2 fit the 60 allowance.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        repos.ledger.hold({ accountId: acc.id, runId: `pg-${i}`, stepLimit: 30, agents: 1 }),
      ),
    );
    expect(results.filter((r) => r.ok).length).toBe(2);
    expect(await repos.ledger.balance(acc.id)).toMatchObject({ allowanceLeft: 0, held: 60 });

    // Parallel top-ups with the same receipt: credited once.
    const tops = await Promise.all(
      Array.from({ length: 5 }, () =>
        repos.ledger.topUp({ accountId: acc.id, credits: 7, receipt: 'pg-rcpt' }),
      ),
    );
    expect(tops.filter((r) => r.ok).length).toBe(1);
    expect((await repos.ledger.balance(acc.id)).balance).toBe(7);

    // Parallel charges on one run are applied exactly once each.
    const ok = results.findIndex((r) => r.ok);
    await Promise.all(
      Array.from({ length: 12 }, () =>
        repos.ledger.chargeTurns(`pg-${ok}`, [{ agent: 0, reason: null }]),
      ),
    );
    const s = await repos.ledger.settle(`pg-${ok}`);
    expect(s.ok && s.summary).toEqual({ charged: 12, refunded: 18, turnsCharged: 12 });

    // Two accounts racing for one run id: exactly one hold is placed; the other is
    // refused with duplicate_run and keeps its allowance.
    const [x, y] = await Promise.all(
      ['p3', 'p4'].map((handle) => repos.accounts.getOrCreate({ handle }, sealer)),
    );
    const race = await Promise.all(
      [x!.account.id, y!.account.id].map((accountId) =>
        repos.ledger.hold({ accountId, runId: 'pg-shared', stepLimit: 30, agents: 1 }),
      ),
    );
    expect(race.filter((r) => r.ok).length).toBe(1);
    expect(race.find((r) => !r.ok)).toMatchObject({ error: 'duplicate_run' });
    const winner = (await repos.ledger.getHold('pg-shared'))!.player;
    const loser = winner === x!.account.id ? y!.account.id : x!.account.id;
    expect(await repos.ledger.balance(loser)).toMatchObject({ allowanceLeft: 60, held: 0 });
    expect(await repos.ledger.balance(winner)).toMatchObject({ allowanceLeft: 30, held: 30 });

  });

  it('v2 player ladder and match spend come back as numbers (pg returns bigint as text)', async () => {
    const repos = createRepos(db);
    const sealer = new FakeSealer();
    const a = (await repos.accounts.getOrCreate({ handle: 'pg-v2a' }, sealer)).account;
    const b = (await repos.accounts.getOrCreate({ handle: 'pg-v2b' }, sealer)).account;
    const m = await repos.v2Matches.create({ mapId: 'copper-hollow', ranked: true, teamA: a.id, teamB: b.id });
    await repos.ledger.topUp({ accountId: a.id, credits: 100, receipt: 'pg-v2-rcpt' });
    expect((await repos.ledger.hold({ accountId: a.id, runId: `${m.id}-A`, stepLimit: 70, agents: 1 })).ok).toBe(true);
    const charged = await repos.ledger.chargeTurns(`${m.id}-A`, Array.from({ length: 65 }, () => ({ agent: 0, reason: null })));
    if (!charged.ok) throw new Error(charged.error);
    // 65 charged: the free allowance first (if today's global budget still has it), then paid.
    const paid = charged.rows.filter((r) => r.type === 'charge' && r.source === 'paid').reduce((n, r) => n + r.amount, 0);
    expect(paid).toBeGreaterThan(0);
    await repos.ledger.settle(`${m.id}-A`);
    await repos.v2Matches.finish(m.id, { winner: 'A', reason: 'goal' });

    expect(await repos.ledger.v2MatchSpend(a.id)).toBe(paid);
    const row = await repos.leaderboards.playerRowFor(a.id);
    expect(row).toMatchObject({ rank: 1, elo: 1224, rankedMatches: 1, wins: 1 });
    expect(typeof row!.rank).toBe('number');
  });
});
