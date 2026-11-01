// Small, valid response objects for tests. Override any field: meFixture({ cosmetics: [] }).
// Values follow a fresh dev account (contract "New account defaults") and Copper Hollow.
import { createMatch, frameFor, mapV2, type AgentSpec, type FrameView } from '@skirm/engine/v2';
import { COSMETICS, SEASON, defaultAppearance, rankTitle } from '@skirm/shared';
import type {
  Agent,
  Cosmetics,
  CurrentSeason,
  EarnBack,
  Me,
  MyMatch,
  PlayerLadderRow,
  Season,
  Standing,
  V2LiveMatch,
  V2MatchRecord,
} from '@/lib/api/types';
import type { V2Debrief, V2Frame } from '@/lib/realtime/protocol';

/** The fixture account (ada) and her first agent (Rook). */
export const ME_ID = 'acc_01J000000000000000000000AD';
export const ROOK = 'agt_01J0000000000000000000ROOK';

export function agentFixture(o: Partial<Agent> = {}): Agent {
  const id = o.id ?? ROOK;
  return {
    id,
    name: 'Rook',
    elo: 1200,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    skills: [],
    unlocks: [],
    role: 'Runner',
    vision: 3,
    comms: 3,
    tier: 'standard',
    appearance: defaultAppearance(id),
    ...o,
  };
}

export function meFixture(o: Partial<Me> = {}): Me {
  return {
    account: { id: ME_ID, handle: 'ada', nearAccountId: null },
    rank: { elo: 1200, rankedMatches: 0, wins: 0, losses: 0, draws: 0, title: rankTitle(1200).title, position: null },
    credits: {
      balance: 0,
      held: 0,
      allowanceLeft: 60,
      allowanceResetAt: '2026-10-26T00:00:00.000Z',
      available: 60,
    },
    agents: [
      agentFixture({
        skills: [{ id: 'skl_01J0000000000000000000FLOOD', version: 1, name: 'Flood Warden' }],
        unlocks: ['builder'],
        role: 'Builder',
      }),
      agentFixture({ id: 'agt_01J0000000000000000000WREN', name: 'Wren' }),
      agentFixture({ id: 'agt_01J0000000000000000000MOSS', name: 'Moss' }),
    ],
    unlocks: [
      { id: 'unl_1', kind: 'builder', attachedAgentId: ROOK },
      { id: 'unl_2', kind: 'digger', attachedAgentId: null },
      { id: 'unl_3', kind: 'firefighter', attachedAgentId: null },
    ],
    ...o,
  };
}

// ---------- v2 ----------

const v2Spec = (id: string, role: AgentSpec['role']): AgentSpec => ({ id, name: id[0]!.toUpperCase() + id.slice(1), role, vision: 3, comms: 3, tier: 'standard' });

/** A real engine frame: Copper Hollow at tick 0, Wick + Moss (A) against Wren (B), seen by `view`. */
export function v2FrameFixture(o: Partial<V2Frame> = {}, view: FrameView = 'A'): V2Frame {
  const s = createMatch(mapV2('copper-hollow')!, { A: [v2Spec('wick', 'Builder'), v2Spec('moss', 'Digger')], B: [v2Spec('wren', 'Scout')] });
  return { ...frameFor(s, view, []), ...o };
}

/** Crew A's debrief after a ranked win on Copper Hollow. */
export function v2DebriefFixture(o: Partial<V2Debrief> = {}): V2Debrief {
  return {
    eloDelta: 16,
    mvp: 'wick',
    goals: [
      { title: 'Shore the tunnels', met: true, available: true, progress: '3/3 verbs' },
      { title: 'Won the match', met: true },
    ],
    talk: { sent: 12, overheard: 3 },
    credits: { held: 600, used: 360, returned: 240 },
    registry: 'pending',
    agents: [
      { agentId: 'wick', name: 'Wick', delivered: 3, used: 4, picks: 3 },
      { agentId: 'moss', name: 'Moss', delivered: 1, used: 2, picks: 2 },
    ],
    difficulty: 'normal',
    ...o,
  };
}

export function playerLadderRowFixture(o: Partial<PlayerLadderRow> = {}): PlayerLadderRow {
  const elo = o.elo ?? 1240;
  return {
    rank: 7,
    account: { id: 'acc_01J000000000000000000000AD', handle: 'ada' },
    elo,
    title: rankTitle(elo).title,
    rankedMatches: 23,
    wins: 14,
    losses: 9,
    draws: 0,
    ...o,
  };
}

