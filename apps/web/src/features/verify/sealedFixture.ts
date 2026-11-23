// A sealed round to verify before SkirmMatch is deployed: a real match played through @skirm/engine
// on a fixed "on-chain" seed and drop values, with the SkirmMatch record it would leave behind
// (events, revealed loadouts, randomness, settlement, escrow handles). Every value the checks compare
// is computed, not typed in, so the fixture passes for the same reasons a live round does. The
// tampered variants each change one thing a cheating server might, and fail the matching check.
// The /verify page labels it as a fixture wherever it shows it.
import {
  appendTick,
  createMatch,
  logAgent,
  logHash,
  mapV2,
  placeSealedDrop,
  sealedDropsDue,
  seedDropValue,
  startLog,
  stepMatch,
  type Action,
  type AgentSpec,
  type Dir,
  type LogDrop,
} from '@skirm/engine/v2';
import { encodeLoadout, type SealedPick, type SealedRosterAgent } from '@skirm/shared';
import type { PublicMatchLog } from '@/lib/api/matchLogTypes';
import { seatOf, type ChainEvent, type SealedChainRecord } from './sealed';

/** The match id the /verify page treats as the fixture (`?id=fixture-sealed-round`). */
export const SEALED_FIXTURE_ID = 'fixture-sealed-round';

export const FIXTURE_TAMPERS = ['wrong-seed', 'wrong-drop', 'wrong-crew', 'wrong-log-hash', 'edited-log'] as const;
export type FixtureTamper = (typeof FIXTURE_TAMPERS)[number];

/** `fixture-sealed-round` → the honest round; `fixture-sealed-round~wrong-seed` → a tampered one; else null. */
export function fixtureVariant(matchId: string): { tamper: FixtureTamper | null } | null {
  if (matchId === SEALED_FIXTURE_ID) return { tamper: null };
  const [base, t] = matchId.split('~');
  if (base !== SEALED_FIXTURE_ID || !FIXTURE_TAMPERS.includes(t as FixtureTamper)) return null;
  return { tamper: t as FixtureTamper };
}

export const fixtureId = (tamper: FixtureTamper | null) => (tamper ? `${SEALED_FIXTURE_ID}~${tamper}` : SEALED_FIXTURE_ID);

const MAP = 'basalt-stair';
const SEED = '7302215180563482144';
/** Drop 1's value as SkirmMatch revealed it; drop 2 "arrives late" and falls back to the seed. */
const CHAIN_DROPS = [41_233, 18_007, 0] as const;

const skill = (id: string) => ({ id });
const ROSTERS: Record<'A' | 'B', SealedRosterAgent[]> = {
  A: [
    { id: 'ada', skills: [skill('scout-ahead'), skill('call-drops')] },
    { id: 'bram', skills: [skill('hold-line')] },
    { id: 'moss', skills: [skill('carry'), skill('feint')] },
    { id: 'wick', skills: [skill('build')] },
  ],
  B: [
    { id: 'fen', skills: [skill('rush')] },
    { id: 'juno', skills: [skill('scout-ahead')] },
    { id: 'rook', skills: [skill('carry'), skill('guard')] },
  ],
};
const PICKS: Record<'A' | 'B', SealedPick[]> = {
  A: [
    { agentId: 'wick', tier: 'standard' },
    { agentId: 'ada', tier: 'open' },
    { agentId: 'moss', tier: 'quiet', skillIds: ['carry'] },
  ],
  B: [
    { agentId: 'juno', tier: 'open' },
    { agentId: 'fen', tier: 'standard' },
    { agentId: 'rook', tier: 'standard' },
  ],
};
const SPECS: Record<string, Omit<AgentSpec, 'id' | 'tier'>> = {
  wick: { name: 'Wick', role: 'Builder', vision: 3, comms: 3 },
  ada: { name: 'Ada', role: 'Scout', vision: 4, comms: 2 },
  moss: { name: 'Moss', role: 'Hauler', vision: 2, comms: 3 },
  juno: { name: 'Juno', role: 'Scout', vision: 4, comms: 3 },
  fen: { name: 'Fen', role: 'Runner', vision: 3, comms: 2 },
  rook: { name: 'Rook', role: 'Digger', vision: 3, comms: 3 },
};

