// Private MMR (Zama, PrivateLadder on Sepolia) with the chain mocked: ranked results between two
// linked, registered players are reported and their revealed tiers cached; anything else is left
// alone. The optional pairing check keeps a "far" pair apart, and pairs anyway on a timeout.
import type { LadderOperator, LadderPlayer } from '@skirm/server';
import { afterEach, describe, expect, it } from 'vitest';
import { RealtimeHub } from '../src/hub';
import { PrivateLadderSync, type LadderSyncOptions } from '../src/v2/ladder';
import { FakeSocket, makeDeps, type TestDeps } from './helpers';

const FAST_V2 = { acceptMs: 500, lockMs: 400, tickMs: 1, actionMs: 200, planMs: 200 };
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
const EVM_A = '0x000000000000000000000000000000000000a11c';
const EVM_B = '0x000000000000000000000000000000000000b0b0';

/** An in-memory PrivateLadder: records the calls; `close` answers isCloseMatch (a promise: may never settle). */
function fakeLadder(opts: { registered?: string[]; close?: () => Promise<boolean>; tierAfter?: number } = {}) {
  const calls: string[] = [];
  const reported = new Set<string>();
  const players = new Map<string, LadderPlayer>();
  for (const a of opts.registered ?? [EVM_A, EVM_B]) players.set(a, { registered: true, tier: 1, tierPending: false, matches: 0 });
  const op: LadderOperator & { calls: string[] } = {
    calls,
    async player(a) {
      return players.get(a) ?? { registered: false, tier: 0, tierPending: false, matches: 0 };
    },
    async reported(id) {
      return reported.has(id);
    },
    async report(id, a, b, winner) {
      calls.push(`report ${id} ${winner ?? 'draw'}`);
      reported.add(id);
      if (winner) for (const p of [a, b]) Object.assign(players.get(p)!, { tierPending: true });
      return '0xr';
    },
    async revealTier(a) {
      calls.push(`revealTier ${a}`);
      const p = players.get(a)!;
      Object.assign(p, { tier: opts.tierAfter ?? 2, tierPending: false });
      return p.tier;
    },
    async isClose(a, b) {
      calls.push(`isClose ${a} ${b}`);
      return (opts.close ?? (async () => true))();
    },
  };
  return op;
}

function syncOptions(over: Partial<LadderSyncOptions> = {}): LadderSyncOptions {
  return {
    matchmaking: true,
    checkTimeoutMs: 50,
    vetoMs: 1_000,
    retryMs: [1, 1],
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    ...over,
  };
}

async function linkedPair(deps: TestDeps) {
  const { repos } = deps;
  const ana = (await repos.accounts.getOrCreate({ handle: 'ana' }, deps.vault)).account;
  const ben = (await repos.accounts.getOrCreate({ handle: 'ben' }, deps.vault)).account;
  await repos.accounts.linkEvmAddress(ana.id, EVM_A);
  await repos.accounts.linkEvmAddress(ben.id, EVM_B);
  return { ana, ben };
}

const entrants = (a: string, b: string) => ({ A: { accountId: a, address: EVM_A }, B: { accountId: b, address: EVM_B } });

