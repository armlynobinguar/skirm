import { describe, expect, it, vi } from 'vitest';
import { buildSealedReport, compareLoadout, isSealedLog, replayLog, seatOf, type ChainEvent, type SealedCheck } from './sealed';
import { chainKey, readSealedChain, scanEvents, type SealedChainSource } from './sealedChain';
import { FIXTURE_TAMPERS, fixtureVariant, sealedFixture, SEALED_FIXTURE_ID } from './sealedFixture';

const stateOf = (checks: SealedCheck[]) => Object.fromEntries(checks.map((c) => [c.id, c.state]));

describe('sealed round fixture', () => {
  it('passes every check, with the drops from the chain and the seed fallback', () => {
    const f = sealedFixture();
    const r = buildSealedReport(f.log.log, f.chain, { rosters: f.rosters });
    expect(stateOf(r.checks)).toEqual({ commitments: 'pass', seed: 'pass', drops: 'pass', loadouts: 'pass', anchor: 'pass', replay: 'pass', privacy: 'private' });
    expect(r.status).toBe('verified');
    expect(r.logHash).toBe(f.log.logHash);
    const drops = r.checks.find((c) => c.id === 'drops')!;
    expect(drops.lines.join('\n')).toMatch(/seed fallback/);
    expect(drops.lines).toHaveLength(2);
  });

  it('also passes without the rosters (the structural loadout check)', () => {
    const f = sealedFixture();
    const r = buildSealedReport(f.log.log, f.chain);
    expect(r.status).toBe('verified');
    expect(r.checks.find((c) => c.id === 'loadouts')!.lines[0]).toMatch(/roster order consistent/);
  });

  it.each([
    ['wrong-seed', ['seed']],
    ['wrong-drop', ['drops']],
    ['wrong-crew', ['loadouts']],
    ['wrong-log-hash', ['anchor']],
    ['edited-log', ['anchor', 'replay']],
  ] as const)('%s fails exactly %j', (tamper, failing) => {
    const f = sealedFixture(tamper);
    const r = buildSealedReport(f.log.log, f.chain, { rosters: f.rosters });
    expect(r.status).toBe('mismatch');
    expect(r.checks.filter((c) => c.state === 'fail').map((c) => c.id)).toEqual(failing);
  });

  it('parses fixture ids', () => {
    expect(fixtureVariant(SEALED_FIXTURE_ID)).toEqual({ tamper: null });
    expect(fixtureVariant(`${SEALED_FIXTURE_ID}~wrong-seed`)).toEqual({ tamper: 'wrong-seed' });
    expect(fixtureVariant(`${SEALED_FIXTURE_ID}~nope`)).toBeNull();
    expect(fixtureVariant('mat_1')).toBeNull();
    expect(FIXTURE_TAMPERS).toContain('wrong-crew');
  });
});

describe('sealed checks', () => {
  it('flags randomness drawn before the second seal', () => {
    const f = sealedFixture();
    const drawn = f.chain.events.find((e) => e.name === 'RandomnessDrawn')!;
    drawn.block = 7_100_005;
    expect(stateOf(buildSealedReport(f.log.log, f.chain).checks).commitments).toBe('fail');
  });

  it('is pending, not failing, before the reveal and the settlement', () => {
    const f = sealedFixture();
    f.chain.revealed = null;
    f.chain.randomness = { seed: null, drops: [null, null, null], startedAt: 0 };
    f.chain.settlement = null;
    f.chain.events = f.chain.events.filter((e) => ['MatchCreated', 'LoadoutSealed', 'RandomnessDrawn'].includes(e.name));
    const r = buildSealedReport(f.log.log, f.chain);
    expect(stateOf(r.checks)).toMatchObject({ commitments: 'pass', seed: 'pending', loadouts: 'pending', anchor: 'pending', replay: 'pass' });
    expect(r.status).toBe('mismatch'); // drop 1's logged value is not on chain
  });

  it('flags a drop whose tile is not the engine mapping', () => {
    const f = sealedFixture();
    const t = f.log.log.ticks.find((x) => x.drops?.length)!;
    t.drops![0]!.at = [0, 0];
    expect(stateOf(buildSealedReport(f.log.log, f.chain).checks).drops).toBe('fail');
  });

  it('maps a result to the contract seat', () => {
    expect(seatOf({ winner: 'A' })).toBe(0);
    expect(seatOf({ winner: 'B' })).toBe(1);
    expect(seatOf({ winner: 'draw' })).toBe(255);
    expect(seatOf(null)).toBe(255);
  });

  it('compares loadouts structurally', () => {
    const crew = [
      { id: 'wick', name: 'W', role: 'Builder', vision: 3, comms: 3, tier: 'standard' },
      { id: 'ada', name: 'A', role: 'Scout', vision: 3, comms: 3, tier: 'open' },
    ];
    expect(compareLoadout({ agents: [4, 1, 0], skills: [1, 3, 0], tiers: [1, 2, 0] }, crew, { ranked: false }).ok).toBe(true);
    expect(compareLoadout({ agents: [1, 4, 0], skills: [1, 3, 0], tiers: [1, 2, 0] }, crew, { ranked: false }).detail).toMatch(/roster order/);
    expect(compareLoadout({ agents: [4, 1, 2], skills: [1, 3, 0], tiers: [1, 2, 0] }, crew, { ranked: false }).detail).toMatch(/sealed 3 agents/);
    expect(compareLoadout({ agents: [4, 1, 0], skills: [1, 3, 0], tiers: [1, 1, 0] }, crew, { ranked: false }).ok).toBe(false);
    expect(compareLoadout({ agents: [4, 1, 0], skills: [1, 3, 0], tiers: [1, 1, 0] }, crew, { ranked: true }).ok).toBe(true);
  });

  it('replays the fixture to its result and recognises a sealed log', () => {
    const f = sealedFixture();
    expect(isSealedLog(f.log.log)).toBe(true);
    const r = replayLog(f.log.log);
    expect(r.ok).toBe(true);
    expect(r.result).toEqual(f.log.log.result);
  });
});

