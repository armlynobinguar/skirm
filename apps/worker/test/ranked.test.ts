// Ranked consumer: the Elo decay pass takes the configured amount from inactive Diamond+ players,
// never below their tier floor, once per period; the env picks days and amount.
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULTS } from '@skirm/shared';
import { decayConfigFrom, processRankedDecay } from '../src/ranked-processor';
import { setup, type Ctx } from './helpers';

const T0 = Date.UTC(2026, 10, 2, 12);
const DAY = 86_400_000;

let ctx: Ctx | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

/** A ranked result between two new players at the repos' clock; returns both account ids. */
async function rankedPair(c: Ctx, a: string, b: string) {
  const pa = await c.repos.accounts.getOrCreate({ handle: a }, c.vault);
  const pb = await c.repos.accounts.getOrCreate({ handle: b }, c.vault);
  const m = await c.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: true, teamA: pa.account.id, teamB: pb.account.id });
  await c.repos.v2Matches.finish(m.id, { winner: 'A', reason: 'goal' });
  return [pa.account.id, pb.account.id] as const;
}

/** A placed player at `elo` (ids are generated, never user input). */
const setElo = (c: Ctx, id: string, elo: number) =>
  c.db.execute(`update accounts set elo = ${elo}, ranked_matches = 12 where id = '${id}'`);

describe('ranked decay consumer', () => {
  it('reads RANKED_DECAY_DAYS and RANKED_DECAY_AMOUNT, defaults otherwise', () => {
    expect(decayConfigFrom({})).toEqual({ days: DEFAULTS.ranked.decay.days, amount: DEFAULTS.ranked.decay.amount });
    expect(decayConfigFrom({ RANKED_DECAY_DAYS: ' 7 ', RANKED_DECAY_AMOUNT: '40' })).toEqual({ days: 7, amount: 40 });
    expect(decayConfigFrom({ RANKED_DECAY_DAYS: '' })).toMatchObject({ days: DEFAULTS.ranked.decay.days });
    expect(() => decayConfigFrom({ RANKED_DECAY_AMOUNT: '-3' })).toThrow(/RANKED_DECAY_AMOUNT/);
    expect(() => decayConfigFrom({ RANKED_DECAY_DAYS: '1.5' })).toThrow(/RANKED_DECAY_DAYS/);
  });

  it('decays an inactive Diamond player once per period and logs the pass', async () => {
    let now = T0;
    ctx = await setup({ clock: { now: () => now, sleep: async () => undefined } }, { clock: () => now });
    const [ana, ben] = await rankedPair(ctx, 'ana', 'ben');
    await setElo(ctx, ana, 1750);

    now = T0 + 6 * DAY;
    expect(await processRankedDecay(ctx.deps, { days: 7, amount: 40 })).toEqual([]);
    now = T0 + 7 * DAY;
    expect(await processRankedDecay(ctx.deps, { days: 7, amount: 40 })).toEqual([{ accountId: ana, before: 1750, after: 1710 }]);
    expect(await processRankedDecay(ctx.deps, { days: 7, amount: 40 })).toEqual([]);
    now = T0 + 14 * DAY;
    expect(await processRankedDecay(ctx.deps, { days: 7, amount: 40 })).toEqual([{ accountId: ana, before: 1710, after: 1700 }]);
    expect((await ctx.repos.accounts.get(ana))!.elo).toBe(1700);
    expect((await ctx.repos.accounts.get(ben))!.elo).toBeLessThan(1200);
    expect(ctx.logger.lines.filter((l) => l.msg === 'elo decay')).toEqual([
      { level: 'info', msg: 'elo decay', fields: { players: 1, eloLost: 40 } },
      { level: 'info', msg: 'elo decay', fields: { players: 1, eloLost: 10 } },
    ]);
  });

  it('0 days or amount turns it off', async () => {
    let now = T0;
    ctx = await setup({}, { clock: () => now });
    const [ana] = await rankedPair(ctx, 'ana', 'ben');
    await setElo(ctx, ana, 1950);
    now = T0 + 100 * DAY;
    expect(await processRankedDecay(ctx.deps, { days: 0, amount: 25 })).toEqual([]);
    expect(await processRankedDecay(ctx.deps, { days: 14, amount: 0 })).toEqual([]);
    expect((await ctx.repos.accounts.get(ana))!.elo).toBe(1950);
  });
});