describe('PrivateLadderSync.afterMatch', () => {
  it('reports a win, reveals both tiers with the proof and caches them', async () => {
    const deps = await makeDeps();
    const { ana, ben } = await linkedPair(deps);
    const op = fakeLadder({ tierAfter: 3 });
    await new PrivateLadderSync(op, deps.repos, silent, syncOptions()).afterMatch('m1', entrants(ana.id, ben.id), 'B');
    expect(op.calls).toEqual(['report m1 B', `revealTier ${EVM_A}`, `revealTier ${EVM_B}`]);
    expect((await deps.repos.accounts.get(ana.id))!.ladderTier).toBe(3);
    expect((await deps.repos.accounts.get(ben.id))!.ladderTier).toBe(3);
    // The off-chain Elo is not the ladder's business.
    expect((await deps.repos.accounts.get(ana.id))!.elo).toBe(1200);
  });

  it('reports a draw without a reveal (nothing moved), caching the current tier', async () => {
    const deps = await makeDeps();
    const { ana, ben } = await linkedPair(deps);
    const op = fakeLadder();
    await new PrivateLadderSync(op, deps.repos, silent, syncOptions()).afterMatch('m2', entrants(ana.id, ben.id), null);
    expect(op.calls).toEqual(['report m2 draw']);
    expect((await deps.repos.accounts.get(ana.id))!.ladderTier).toBe(1);
  });

  it('skips unlinked or unregistered players and an already reported match', async () => {
    const deps = await makeDeps();
    const { ana, ben } = await linkedPair(deps);
    const cat = (await deps.repos.accounts.getOrCreate({ handle: 'cat' }, deps.vault)).account;
    const op = fakeLadder({ registered: [EVM_A] });
    const sync = new PrivateLadderSync(op, deps.repos, silent, syncOptions());
    await sync.afterMatch('m3', { A: { accountId: ana.id, address: EVM_A }, B: { accountId: cat.id, address: undefined } }, 'A'); // cat has no address
    await sync.afterMatch('m3', entrants(ana.id, ben.id), 'A'); // ben never registered
    expect(op.calls).toEqual([]);
    const both = fakeLadder();
    await both.report('m4', EVM_A, EVM_B, 'A');
    await new PrivateLadderSync(both, deps.repos, silent, syncOptions()).afterMatch('m4', entrants(ana.id, ben.id), 'A');
    // Reported by someone else: not reported again, but the tiers are still revealed and cached.
    expect(both.calls).toEqual(['report m4 A', `revealTier ${EVM_A}`, `revealTier ${EVM_B}`]);
    expect((await deps.repos.accounts.get(ana.id))!.ladderTier).toBe(2);
  });

  it('waits for the sealed settlement, and logs a chain failure instead of throwing', async () => {
    const deps = await makeDeps();
    const { ana, ben } = await linkedPair(deps);
    const op = fakeLadder();
    const sync = new PrivateLadderSync(op, deps.repos, silent, syncOptions());
    let settle!: () => void;
    const done = sync.afterMatch('m5', entrants(ana.id, ben.id), 'A', new Promise<void>((r) => (settle = r)));
    await new Promise((r) => setTimeout(r, 10));
    expect(op.calls).toEqual([]);
    settle();
    await done;
    expect(op.calls[0]).toBe('report m5 A');

    const warned: string[] = [];
    const broken = fakeLadder();
    broken.report = async () => {
      throw new Error('rpc down');
    };
    await new PrivateLadderSync(broken, deps.repos, { ...silent, warn: (m: string) => void warned.push(m) }, syncOptions()).afterMatch('m6', entrants(ana.id, ben.id), 'A');
    expect(warned.at(-1)).toContain('private ladder not updated: rpc down');
    expect(warned).toHaveLength(3); // the first try and two retries
  });

  it('retries a failed report, and reveals the other tier when one reveal fails', async () => {
    const deps = await makeDeps();
    const { ana, ben } = await linkedPair(deps);
    const op = fakeLadder();
    const report = op.report.bind(op);
    let tries = 0;
    op.report = async (...args) => {
      if (++tries === 1) throw new Error('rpc down');
      return report(...args);
    };
    const reveal = op.revealTier.bind(op);
    let failReveal = true;
    op.revealTier = async (a) => {
      if (a === EVM_A && failReveal) {
        failReveal = false;
        throw new Error('relayer down');
      }
      return reveal(a);
    };
    await new PrivateLadderSync(op, deps.repos, silent, syncOptions()).afterMatch('m7', entrants(ana.id, ben.id), 'A');
    expect(op.calls).toEqual(['report m7 A', `revealTier ${EVM_B}`, `revealTier ${EVM_A}`]);
    expect((await deps.repos.accounts.get(ana.id))!.ladderTier).toBe(2);
  });

  it('gives up its retries when stopped', async () => {
    const deps = await makeDeps();
    const { ana, ben } = await linkedPair(deps);
    const op = fakeLadder();
    let tries = 0;
    op.report = async () => {
      tries++;
      throw new Error('rpc down');
    };
    const sync = new PrivateLadderSync(op, deps.repos, silent, syncOptions({ retryMs: [60_000] }));
    const done = sync.afterMatch('m8', entrants(ana.id, ben.id), 'A');
    await new Promise((r) => setTimeout(r, 20));
    sync.stop();
    await done;
    expect(tries).toBe(1);
  });

  it('reports the address a player queued with after a relink, without caching its tier on the new one', async () => {
    const deps = await makeDeps();
    const { ana, ben } = await linkedPair(deps);
    await deps.repos.accounts.linkEvmAddress(ana.id, '0x000000000000000000000000000000000000c0de');
    const op = fakeLadder();
    await new PrivateLadderSync(op, deps.repos, silent, syncOptions()).afterMatch('m9', entrants(ana.id, ben.id), 'B');
    expect(op.calls[0]).toBe('report m9 B');
    expect((await deps.repos.accounts.get(ana.id))!.ladderTier).toBeNull();
    expect((await deps.repos.accounts.get(ben.id))!.ladderTier).toBe(2);
  });
});