const DIRS: readonly Dir[] = ['E', 'N', 'E', 'S', 'W', 'E'];
const hex = (n: number, len = 64) => `0x${n.toString(16).padStart(len, '0')}`;

export interface SealedFixture {
  matchId: string;
  log: PublicMatchLog;
  chain: SealedChainRecord;
  rosters: Record<'A' | 'B', SealedRosterAgent[]>;
}

let honest: SealedFixture | null = null;

/** Plays the honest round once (150 ticks through the engine) and builds its chain record. */
function build(): SealedFixture {
  const crews = { A: PICKS.A.map((p) => ({ id: p.agentId, tier: p.tier, ...SPECS[p.agentId]! })), B: PICKS.B.map((p) => ({ id: p.agentId, tier: p.tier, ...SPECS[p.agentId]! })) };
  const s = createMatch(mapV2(MAP)!, crews, { seed: SEED, sealedDrops: true });
  const log = startLog({
    schema: 'skirm.match/v2',
    map: MAP,
    crews: { A: s.agents.filter((a) => a.team === 'A').map(logAgent), B: s.agents.filter((a) => a.team === 'B').map(logAgent) },
    ranked: false,
    models: { planner: 'greedy', actor: 'greedy', speech: 'greedy' },
    seed: SEED,
    sealedDrops: true,
  });
  while (!s.result) {
    const next = s.tick + 1;
    const drops: LogDrop[] = sealedDropsDue(s, next).map((k) => {
      const fromSeed = k === 1;
      const value = fromSeed ? seedDropValue(SEED, k) : CHAIN_DROPS[k]!;
      const d = placeSealedDrop(s, k, value);
      return { slot: k, value, at: [d.at[0], d.at[1]], ...(fromSeed ? { fromSeed: true as const } : {}) };
    });
    const actions: Record<string, Action> = {};
    s.agents.forEach((a, i) => {
      if (!a.out) actions[a.id] = next % 3 === 0 ? { type: 'wait' } : { type: 'move', dir: DIRS[(next + i) % DIRS.length]! };
    });
    const says = next === 2 ? [{ agent: 'ada', channel: 'team' as const, text: 'drop lands centre' }] : [];
    stepMatch(s, { actions, says });
    appendTick(log, { tick: s.tick, actions, says, ...(drops.length ? { drops } : {}) });
  }
  log.result = s.result;
  const head = logHash(log);

  const enc = { A: encodeLoadout(PICKS.A, ROSTERS.A), B: encodeLoadout(PICKS.B, ROSTERS.B) };
  const key = hex(0x5ea1ed);
  const tx = (n: number) => hex(0xf1e0 + n);
  const ev = (name: string, block: number, logIndex: number, txn: number, args: Record<string, unknown>): ChainEvent => ({ name, block, logIndex, tx: tx(txn), args: { matchId: key, ...args } });
  const players: [string, string] = ['0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222'];
  const events: ChainEvent[] = [
    ev('MatchCreated', 7_100_000, 3, 1, { playerA: players[0], playerB: players[1] }),
    ev('LoadoutSealed', 7_100_004, 11, 2, { side: '0', player: players[0] }),
    ev('StakeLocked', 7_100_004, 14, 2, { side: '0', player: players[0], stakeHandle: hex(0xa0) }),
    ev('LoadoutSealed', 7_100_009, 5, 3, { side: '1', player: players[1] }),
    ev('StakeLocked', 7_100_009, 8, 3, { side: '1', player: players[1], stakeHandle: hex(0xb0) }),
    ev('BothLocked', 7_100_009, 9, 3, {}),
    ev('RandomnessDrawn', 7_100_009, 10, 3, { seedHandle: hex(0x5eed) }),
    ev('RevealRequested', 7_100_011, 2, 4, {}),
    ev('LoadoutRevealed', 7_100_013, 0, 5, { side: '0' }),
    ev('LoadoutRevealed', 7_100_013, 1, 5, { side: '1' }),
    ev('SeedRevealed', 7_100_013, 2, 5, { seed: SEED }),
    ev('StakeChecked', 7_100_013, 3, 5, { side: '0', ok: true }),
    ev('StakeChecked', 7_100_013, 4, 5, { side: '1', ok: true }),
    ev('DropRevealRequested', 7_100_019, 1, 6, { slot: '0' }),
    ev('DropRevealed', 7_100_020, 0, 7, { slot: '0', value: String(CHAIN_DROPS[0]) }),
    ev('MatchSettled', 7_100_040, 6, 8, { winner: String(seatOf(s.result)), logHash: `0x${head}` }),
    ev('StakePaid', 7_100_040, 7, 8, { side: '0', player: players[0], amountHandle: hex(0xa1) }),
    ev('StakePaid', 7_100_040, 8, 8, { side: '1', player: players[1], amountHandle: hex(0xb1) }),
  ];
  const chain: SealedChainRecord = {
    contract: null,
    key,
    status: 'settled',
    players,
    locked: [true, true],
    revealed: [enc.A, enc.B],
    // Drop 2 was never finalized on chain in time (the log placed it from the seed); slot 3 is unused on this map.
    randomness: { seed: SEED, drops: [CHAIN_DROPS[0], null, null], startedAt: 1_763_900_000 },
    settlement: { logHash: `0x${head}`, winner: seatOf(s.result), settledAt: 1_763_900_400 },
    escrow: { minStake: '10000000', feeBps: 250, staked: [hex(0xa0), hex(0xb0)], paid: [hex(0xa1), hex(0xb1)], stakeOk: [true, true] },
    events,
  };
  const served: PublicMatchLog = { matchId: SEALED_FIXTURE_ID, logHash: head, log: JSON.parse(JSON.stringify(log)) as PublicMatchLog['log'] };
  return { matchId: SEALED_FIXTURE_ID, log: served, chain, rosters: ROSTERS };
}

