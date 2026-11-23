// Sealed loadouts (Zama, SkirmMatch on Sepolia) over the hub, with the chain reader mocked: v2_seal
// grows the lock-in window and tells both crews, a sealed v2_lock_in waits for the finalized reveal,
// refuses a seat held by another address, and plays exactly the revealed crew (agents, tiers and
// the skills that play) whatever the client sends alongside.
import { mapV2, parseMapV2, sealedDropTile, verifyLog, type MatchLog } from '@skirm/engine/v2';
import { encodeLoadout, type SealedPick } from '@skirm/shared';
import type { ChainRandomness, MatchSettler, SealedMatchReader, SealedMatchState } from '@skirm/server';
import { afterEach, describe, expect, it } from 'vitest';
import { RealtimeHub } from '../src/hub';
import { FakeSocket, makeDeps, type TestDeps } from './helpers';

const FAST_V2 = { acceptMs: 500, lockMs: 400, sealedLockMs: 5_000, tickMs: 1, actionMs: 200, planMs: 200 };
const ANA_EVM = '0x00000000000000000000000000000000000000aa';
const BEN_EVM = '0x00000000000000000000000000000000000000bb';

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

/** A reader whose state the test sets; counts reads. */
function fakeReader(): SealedMatchReader & { state: SealedMatchState; reads: number } {
  return {
    state: { status: 'open', players: ['0x' + '0'.repeat(40), '0x' + '0'.repeat(40)], locked: [false, false], revealed: null },
    reads: 0,
    async read() {
      this.reads++;
      return this.state;
    },
  };
}

