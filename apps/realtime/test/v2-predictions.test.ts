// Spectator prediction markets (Zama, MatchPredictions on Sepolia) with the chain mocked: the market
// opens on a PvP match's first frame, closes and reveals its totals at the close tick (never later),
// resolves after the match (after the sealed settlement), and skips practice matches.
import type { ChainMarket, PredictionOperator } from '@skirm/server';
import { afterEach, describe, expect, it } from 'vitest';
import { RealtimeHub } from '../src/hub';
import { MARKET_CLOSE_SLACK_S, MatchMarkets } from '../src/v2/predictions';
import { FakeSocket, makeDeps, type TestDeps } from './helpers';

const FAST_V2 = { acceptMs: 500, lockMs: 400, tickMs: 1, actionMs: 200, planMs: 200 };
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** An in-memory MatchPredictions: records the calls, with `predictors` sealed predictions per market. */
function fakeOperator(predictors = 3) {
  const calls: string[] = [];
  const markets = new Map<string, ChainMarket>();
  const op: PredictionOperator & { calls: string[]; markets: Map<string, ChainMarket>; fail?: string } = {
    calls,
    markets,
    async read(id) {
      return markets.get(id) ?? { status: 'none', closesAt: 0, predictors: 0, totalA: 0n, totalB: 0n, winner: 255 };
    },
    async open(id, closesAt) {
      calls.push(`open ${id} ${closesAt}`);
      if (op.fail === 'open') throw new Error('rpc down');
      markets.set(id, { status: 'open', closesAt, predictors, totalA: 0n, totalB: 0n, winner: 255 });
      return '0x1';
    },
    async close(id) {
      calls.push(`close ${id}`);
      const m = markets.get(id)!;
      m.status = m.predictors ? 'closed' : 'void';
      return '0x2';
    },
    async revealTotals(id) {
      calls.push(`reveal ${id}`);
      const m = markets.get(id)!;
      Object.assign(m, { status: 'revealed', totalA: 40n, totalB: 20n });
      return { txHash: '0x3', totalA: 40n, totalB: 20n };
    },
    async resolve(id, winner) {
      calls.push(`resolve ${id} ${winner ?? 'draw'}`);
      markets.get(id)!.status = 'resolved';
      return '0x4';
    },
  };
  return op;
}

describe('MatchMarkets', () => {
  it('opens on the first frame with a backstop close time, closes and reveals at the close tick once', async () => {
    const op = fakeOperator();
    const now = 1_000_000;
    const mm = new MatchMarkets(op, silent, { tickMs: 2_000, now: () => now, closeTick: 30 });
    for (let t = 0; t < 40; t++) mm.tick('m1', t);
    await mm.idle();
    expect(op.calls).toEqual([`open m1 ${1000 + 60 + MARKET_CLOSE_SLACK_S}`, 'close m1', 'reveal m1']);
    await mm.end('m1', 'A');
    expect(op.calls.slice(3)).toEqual(['resolve m1 A']);
  });

  it('closes and reveals at the end of a match shorter than the close tick, then resolves a draw', async () => {
    const op = fakeOperator();
    const mm = new MatchMarkets(op, silent, { tickMs: 1, now: () => 0, closeTick: 30 });
    mm.tick('m2', 0);
    mm.tick('m2', 5);
    await mm.end('m2', null);
    expect(op.calls.map((c) => c.split(' ')[0])).toEqual(['open', 'close', 'reveal', 'resolve']);
    expect(op.calls.at(-1)).toBe('resolve m2 draw');
  });

  it('waits for the sealed settlement before resolving', async () => {
    const op = fakeOperator();
    const mm = new MatchMarkets(op, silent, { tickMs: 1, now: () => 0 });
    mm.tick('m3', 31);
    let settle!: () => void;
    const settled = new Promise<void>((r) => (settle = r));
    const done = mm.end('m3', 'B', settled);
    await new Promise((r) => setTimeout(r, 10));
    expect(op.calls.some((c) => c.startsWith('resolve'))).toBe(false);
    settle();
    await done;
    expect(op.calls.at(-1)).toBe('resolve m3 B');
  });

  it('skips reveal and resolve on an empty market (void at close), and everything after a failed open', async () => {
    const empty = fakeOperator(0);
    const a = new MatchMarkets(empty, silent, { tickMs: 1, now: () => 0 });
    a.tick('m4', 0);
    await a.end('m4', 'A');
    expect(empty.calls.map((c) => c.split(' ')[0])).toEqual(['open', 'close']);

    const down = fakeOperator();
    down.fail = 'open';
    const warned: string[] = [];
    const b = new MatchMarkets(down, { ...silent, warn: (m: string) => void warned.push(m) }, { tickMs: 1, now: () => 0 });
    b.tick('m5', 0);
    b.tick('m5', 30);
    await b.end('m5', 'A');
    expect(down.calls.map((c) => c.split(' ')[0])).toEqual(['open']);
    expect(warned[0]).toContain('not opened');
  });
});