const clone = <T,>(v: T): T => structuredClone(v);

/** The fixture round, honest or with one `tamper` applied (a fresh copy each call). */
export function sealedFixture(tamper: FixtureTamper | null = null): SealedFixture {
  honest ??= build();
  const f = clone(honest);
  f.matchId = fixtureId(tamper);
  const { chain, log } = f;
  switch (tamper) {
    case 'wrong-seed': {
      // The server played on a seed of its own, not the one SkirmMatch drew.
      chain.randomness.seed = '1234567890123456789';
      for (const e of chain.events) if (e.name === 'SeedRevealed') e.args.seed = chain.randomness.seed;
      break;
    }
    case 'wrong-drop': {
      // The server landed drop 1 on another value than the one revealed on chain.
      chain.randomness.drops[0] = CHAIN_DROPS[0] + 1;
      for (const e of chain.events) if (e.name === 'DropRevealed' && e.args.slot === '0') e.args.value = String(chain.randomness.drops[0]);
      break;
    }
    case 'wrong-crew': {
      // Team A sealed bram (roster index 2) in slot 2, but the log played ada.
      chain.revealed![0].agents[1] = 2;
      break;
    }
    case 'wrong-log-hash': {
      chain.settlement!.logHash = hex(0xbad);
      for (const e of chain.events) if (e.name === 'MatchSettled') e.args.logHash = chain.settlement!.logHash;
      break;
    }
    case 'edited-log': {
      // Someone edited a tick after the fact: the chain breaks, and the replay disagrees.
      const t = log.log.ticks[4]!;
      t.actions[Object.keys(t.actions)[0]!] = { type: 'wait' };
      log.log.result = { ...log.log.result!, score: { A: log.log.result!.score.A + 1, B: log.log.result!.score.B } };
      break;
    }
    default:
      break;
  }
  return f;
}
