// Season consumer: the tick opens the current season, locks an expired one with its payouts, hands
// the top 10 to the seasons adapter, opens the next season, and retries a failed chain write.
import { afterEach, describe, expect, it } from 'vitest';
import { SEASON_LOCK_GRACE_MS } from '@skirm/db';
import type {
  ChainSeason,
  OpenSeasonInput,
  RegistryResult,
  SeasonStandingInput,
  SeasonsChain,
} from '@skirm/server';
import { processSeasonTick } from '../src/season-processor';
import { setup, type Ctx } from './helpers';

const T0 = Date.UTC(2026, 10, 2, 12);
const HOUR = 3_600_000;

let ctx: Ctx | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

/** Worker and repos on one hand-moved clock. */
async function seasonCtx(seasons?: SeasonsChain) {
  let now = T0;
  const clock = { now: () => now, sleep: async () => undefined };
  const c = await setup({ clock, ...(seasons ? { seasons } : {}) }, { clock: () => now });
  return { c, at: (t: number) => (now = t) };
}

/** A ranked v2 result between two new players at the repos' clock (A wins). */
async function rankedResult(c: Ctx, a: string, b: string) {
  const pa = await c.repos.accounts.getOrCreate({ handle: a }, c.vault);
  const pb = await c.repos.accounts.getOrCreate({ handle: b }, c.vault);
  const [agentA] = await c.repos.agents.listByOwner(pa.account.id);
  const [agentB] = await c.repos.agents.listByOwner(pb.account.id);
  const crew = (id: string) => ({
    id,
    name: id,
    role: 'Runner',
    vision: 3,
    comms: 3,
    tier: 'standard',
  });
  const m = await c.repos.v2Matches.create({
    mapId: 'copper-hollow',
    ranked: true,
    teamA: pa.account.id,
    teamB: pb.account.id,
    crews: { A: [crew(agentA!.id)], B: [crew(agentB!.id)] },
  });
  await c.repos.v2Matches.finish(m.id, {
    winner: 'A',
    reason: 'goal',
    decidedBy: 'goal',
    score: { A: 3, B: 1 },
    ticks: 60,
    logHash: 'f'.repeat(64),
  });
  return { a: pa.account, b: pb.account };
}

class FakeNearSeasons implements SeasonsChain {
  readonly kind = 'near' as const;
  readonly calls: string[] = [];
  readonly opened = new Map<number, OpenSeasonInput>();
  /** What getSeason reports as each season's status (default: open once opened). */
  readonly status = new Map<number, ChainSeason['status']>();
  posted: SeasonStandingInput[] = [];
  constructor(private lockFailures = 0) {}
  private ok(): RegistryResult {
    return { status: 'recorded', txHash: `tx${this.calls.length}` };
  }
  async openSeason(input: OpenSeasonInput) {
    this.calls.push(`open:${input.id}`);
    this.opened.set(input.id, input);
    return this.ok();
  }
  async lockSeason(id: number) {
    this.calls.push(`lock:${id}`);
    if (this.lockFailures-- > 0)
      throw Object.assign(new Error('rpc down'), { code: 'rpc_unavailable' });
    return this.ok();
  }
  async postStandings(id: number, standings: SeasonStandingInput[]) {
    this.calls.push(`post:${id}`);
    this.posted = standings;
    return this.ok();
  }
  async closeSeason(id: number) {
    this.calls.push(`close:${id}`);
    return this.ok();
  }
  async getSeason(id: number) {
    return this.opened.has(id)
      ? ({ id, status: this.status.get(id) ?? 'open' } as ChainSeason)
      : null;
  }
}