describe('readSealedChain', () => {
  const f = sealedFixture();
  const u = (n: number[]) => n.map(BigInt);
  function source(events: ChainEvent[], latest = 7_100_100): SealedChainSource & { calls: [number, number][] } {
    const calls: [number, number][] = [];
    return {
      contract: '0x00000000000000000000000000000000000000aa',
      calls,
      getMatch: async () => ({ players: ['0xAbC0000000000000000000000000000000000001', '0x0000000000000000000000000000000000000002'], status: 7n, locked: [true, true] }),
      revealedLoadout: async (_k, side) => {
        const l = f.chain.revealed![side as 0 | 1];
        return { agents: u(l.agents), skills: u(l.skills), tiers: u(l.tiers) };
      },
      randomness: async () => ({ seed: BigInt(f.chain.randomness.seed!), drops: [41233n, 99n, 0n], startedAt: 5n, dropsRevealed: 1n }),
      settlement: async () => ({ logHash: f.chain.settlement!.logHash.toUpperCase().replace('0X', '0x'), winner: BigInt(f.chain.settlement!.winner), settledAt: 9n }),
      escrow: async () => ({ minStake: 10_000_000n, matchFeeBps: 250n, staked: ['0xa', '0xb'], paid: ['0xc', '0xd'], stakeOkClear: [true, false] }),
      blockNumber: async () => latest,
      events: vi.fn(async (_k: string, from: number, to: number) => {
        calls.push([from, to]);
        return events.filter((e) => e.block >= from && e.block <= to);
      }),
    };
  }

  it('normalises the views and orders the events', async () => {
    const src = source([...f.chain.events].reverse());
    const rec = await readSealedChain(src, f.matchId, { fromBlock: 7_000_000 });
    expect(rec.key).toBe(chainKey(f.matchId));
    expect(rec.status).toBe('settled');
    expect(rec.players[0]).toBe('0xabc0000000000000000000000000000000000001');
    expect(rec.revealed).toEqual(f.chain.revealed);
    expect(rec.randomness).toEqual({ seed: f.chain.randomness.seed, drops: [41233, null, null], startedAt: 5 });
    expect(rec.settlement?.logHash).toBe(f.chain.settlement!.logHash);
    expect(rec.escrow).toEqual({ minStake: '10000000', feeBps: 250, staked: ['0xa', '0xb'], paid: ['0xc', '0xd'], stakeOk: [true, false] });
    expect(rec.events.map((e) => e.name)).toEqual(f.chain.events.map((e) => e.name));
    expect(rec.eventsPartial).toBeUndefined();
    // The verdict on the read record is the fixture's.
    expect(buildSealedReport(f.log.log, rec, { rosters: f.rosters }).status).toBe('verified');
  });

  it('scans back in windows and stops at MatchCreated', async () => {
    const src = source(f.chain.events, 7_100_000 + 95_000);
    const out = await scanEvents(src, '0xk', { window: 10_000, fromBlock: 6_000_000 });
    expect(out.partial).toBe(false);
    expect(out.events[0]!.name).toBe('MatchCreated');
    expect(src.calls.length).toBe(12); // three rounds of four windows
    expect(src.calls[0]).toEqual([7_185_001, 7_195_000]);
  });

  it('reports a partial scan when the lookback runs out before MatchCreated', async () => {
    const src = source([], 1_000_000);
    const out = await scanEvents(src, '0xk', { window: 10_000, maxLookback: 30_000 });
    expect(out).toEqual({ events: [], partial: true });
    expect(src.calls.at(-1)![0]).toBe(970_000);
  });
});
