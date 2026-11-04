import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { YOCTO_PER_NEAR, seasonPayouts, splitSale } from '@skirm/shared';
import {
  SEASON_LOCK_GRACE_MS,
  createRepos,
  newId,
  sales,
  seasons,
  type Db,
  type Executor,
} from '../src/index';
import { setup, signUp, type Ctx } from './helpers';

const DAY = 86_400_000;
const T0 = Date.parse('2026-11-03T08:00:00Z');

async function rankedMatch(
  ctx: Ctx,
  a: string,
  b: string,
  winner: 'A' | 'B' | 'draw' | null,
  repos = ctx.repos,
) {
  const m = await ctx.repos.v2Matches.create({
    mapId: 'copper-hollow',
    ranked: true,
    teamA: a,
    teamB: b,
  });
  return repos.v2Matches.finish(m.id, { winner, reason: winner ? 'goal' : 'declined' });
}

/**
 * A handle whose first INSERT into `seasons` is preceded, inside the same transaction, by `before`:
 * as if a concurrent opener committed that row between our select and our insert.
 */
function racing(
  db: Db,
  before: (t: Executor, row: typeof seasons.$inferInsert) => Promise<void>,
): Db {
  let fired = false;
  const wrap = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(obj, prop) {
        if (prop === 'transaction')
          return (fn: (t: Executor) => Promise<unknown>) =>
            (obj as unknown as Db).transaction((t) => fn(wrap(t)));
        if (prop === 'insert')
          return (table: unknown) => {
            const real = (obj as unknown as Executor).insert(table as typeof seasons);
            if (table !== seasons || fired) return real;
            fired = true;
            return {
              values: (row: typeof seasons.$inferInsert) => ({
                onConflictDoNothing: async (
                  cfg: Parameters<ReturnType<typeof real.values>['onConflictDoNothing']>[0],
                ) => {
                  await before(obj as unknown as Executor, row);
                  return real.values(row).onConflictDoNothing(cfg);
                },
              }),
            };
          };
        const v = Reflect.get(obj, prop) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(obj) : v;
      },
    });
  return wrap(db);
}