describe('PrivateLadderSync.check', () => {
  it('answers close or far, vetoes a far pair until it lapses, and is unknown on a timeout or an error', async () => {
    let now = 0;
    const far = new PrivateLadderSync(fakeLadder({ close: async () => false }), (await makeDeps()).repos, silent, syncOptions({ now: () => now }));
    expect(await far.check(['ka', 'kb'], [EVM_A, EVM_B])).toBe('far');
    expect(far.vetoed('kb', 'ka')).toBe(true);
    now = 1_000;
    expect(far.vetoed('ka', 'kb')).toBe(false);

    const close = new PrivateLadderSync(fakeLadder(), (await makeDeps()).repos, silent, syncOptions());
    expect(await close.check(['ka', 'kb'], [EVM_A, EVM_B])).toBe('close');
    expect(close.vetoed('ka', 'kb')).toBe(false);

    const slow = new PrivateLadderSync(fakeLadder({ close: () => new Promise(() => undefined) }), (await makeDeps()).repos, silent, syncOptions());
    expect(await slow.check(['ka', 'kb'], [EVM_A, EVM_B])).toBe('unknown');

    const down = new PrivateLadderSync(fakeLadder({ close: async () => Promise.reject(new Error('relayer down')) }), (await makeDeps()).repos, silent, syncOptions());
    expect(await down.check(['ka', 'kb'], [EVM_A, EVM_B])).toBe('unknown');

    const unregistered = fakeLadder({ registered: [EVM_A] });
    expect(await new PrivateLadderSync(unregistered, (await makeDeps()).repos, silent, syncOptions()).check(['ka', 'kb'], [EVM_A, EVM_B])).toBe('unknown');
    expect(unregistered.calls).toEqual([]);
  });
});

async function player(hub: RealtimeHub, deps: TestDeps, handle: string, evm: string) {
  const sock = new FakeSocket();
  const c = hub.connect(sock);
  await hub.message(c, JSON.stringify({ type: 'auth', devUser: handle }));
  const acc = (await deps.repos.accounts.byHandle(handle))!;
  await deps.repos.ledger.topUp({ accountId: acc.id, credits: 2000 });
  await deps.repos.accounts.linkEvmAddress(acc.id, evm);
  const agents = await deps.repos.agents.listByOwner(acc.id);
  const send = (m: unknown) => hub.message(c, JSON.stringify(m));
  return { acc, agents, send, inbox: sock.inbox };
}

describe('the private ladder over the hub', () => {
  let hub: RealtimeHub | undefined;
  afterEach(async () => {
    await hub?.close();
    hub = undefined;
  });

  it('reports a ranked match between linked players and caches their tiers', async () => {
    const op = fakeLadder();
    const deps = await makeDeps({ v2Timing: FAST_V2, privateLadder: op });
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana', EVM_A);
    const ben = await player(hub, deps, 'ben', EVM_B);
    await ana.send({ type: 'v2_queue', crew: [{ agentId: ana.agents[0]!.id, tier: 'standard' }], ranked: true });
    await ben.send({ type: 'v2_queue', crew: [{ agentId: ben.agents[0]!.id, tier: 'standard' }], ranked: true });
    const found = await ana.inbox.next('v2_found');
    await ana.send({ type: 'v2_accept', matchId: found.matchId });
    await ben.send({ type: 'v2_accept', matchId: found.matchId });
    await ana.inbox.next('v2_lockin');
    await ana.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    await ben.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    // Relinking once the match is found changes nothing: the address she queued with is reported.
    await deps.repos.accounts.linkEvmAddress(ana.acc.id, '0x000000000000000000000000000000000000c0de');
    const end = await ana.inbox.next('v2_end', () => true, 30_000);
    await hub.close();
    hub = undefined;
    const winner = end.result && end.result.winner !== 'draw' ? end.result.winner : 'draw';
    expect(op.calls[0]).toBe(`report ${found.matchId} ${winner}`);
    // No pairing check without ZAMA_LADDER_MATCHMAKING.
    expect(op.calls.some((c) => c.startsWith('isClose'))).toBe(false);
    const tier = winner === 'draw' ? 1 : 2;
    expect((await deps.repos.accounts.get(ben.acc.id))!.ladderTier).toBe(tier);
    expect((await deps.repos.accounts.get(ana.acc.id))!.ladderTier).toBeNull();
  });

  it('reports nothing for a casual match', async () => {
    const op = fakeLadder();
    const deps = await makeDeps({ v2Timing: FAST_V2, privateLadder: op });
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana', EVM_A);
    const ben = await player(hub, deps, 'ben', EVM_B);
    await ana.send({ type: 'v2_queue', crew: [{ agentId: ana.agents[0]!.id, tier: 'standard' }], ranked: false, mapId: 'copper-hollow' });
    await ben.send({ type: 'v2_queue', crew: [{ agentId: ben.agents[0]!.id, tier: 'standard' }], ranked: false, mapId: 'copper-hollow' });
    const found = await ana.inbox.next('v2_found');
    await ana.send({ type: 'v2_accept', matchId: found.matchId });
    await ben.send({ type: 'v2_accept', matchId: found.matchId });
    await ana.inbox.next('v2_lockin');
    await ana.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    await ben.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    await ana.inbox.next('v2_end', () => true, 30_000);
    await hub.close();
    hub = undefined;
    expect(op.calls).toEqual([]);
  });
});