/** Real values for royalties, sales, season prizes and spend; rentals not offered (null). */
export function earnBackFixture(o: Partial<EarnBack> = {}): EarnBack {
  return {
    royaltiesYocto: '840000000000000000000000',
    salesNetYocto: '1000000000000000000000000',
    spentCredits: 2100,
    creditsPerNear: 1000,
    prizesYocto: '500000000000000000000000',
    rentalsYocto: null,
    ...o,
  };
}

export function v2MatchRecordFixture(o: Partial<V2MatchRecord> = {}): V2MatchRecord {
  const crew = (id: string, name: string, role: string) => ({ id, name, role, vision: 3, comms: 3, tier: 'standard' });
  return {
    id: 'mat_v2',
    mapId: 'copper-hollow',
    ranked: true,
    status: 'ended',
    difficulty: null,
    teams: {
      A: { accountId: 'acc_01J000000000000000000000AD', handle: 'ada', crew: [crew('wick', 'Wick', 'Builder'), crew('moss', 'Moss', 'Digger')] },
      B: { accountId: 'acc_01J000000000000000000000BE', handle: 'ben', crew: [crew('wren', 'Wren', 'Scout')] },
    },
    winner: 'A',
    reason: 'goal',
    decidedBy: 'goal',
    score: { A: 4, B: 2 },
    ticks: 90,
    elo: [
      { accountId: 'acc_01J000000000000000000000AD', team: 'A', before: 1224, delta: 16, after: 1240 },
      { accountId: 'acc_01J000000000000000000000BE', team: 'B', before: 1236, delta: -16, after: 1220 },
    ],
    stats: {
      A: { timeouts: 0, errors: 0, illegal: 1, refusedSays: 0, costUsd: 0.04, charged: 360 },
      B: { timeouts: 2, errors: 0, illegal: 0, refusedSays: 1, costUsd: 0.02, charged: 180 },
    },
    logHash: 'ab'.repeat(32),
    registry: { status: 'pending' },
    createdAt: '2026-10-25T12:00:00.000Z',
    endedAt: '2026-10-25T12:03:00.000Z',
    you: 'A',
    debrief: v2DebriefFixture(),
    ...o,
  };
}

/** A ranked win on Copper Hollow, 4–2, +16 Elo. */
export function myMatchFixture(o: Partial<MyMatch> = {}): MyMatch {
  return {
    id: 'mat_v2',
    mapId: 'copper-hollow',
    ranked: true,
    practice: false,
    result: 'win',
    score: { you: 4, rival: 2 },
    endedAt: '2026-10-25T12:03:00.000Z',
    eloDelta: 16,
    ...o,
  };
}

// ---------- Seasons, live list, cosmetics ----------

/** Season 3, open, a local pool of 12.5 NEAR, ending 2 days and 3 hours after `now`. */
export function seasonFixture(o: Partial<Season> = {}, now = Date.now()): Season {
  return {
    id: 'ssn_01J00000000000000000000003',
    number: 3,
    startsAt: new Date(now - 11 * 86_400_000).toISOString(),
    endsAt: new Date(now + 2 * 86_400_000 + 3 * 3_600_000).toISOString(),
    status: 'open',
    poolYocto: '12500000000000000000000000',
    poolSource: 'local',
    splitBps: [...SEASON.splitBps],
    ...o,
  };
}

export function standingFixture(o: Partial<Standing> = {}): Standing {
  return {
    rank: 1,
    account: { id: 'acc_nova', handle: 'nova' },
    points: 130,
    wins: 5,
    losses: 1,
    draws: 0,
    matches: 6,
    elo: 1612,
    projectedPrizeYocto: '3750000000000000000000000',
    ...o,
  };
}

export function currentSeasonFixture(o: Partial<CurrentSeason> = {}): CurrentSeason {
  return {
    season: seasonFixture(),
    top: [
      standingFixture(),
      standingFixture({ rank: 2, account: { id: 'acc_mira', handle: 'mira' }, points: 105, wins: 4, losses: 1, elo: 1588, projectedPrizeYocto: '2500000000000000000000000' }),
    ],
    ...o,
  };
}

export function v2LiveMatchFixture(o: Partial<V2LiveMatch> = {}): V2LiveMatch {
  return {
    id: 'mat_live',
    mapId: 'copper-hollow',
    difficulty: null,
    ranked: true,
    practice: false,
    startedAt: new Date(Date.now() - 65_000).toISOString(),
    teams: { A: { handle: 'ada', size: 2 }, B: { handle: 'ben', size: 2 } },
    ...o,
  };
}

export function cosmeticsFixture(o: Partial<Cosmetics> = {}): Cosmetics {
  return { items: COSMETICS.map((c) => ({ ...c })), owned: [], ...o };
}