describe('seasons', () => {
  it('open lazily for 14 days and roll forward, also over an idle gap (never already expired)', async () => {
    const ctx = await setup();
    const s1 = await ctx.repos.seasons.ensureCurrent(T0);
    expect(s1).toMatchObject({
      number: 1,
      status: 'open',
      onchainStatus: 'local',
      fundedYocto: '0',
    });
    expect(s1.id).toMatch(/^ssn_/);
    expect([s1.startsAt.getTime(), s1.endsAt.getTime()]).toEqual([T0, T0 + 14 * DAY]);
    expect((await ctx.repos.seasons.ensureCurrent(T0 + 13 * DAY)).id).toBe(s1.id);

    // Exactly at the end: the next season starts where the last one ended.
    const s2 = await ctx.repos.seasons.ensureCurrent(T0 + 14 * DAY);
    expect(s2).toMatchObject({ number: 2 });
    expect(s2.startsAt.getTime()).toBe(T0 + 14 * DAY);

    // Nobody played for a month: one season, starting now, not the two that would have expired.
    const now = T0 + 60 * DAY;
    const s3 = await ctx.repos.seasons.ensureCurrent(now);
    expect(s3.number).toBe(3);
    expect([s3.startsAt.getTime(), s3.endsAt.getTime()]).toEqual([now, now + 14 * DAY]);
    expect((await ctx.repos.seasons.list()).map((s) => s.number)).toEqual([3, 2, 1]);
    expect((await ctx.repos.seasons.dueToLock(now)).map((s) => s.number)).toEqual([1, 2]);
  });

  it('a ranked finish counts once; casual and void matches do not count', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const won = await rankedMatch(ctx, ana.id, ben.id, 'A');
    const season = await ctx.repos.seasons.ensureCurrent();
    expect(won.seasonId).toBe(season.id);
    expect((await ctx.repos.v2Matches.get(won.id))!.seasonId).toBe(season.id);
    // Finishing a closed match again writes nothing.
    await ctx.repos.v2Matches.finish(won.id, { winner: 'B', reason: 'goal' });

    const casual = await ctx.repos.v2Matches.create({
      mapId: 'copper-hollow',
      ranked: false,
      teamA: ana.id,
      teamB: ben.id,
    });
    expect(
      (await ctx.repos.v2Matches.finish(casual.id, { winner: 'B', reason: 'goal' })).seasonId,
    ).toBeNull();
    expect((await rankedMatch(ctx, ana.id, ben.id, null)).seasonId).toBeNull();

    const { rows, total } = await ctx.repos.seasons.standings(season.id);
    expect(total).toBe(2);
    expect(rows).toEqual([
      {
        rank: 1,
        accountId: ana.id,
        handle: 'ana',
        elo: 1224,
        points: 25,
        wins: 1,
        losses: 0,
        draws: 0,
        matches: 1,
      },
      {
        rank: 2,
        accountId: ben.id,
        handle: 'ben',
        elo: 1176,
        points: 5,
        wins: 0,
        losses: 1,
        draws: 0,
        matches: 1,
      },
    ]);

    await rankedMatch(ctx, ana.id, ben.id, 'draw');
    expect(await ctx.repos.seasons.rowFor(season.id, ben.id)).toMatchObject({
      rank: 2,
      points: 17,
      draws: 1,
      matches: 2,
    });
    expect(await ctx.repos.seasons.rowFor(season.id, 'acc_nobody')).toBeUndefined();
    expect(
      (await ctx.repos.seasons.standings(season.id, { limit: 1, offset: 1 })).rows.map(
        (r) => r.handle,
      ),
    ).toEqual(['ben']);
  });

  it('two finishes at a season boundary both commit, one through the insert conflict', async () => {
    const ctx = await setup();
    const [ana, ben, cy, di] = await Promise.all(
      ['ana', 'ben', 'cy', 'di'].map((h) => signUp(ctx, h)),
    );
    const s1 = await ctx.repos.seasons.ensureCurrent(T0);
    ctx.clock.now = s1.endsAt.getTime() + 60_000;

    // The first finish finds no current season; a concurrent opener commits season 2 first.
    const racedId = newId('ssn');
    const raced = createRepos(
      racing(ctx.db, async (t, row) => {
        expect(row.number).toBe(2);
        await t.insert(seasons).values({ ...row, id: racedId });
      }),
      { clock: () => ctx.clock.now },
    );
    const m1 = await rankedMatch(ctx, ana!.id, ben!.id, 'A', raced);
    expect(m1).toMatchObject({ status: 'ended', seasonId: racedId });
    // The second finds that season by its window.
    const m2 = await rankedMatch(ctx, cy!.id, di!.id, 'B');
    expect(m2.seasonId).toBe(racedId);

    expect((await ctx.repos.seasons.list()).map((s) => s.number)).toEqual([2, 1]);
    expect(await ctx.repos.accounts.get(ana!.id)).toMatchObject({ elo: 1224, rankedMatches: 1 });
    expect(await ctx.repos.accounts.get(di!.id)).toMatchObject({ elo: 1224, rankedMatches: 1 });
    const { rows } = await ctx.repos.seasons.standings(racedId);
    expect(rows.map((r) => [r.handle, r.points])).toEqual([
      ['ana', 25],
      ['di', 25],
      ['ben', 5],
      ['cy', 5],
    ]);
    expect((await ctx.repos.seasons.standings(s1.id)).total).toBe(0);
  });

  it('a conflicting season that does not cover now is skipped, never thrown', async () => {
    const ctx = await setup();
    const s1 = await ctx.repos.seasons.ensureCurrent(T0);
    const now = s1.endsAt.getTime() + DAY;
    const raced = createRepos(
      racing(ctx.db, async (t, row) => {
        await t.insert(seasons).values({
          ...row,
          id: newId('ssn'),
          startsAt: new Date(T0 - 30 * DAY),
          endsAt: new Date(T0 - 29 * DAY),
        });
      }),
    );
    const current = await raced.seasons.ensureCurrent(now);
    expect(current.number).toBe(3);
    expect(current.startsAt.getTime()).toBe(now);
  });

  it('the pool is funded NEAR plus 30% of the fees of sales in the window', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const season = await ctx.repos.seasons.ensureCurrent(T0);
    await ctx.db
      .update(seasons)
      .set({ fundedYocto: (2n * YOCTO_PER_NEAR).toString() })
      .where(eq(seasons.id, season.id));
    const sale = (price: bigint, at: number) =>
      ctx.db.insert(sales).values({
        id: newId('sal'),
        skillId: 'skl_x',
        version: 1,
        buyerId: ana.id,
        priceYocto: price.toString(),
        txHash: `tx_${at}_${price}`,
        createdAt: new Date(at),
      });
    await sale(5n * YOCTO_PER_NEAR, T0 + DAY); // fee 0.25 NEAR → 0.075 to the pool
    await sale(333n, T0 + 2 * DAY); // fee 16 → 4
    await sale(10n * YOCTO_PER_NEAR, T0 - DAY); // before the season
    await sale(10n * YOCTO_PER_NEAR, season.endsAt.getTime()); // after it
    const share = (p: bigint) => (splitSale(p, { primary: true }).fee * 3000n) / 10_000n;
    expect(await ctx.repos.seasons.pool(season.id)).toBe(
      2n * YOCTO_PER_NEAR + share(5n * YOCTO_PER_NEAR) + 4n,
    );
    expect(share(5n * YOCTO_PER_NEAR)).toBe(75n * 10n ** 21n);
  });

  it('lock writes the top 10 prizes (never more than the pool), once; then onchain and paid', async () => {
    const ctx = await setup();
    const players = await Promise.all(Array.from({ length: 12 }, (_, i) => signUp(ctx, `p${i}`)));
    for (let i = 0; i < 12; i += 2) {
      await rankedMatch(ctx, players[i]!.id, players[i + 1]!.id, 'A');
      if (i < 6) await rankedMatch(ctx, players[i]!.id, players[i + 1]!.id, 'draw');
    }
    const season = await ctx.repos.seasons.ensureCurrent();
    const pool = 7n * YOCTO_PER_NEAR + 3n;
    await ctx.db
      .update(seasons)
      .set({ fundedYocto: pool.toString() })
      .where(eq(seasons.id, season.id));
    await expect(ctx.repos.seasons.lock(season.id)).rejects.toMatchObject({ code: 'season_open' });

    ctx.clock.now = season.endsAt.getTime() + SEASON_LOCK_GRACE_MS;
    expect((await ctx.repos.seasons.dueToLock()).map((s) => s.id)).toEqual([season.id]);
    const locked = await ctx.repos.seasons.lock(season.id);
    expect(locked.season.status).toBe('locked');
    expect(locked.payouts).toHaveLength(10);
    const top = (await ctx.repos.seasons.standings(season.id, { limit: 10 })).rows;
    expect(locked.payouts.map((p) => p.accountId)).toEqual(top.map((r) => r.accountId));
    const expected = seasonPayouts(pool, top);
    expect(locked.payouts.map((p) => BigInt(p.amountYocto))).toEqual(
      expected.payouts.map((p) => p.amountYocto),
    );
    const paid = locked.payouts.reduce((s, p) => s + BigInt(p.amountYocto), 0n);
    expect(paid).toBeLessThanOrEqual(pool);
    expect(paid + locked.carry).toBe(pool);
    expect(locked.payouts.every((p) => p.status === 'local')).toBe(true);
    expect(await ctx.repos.seasons.dueToLock()).toEqual([]);

    // Locking again returns what was written.
    const again = await ctx.repos.seasons.lock(season.id);
    expect(again.payouts).toEqual(locked.payouts);
    expect(again.carry).toBe(locked.carry);

    const winner = locked.payouts[0]!;
    expect(await ctx.repos.seasons.prizesFor(winner.accountId)).toBe(BigInt(winner.amountYocto));
    expect(await ctx.repos.seasons.prizesFor(players[11]!.id)).toBe(0n);

    await ctx.repos.seasons.setOnchain(season.id, 'recorded', 'TX_POST');
    expect(await ctx.repos.seasons.get(season.id)).toMatchObject({
      onchainStatus: 'recorded',
      tx: 'TX_POST',
    });
    expect(
      (await ctx.repos.seasons.payouts(season.id)).every((p) => p.status === 'claimable'),
    ).toBe(true);
    await ctx.repos.seasons.markPaid(season.id, 'TX_CLOSE');
    expect(await ctx.repos.seasons.get(season.id)).toMatchObject({
      status: 'paid',
      tx: 'TX_CLOSE',
    });
    expect((await ctx.repos.seasons.payouts(season.id)).every((p) => p.status === 'paid')).toBe(
      true,
    );
  });

  it('a season with no players locks with the whole pool carried', async () => {
    const ctx = await setup();
    const season = await ctx.repos.seasons.ensureCurrent(T0);
    await ctx.db.update(seasons).set({ fundedYocto: '1000' }).where(eq(seasons.id, season.id));
    const locked = await ctx.repos.seasons.lock(
      season.id,
      season.endsAt.getTime() + SEASON_LOCK_GRACE_MS,
    );
    expect(locked).toMatchObject({ payouts: [], pool: 1000n, carry: 1000n });
    await expect(ctx.repos.seasons.lock('ssn_missing')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('locks only after the grace period, so a finish at the boundary is never left out of the payouts', async () => {
    const ctx = await setup();
    const [ana, ben] = await Promise.all(['ana', 'ben'].map((h) => signUp(ctx, h)));
    const s1 = await ctx.repos.seasons.ensureCurrent(T0);
    await ctx.db.update(seasons).set({ fundedYocto: '1000' }).where(eq(seasons.id, s1.id));

    // A finish whose clock still reads the last millisecond of season 1 counts towards it...
    ctx.clock.now = s1.endsAt.getTime() - 1;
    expect((await rankedMatch(ctx, ana!.id, ben!.id, 'A')).seasonId).toBe(s1.id);
    // ...and the season cannot be locked while such a finish may still be committing.
    const justAfter = s1.endsAt.getTime() + SEASON_LOCK_GRACE_MS - 1;
    expect(await ctx.repos.seasons.dueToLock(justAfter)).toEqual([]);
    await expect(ctx.repos.seasons.lock(s1.id, justAfter)).rejects.toMatchObject({
      code: 'season_open',
    });

    const locked = await ctx.repos.seasons.lock(s1.id, justAfter + 1);
    expect(locked.payouts.map((p) => [p.accountId, p.amountYocto])).toEqual([
      [ana!.id, '300'],
      [ben!.id, '200'],
    ]);
  });
});