describe('season tick', () => {
  it('locks an expired season with its payouts, posts the standings locally, opens the next', async () => {
    const { c, at } = await seasonCtx();
    ctx = c;
    // The first tick opens season 1.
    expect(await processSeasonTick(c.deps)).toEqual({ current: 1, locked: [], onchain: [] });
    at(T0 + HOUR);
    const { a, b } = await rankedResult(c, 'alice', 'bob');
    await c.repos.accounts.linkNearAccount(a.id, 'alice.testnet');
    const [s1] = await c.repos.seasons.list();
    // 1,000,000 yocto funded straight into the pool.
    await c.db.execute(`update seasons set funded_yocto = 1000000 where id = '${s1!.id}'`);

    // Ended, but inside the grace period: still open.
    at(s1!.endsAt.getTime() + 1);
    expect(await processSeasonTick(c.deps)).toEqual({ current: 2, locked: [], onchain: [] });
    expect((await c.repos.seasons.get(s1!.id))!.status).toBe('open');

    const end = s1!.endsAt.getTime() + SEASON_LOCK_GRACE_MS + 1;
    at(end);
    expect(await processSeasonTick(c.deps)).toEqual({
      current: 2,
      locked: [1],
      onchain: [{ number: 1, status: 'local' }],
    });
    expect(await c.repos.seasons.get(s1!.id)).toMatchObject({
      status: 'locked',
      onchainStatus: 'local',
    });
    const payouts = await c.repos.seasons.payouts(s1!.id);
    expect(payouts.map((p) => [p.rank, p.accountId, p.status])).toEqual([
      [1, a.id, 'local'],
      [2, b.id, 'local'],
    ]);
    expect(payouts[0]!.amountYocto).toBe('300000');
    // NoopSeasons: lock then the top 10, NEAR only for the player who linked one.
    expect(c.seasons.calls.map((x) => x.method)).toEqual(['lock_season', 'post_standings']);
    expect(c.seasons.calls[1]!.args).toEqual({
      id: 1,
      standings: [
        { player: a.id, near: 'alice.testnet', points: 25 },
        { player: b.id, near: null, points: 5 },
      ],
    });
    // The next season is open around now.
    const [s2] = await c.repos.seasons.list();
    expect(s2!.number).toBe(2);
    expect(s2!.startsAt.getTime()).toBeLessThanOrEqual(end);
    expect(s2!.endsAt.getTime()).toBeGreaterThan(end);

    // A later tick has nothing to do.
    expect(await processSeasonTick(c.deps)).toEqual({ current: 2, locked: [], onchain: [] });
    expect(c.seasons.calls).toHaveLength(2);
  });

  it('on NEAR: opens the season while it runs, retries a failed write, makes prizes claimable', async () => {
    const chain = new FakeNearSeasons(1);
    const { c, at } = await seasonCtx(chain);
    ctx = c;
    // Opened onchain as soon as it is current, so the market's fee share can fund it.
    await processSeasonTick(c.deps);
    expect(chain.calls).toEqual(['open:1']);
    const { a } = await rankedResult(c, 'carol', 'dave');
    await c.repos.accounts.linkNearAccount(a.id, 'carol.testnet');
    const [s1] = await c.repos.seasons.list();
    at(s1!.endsAt.getTime() + SEASON_LOCK_GRACE_MS + 1);

    expect(await processSeasonTick(c.deps)).toMatchObject({
      locked: [1],
      onchain: [{ number: 1, status: 'failed' }],
    });
    expect(chain.calls).toEqual(['open:1', 'lock:1']);
    expect(chain.opened.get(1)).toEqual({
      id: 1,
      name: 'Season 1',
      startsAtMs: s1!.startsAt.getTime(),
      endsAtMs: s1!.endsAt.getTime(),
    });
    expect(await c.repos.seasons.get(s1!.id)).toMatchObject({
      status: 'locked',
      onchainStatus: 'failed',
    });

    // The next tick retries the chain write only (the season stays locked once).
    expect(await processSeasonTick(c.deps)).toMatchObject({
      locked: [],
      onchain: [{ number: 1, status: 'recorded' }],
    });
    expect(chain.calls).toEqual(['open:1', 'lock:1', 'lock:1', 'post:1']);
    expect(chain.posted[0]).toEqual({ player: a.id, near: 'carol.testnet', points: 25 });
    expect(await c.repos.seasons.get(s1!.id)).toMatchObject({
      onchainStatus: 'recorded',
      tx: 'tx4',
    });
    const payouts = await c.repos.seasons.payouts(s1!.id);
    expect(payouts.every((p) => p.status === 'claimable')).toBe(true);
  });

  it('opens a season the contract never saw at lock time', async () => {
    const chain = new FakeNearSeasons();
    const { c, at } = await seasonCtx();
    ctx = c;
    // Season 1 ran while the worker was on NoopSeasons.
    await processSeasonTick(c.deps);
    const [s1] = await c.repos.seasons.list();
    at(s1!.endsAt.getTime() + SEASON_LOCK_GRACE_MS + 1);
    expect(await processSeasonTick({ ...c.deps, seasons: chain })).toMatchObject({
      locked: [1],
      onchain: [{ number: 1, status: 'recorded' }],
    });
    expect(chain.calls).toEqual(['open:1', 'lock:1', 'post:1']);
    expect(chain.opened.get(1)).toEqual({
      id: 1,
      name: 'Season 1',
      startsAtMs: s1!.startsAt.getTime(),
      endsAtMs: s1!.endsAt.getTime(),
    });
  });

  it('on NEAR: opens the next season only once the contract has paid the previous one', async () => {
    const chain = new FakeNearSeasons();
    const { c, at } = await seasonCtx(chain);
    ctx = c;
    await processSeasonTick(c.deps);
    const [s1] = await c.repos.seasons.list();
    at(s1!.endsAt.getTime() + SEASON_LOCK_GRACE_MS + 1);
    expect(await processSeasonTick(c.deps)).toMatchObject({ current: 2, locked: [1] });
    // Season 1 is locked, not paid, onchain: open_season(2) would panic, so it is not sent.
    expect(chain.calls).toEqual(['open:1', 'lock:1', 'post:1']);
    await processSeasonTick(c.deps);
    expect(chain.calls).toHaveLength(3);

    chain.status.set(1, 'paid');
    await processSeasonTick(c.deps);
    expect(chain.calls).toEqual(['open:1', 'lock:1', 'post:1', 'open:2']);
    const [s2] = await c.repos.seasons.list();
    expect(chain.opened.get(2)).toMatchObject({ id: 2, startsAtMs: s2!.startsAt.getTime() });

    // A failed open never fails the tick; the next one tries again.
    const failing: SeasonsChain = Object.assign(Object.create(chain) as FakeNearSeasons, {
      getSeason: async () => {
        throw Object.assign(new Error('rpc down'), { code: 'rpc_unavailable' });
      },
    });
    expect(await processSeasonTick({ ...c.deps, seasons: failing })).toMatchObject({ current: 2 });
  });

  it('a tick that dies between the lock and the chain write is finished by the next tick', async () => {
    const { c, at } = await seasonCtx();
    ctx = c;
    await processSeasonTick(c.deps);
    at(T0 + HOUR);
    await rankedResult(c, 'erin', 'frank');
    const [s1] = await c.repos.seasons.list();
    at(s1!.endsAt.getTime() + SEASON_LOCK_GRACE_MS + 1);

    // The worker dies right after the lock commits.
    const seasons = c.repos.seasons;
    const dying = Object.create(seasons) as typeof seasons;
    dying.lock = async (id, now) => {
      await seasons.lock(id, now);
      throw new Error('worker died');
    };
    await expect(
      processSeasonTick({ ...c.deps, repos: { ...c.repos, seasons: dying } }),
    ).rejects.toThrow('worker died');
    expect(await c.repos.seasons.get(s1!.id)).toMatchObject({
      status: 'locked',
      onchainStatus: 'pending',
    });
    expect(c.seasons.calls).toEqual([]);

    expect(await processSeasonTick(c.deps)).toEqual({
      current: 2,
      locked: [],
      onchain: [{ number: 1, status: 'local' }],
    });
    expect(c.seasons.calls.map((x) => x.method)).toEqual(['lock_season', 'post_standings']);
    expect((await c.repos.seasons.get(s1!.id))!.onchainStatus).toBe('local');
  });
});