async function player(hub: RealtimeHub, deps: TestDeps, handle: string) {
  const sock = new FakeSocket();
  const c = hub.connect(sock);
  await hub.message(c, JSON.stringify({ type: 'auth', devUser: handle }));
  const acc = (await deps.repos.accounts.byHandle(handle))!;
  await deps.repos.ledger.topUp({ accountId: acc.id, credits: 2000 });
  const agents = await deps.repos.agents.listByOwner(acc.id);
  const send = (m: unknown) => hub.message(c, JSON.stringify(m));
  return { acc, agents, send, inbox: sock.inbox };
}

describe('v2 prediction markets over the hub', () => {
  let hub: RealtimeHub | undefined;
  afterEach(async () => {
    await hub?.close();
  });

  it('runs a PvP match market from open to resolve with the stored winner', async () => {
    const op = fakeOperator();
    const deps = await makeDeps({ v2Timing: FAST_V2, predictionMarkets: op });
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana');
    const ben = await player(hub, deps, 'ben');
    await ana.send({ type: 'v2_queue', crew: [{ agentId: ana.agents[0]!.id, tier: 'standard' }], ranked: false, mapId: 'copper-hollow' });
    await ben.send({ type: 'v2_queue', crew: [{ agentId: ben.agents[0]!.id, tier: 'standard' }], ranked: false, mapId: 'copper-hollow' });
    const found = await ana.inbox.next('v2_found');
    await ana.send({ type: 'v2_accept', matchId: found.matchId });
    await ben.send({ type: 'v2_accept', matchId: found.matchId });
    await ana.inbox.next('v2_lockin');
    await ana.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    await ben.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    const end = await ana.inbox.next('v2_end', () => true, 30_000);
    await hub.close();
    hub = undefined;

    const id = found.matchId;
    const winner = end.result && end.result.winner !== 'draw' ? end.result.winner : 'draw';
    expect(op.calls.map((c) => c.split(' ').slice(0, 2).join(' '))).toEqual([`open ${id}`, `close ${id}`, `reveal ${id}`, `resolve ${id}`]);
    expect(op.calls.at(-1)).toBe(`resolve ${id} ${winner}`);
  });

  it('opens no market on a practice match', async () => {
    const op = fakeOperator();
    const deps = await makeDeps({ v2Timing: FAST_V2, predictionMarkets: op });
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana');
    await ana.send({ type: 'v2_queue', crew: [{ agentId: ana.agents[0]!.id, tier: 'standard' }], ranked: false, opponent: 'bot', mapId: 'copper-hollow' });
    const found = await ana.inbox.next('v2_found');
    await ana.send({ type: 'v2_accept', matchId: found.matchId });
    await ana.inbox.next('v2_lockin');
    await ana.send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    await ana.inbox.next('v2_end', () => true, 30_000);
    expect(op.calls).toEqual([]);
  });
});