describe('v2 sealed loadouts', () => {
  let hub: RealtimeHub | undefined;
  afterEach(async () => {
    await hub?.close();
  });

  async function matched(deps: TestDeps) {
    hub = new RealtimeHub(deps);
    const ana = await player(hub, deps, 'ana');
    const ben = await player(hub, deps, 'ben');
    await ana.send({ type: 'v2_queue', crew: [{ agentId: ana.agents[0]!.id, tier: 'standard' }], ranked: false, mapId: 'copper-hollow' });
    await ben.send({ type: 'v2_queue', crew: [{ agentId: ben.agents[0]!.id, tier: 'standard' }], ranked: false, mapId: 'copper-hollow' });
    const found = await ana.inbox.next('v2_found');
    await ana.send({ type: 'v2_accept', matchId: found.matchId });
    await ben.send({ type: 'v2_accept', matchId: found.matchId });
    await ana.inbox.next('v2_lockin');
    await ben.inbox.next('v2_lockin');
    return { ana, ben, matchId: found.matchId };
  }

  it('refuses v2_seal and sealed locks when the server has no chain reader', async () => {
    const { ana, matchId } = await matched(await makeDeps({ v2Timing: FAST_V2 }));
    await ana.send({ type: 'v2_seal', matchId, address: ANA_EVM });
    expect(await ana.inbox.next('error')).toMatchObject({ code: 'zama_off' });
    await ana.send({ type: 'v2_lock_in', matchId, tiers: [], sealed: true });
    expect(await ana.inbox.next('error')).toMatchObject({ code: 'zama_off' });
  });

  it('plays the revealed crews once both seal, never the crew a client sends with the lock', async () => {
    const reader = fakeReader();
    const deps = await makeDeps({ v2Timing: FAST_V2, sealedMatches: reader });
    const { ana, ben, matchId } = await matched(deps);

    // A sealed lock before v2_seal is refused.
    await ana.send({ type: 'v2_lock_in', matchId, tiers: [], sealed: true });
    expect(await ana.inbox.next('error')).toMatchObject({ code: 'not_sealing' });

    // Sealing grows the lock-in window for both crews and tells the rival (without the picks).
    await ana.send({ type: 'v2_seal', matchId, address: ANA_EVM });
    expect(await ben.inbox.next('v2_sealing')).toEqual({ type: 'v2_sealing', matchId, team: 'A' });
    expect((await ben.inbox.next('v2_lockin')).lockMs).toBeGreaterThan(FAST_V2.lockMs);
    await ben.send({ type: 'v2_seal', matchId, address: BEN_EVM });
    await ana.inbox.next('v2_sealing', (m) => m.team === 'B');

    // Sealed on chain but not revealed yet: the lock waits.
    reader.state = { ...reader.state, status: 'locked', players: [ANA_EVM, BEN_EVM], locked: [true, true] };
    await ana.send({ type: 'v2_lock_in', matchId, tiers: [], sealed: true });
    expect(await ana.inbox.next('error')).toMatchObject({ code: 'not_revealed' });

    // Revealed: Ana's two agents (the third first, on Open, with no skills; then the first on Quiet),
    // Ben's second agent on Standard. Indexes follow the roster sorted by id.
    const anaPicks: SealedPick[] = [
      { agentId: ana.agents[2]!.id, tier: 'open', skillIds: [] },
      { agentId: ana.agents[0]!.id, tier: 'quiet' },
    ];
    const benPicks: SealedPick[] = [{ agentId: ben.agents[1]!.id, tier: 'standard' }];
    reader.state = {
      ...reader.state,
      status: 'revealed',
      revealed: [encodeLoadout(anaPicks, ana.agents), encodeLoadout(benPicks, ben.agents)],
    };

    // The crew sent alongside a sealed lock is ignored: the chain is authoritative.
    await ana.send({ type: 'v2_lock_in', matchId, tiers: ['open'], crew: [{ agentId: ana.agents[1]!.id, tier: 'open' }], sealed: true });
    await ben.send({ type: 'v2_lock_in', matchId, tiers: [], sealed: true });
    await ana.inbox.next('v2_start');
    await ana.inbox.next('v2_end', () => true, 30_000);

    const row = (await deps.repos.v2Matches.get(matchId))!;
    expect(row.crews!.A.map((a) => [a.id, a.tier])).toEqual([
      [ana.agents[2]!.id, 'open'],
      [ana.agents[0]!.id, 'quiet'],
    ]);
    expect(row.crews!.B.map((a) => [a.id, a.tier])).toEqual([[ben.agents[1]!.id, 'standard']]);
    // The benched agent plays no skill; the other plays every skill it equips.
    expect(row.crews!.A[0]!.skills ?? []).toEqual([]);
    expect((row.crews!.A[1]!.skills ?? []).map((s) => s.id)).toEqual(ana.agents[0]!.skills.map((s) => s.id));
    expect(reader.reads).toBeGreaterThanOrEqual(3);
  });

  it('refuses a sealed lock when the seat was taken by another address', async () => {
    const reader = fakeReader();
    const { ana, matchId } = await matched(await makeDeps({ v2Timing: FAST_V2, sealedMatches: reader }));
    await ana.send({ type: 'v2_seal', matchId, address: ANA_EVM });
    reader.state = {
      status: 'revealed',
      players: [BEN_EVM, ANA_EVM],
      locked: [true, true],
      revealed: [encodeLoadout([{ agentId: ana.agents[0]!.id, tier: 'open' }], ana.agents), { agents: [1, 0, 0], skills: [0, 0, 0], tiers: [1, 0, 0] }],
    };
    await ana.send({ type: 'v2_lock_in', matchId, tiers: [], sealed: true });
    expect(await ana.inbox.next('error')).toMatchObject({ code: 'wrong_player' });
  });
  it('plays on the chain seed and lands the supply drop on the tile its revealed value maps to', async () => {
    const SEED = '9876543210123456789';
    const VALUE = 777;
    const rnd: ChainRandomness = { seed: SEED, startedAt: 1_800_000_000, drops: [null, null, null] };
    const reader = Object.assign(fakeReader(), {
      drops: 0,
      async randomness() {
        this.drops++;
        // Revealed on chain only once the server starts asking (the drop came due).
        rnd.drops[0] = VALUE;
        return rnd;
      },
    });
    const deps = await makeDeps({ v2Timing: FAST_V2, sealedMatches: reader });
    const { ana, ben, matchId } = await matched(deps);
    await ana.send({ type: 'v2_seal', matchId, address: ANA_EVM });
    await ben.send({ type: 'v2_seal', matchId, address: BEN_EVM });
    reader.state = {
      status: 'revealed',
      players: [ANA_EVM, BEN_EVM],
      locked: [true, true],
      revealed: [encodeLoadout([{ agentId: ana.agents[0]!.id, tier: 'standard' }], ana.agents), encodeLoadout([{ agentId: ben.agents[0]!.id, tier: 'standard' }], ben.agents)],
      randomness: { ...rnd, drops: [null, null, null] },
    };
    await ana.send({ type: 'v2_lock_in', matchId, tiers: [], sealed: true });
    await ben.send({ type: 'v2_lock_in', matchId, tiers: [], sealed: true });
    expect((await ana.inbox.next('v2_start')).zama).toEqual({ seed: SEED, sealedDrops: true });
    await ana.inbox.next('v2_end', () => true, 30_000);

    const log = (await deps.repos.v2Matches.get(matchId))!.log as MatchLog;
    expect(log.header).toMatchObject({ seed: SEED, sealedDrops: true });
    expect(verifyLog(log)).toBeNull();
    const placed = log.ticks.flatMap((t) => (t.drops ?? []).map((d) => ({ ...d, tick: t.tick })));
    const copper = mapV2('copper-hollow')!;
    expect(log.ticks.length).toBeGreaterThanOrEqual(copper.drops[0]!.tick);
    expect(placed).toEqual([{ slot: 0, value: VALUE, at: sealedDropTile(parseMapV2(copper), VALUE), tick: copper.drops[0]!.tick }]);
    expect(reader.drops).toBeGreaterThanOrEqual(1);
  });
  it('settles a sealed match on chain once it ends, anchoring the log head hash', async () => {
    const reader = fakeReader();
    const settled: { matchId: string; winner: 'A' | 'B' | null; logHash: string }[] = [];
    let done!: () => void;
    const landed = new Promise<void>((r) => (done = r));
    const settler: MatchSettler = {
      async settle(matchId, winner, logHash) {
        settled.push({ matchId, winner, logHash });
        done();
        return { status: 'settled', txHash: '0xabc' };
      },
    };
    const deps = await makeDeps({ v2Timing: FAST_V2, sealedMatches: reader, matchSettler: settler });
    const { ana, ben, matchId } = await matched(deps);
    await ana.send({ type: 'v2_seal', matchId, address: ANA_EVM });
    await ben.send({ type: 'v2_seal', matchId, address: BEN_EVM });
    reader.state = {
      status: 'revealed',
      players: [ANA_EVM, BEN_EVM],
      locked: [true, true],
      revealed: [encodeLoadout([{ agentId: ana.agents[0]!.id, tier: 'standard' }], ana.agents), encodeLoadout([{ agentId: ben.agents[0]!.id, tier: 'standard' }], ben.agents)],
    };
    await ana.send({ type: 'v2_lock_in', matchId, tiers: [], sealed: true });
    await ben.send({ type: 'v2_lock_in', matchId, tiers: [], sealed: true });
    const end = await ana.inbox.next('v2_end', () => true, 30_000);
    await landed;

    const row = (await deps.repos.v2Matches.get(matchId))!;
    expect(settled).toHaveLength(1);
    expect(settled[0]!.matchId).toBe(matchId);
    expect(settled[0]!.logHash).toBe(row.logHash);
    expect(settled[0]!.logHash).toBe(end.logHash);
    const winner = end.result?.winner;
    expect(settled[0]!.winner).toBe(winner === 'A' || winner === 'B' ? winner : null);
  });

  it('does not settle a match that was not sealed', async () => {
    const calls: string[] = [];
    const settler: MatchSettler = {
      async settle(matchId) {
        calls.push(matchId);
        return { status: 'settled', txHash: '0x1' };
      },
    };
    const deps = await makeDeps({ v2Timing: FAST_V2, sealedMatches: fakeReader(), matchSettler: settler });
    const { ana, ben, matchId } = await matched(deps);
    await ana.send({ type: 'v2_lock_in', matchId, tiers: ['standard'] });
    await ben.send({ type: 'v2_lock_in', matchId, tiers: ['standard'] });
    await ana.inbox.next('v2_end', () => true, 30_000);
    expect(calls).toEqual([]);
  });
});
