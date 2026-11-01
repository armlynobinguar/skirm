// The v2 result screen's data from whatever this tab has: the match as this tab saw it (the v2
// store, with the debrief from v2_end) and the stored record (GET /v2/matches/:id, which also knows
// the registry write and the Elo once settled). The record wins where both say something, since
// the worker updates it after the match. A spectator (a watch view, or a record without `you`)
// gets the result by crew, not a verdict of their own. The comms transcript is the talk this tab saw
// delivered (the store's say and team lines); a record alone has none.
import { DIFF_MODS, mapV2, type Difficulty, type MatchResult, type Team } from '@skirm/engine/v2';
import type { V2MatchRecord } from '@/lib/api/types';
import type { V2Debrief } from '@/lib/realtime/protocol';
import type { V2CommsLine, V2MatchView } from '../v2Store';

/** Where the ranked result stands on the NEAR registry. */
export type RegistryLine = 'written' | 'pending' | 'failed' | 'local' | 'casual' | 'none';

export interface DebriefData {
  matchId: string;
  mapId: string;
  ranked: boolean;
  difficulty: Difficulty;
  team: Team;
  status: 'live' | 'ended' | 'void';
  result: Pick<MatchResult, 'winner' | 'score' | 'ticks' | 'reason' | 'decidedBy'> | null;
  /** Why a void match did not happen (declined, accept_timeout, ...). */
  voidReason: string | null;
  debrief: V2Debrief | null;
  /** Ranked Elo change for this player; null for casual or not known yet. */
  eloDelta: number | null;
  registry: RegistryLine;
  txHash: string | null;
  logHash: string | null;
  /** Items a crew had to deliver. */
  goal: number;
  rivalHandle: string | null;
  /** Spectating: the result by crew, no verdict, Elo or report of one's own. */
  watch: boolean;
  /** Each crew's handle from the record (it shows both once the match is over); for spectators. */
  handles: Record<Team, string | null>;
  /** Practice against the greedy bot, and whether this crew played it free. */
  practice: boolean;
  free: boolean;
  /** What was said (say and team lines) as this tab saw it; null when the tab did not see the match. */
  comms: V2CommsLine[] | null;
}

export function debriefOf(view: V2MatchView | undefined, record: V2MatchRecord | undefined): DebriefData | null {
  if (!view && !record) return null;
  const mapId = record?.mapId ?? view!.mapId;
  const ranked = record?.ranked ?? view!.ranked;
  const debrief = view?.end?.debrief ?? record?.debrief ?? null;
  const difficulty: Difficulty = ranked ? 'normal' : (record?.difficulty ?? view?.difficulty ?? debrief?.difficulty ?? 'normal');
  const team: Team = view?.team ?? record?.you ?? 'A';
  const fromView = view?.end?.result ?? null;
  const fromRecord: DebriefData['result'] =
    record && record.winner && record.score
      ? {
          winner: record.winner,
          score: record.score,
          ticks: record.ticks ?? 0,
          reason: (record.reason ?? 'goal') as MatchResult['reason'],
          decidedBy: (record.decidedBy ?? 'score') as MatchResult['decidedBy'],
        }
      : null;
  const result = fromRecord ?? fromView;
  const status: DebriefData['status'] = record?.status ?? (view?.phase === 'ended' ? (result ? 'ended' : 'void') : 'live');
  const recordElo = record?.elo.find((e) => e.team === team)?.delta;
  const eloDelta = ranked ? (recordElo ?? debrief?.eloDelta ?? null) : null;
  const def = mapV2(mapId);
  const goal = view?.frame?.goal ?? Math.max(2, (def?.goal ?? 3) + DIFF_MODS[difficulty].goalDelta);
  const handles: Record<Team, string | null> = {
    A: record?.teams.A.handle ?? null,
    B: record?.teams.B.handle ?? null,
  };
  return {
    matchId: record?.id ?? view!.matchId,
    mapId,
    ranked,
    difficulty,
    team,
    status,
    result,
    voidReason: result ? null : (record?.reason ?? view?.end?.reason ?? null),
    debrief,
    eloDelta,
    registry: registryOf(ranked, record, debrief),
    txHash: record?.registry.txHash ?? null,
    logHash: record?.logHash ?? view?.end?.logHash ?? null,
    goal,
    rivalHandle: record?.teams[team === 'A' ? 'B' : 'A'].handle ?? view?.rivalHandle ?? null,
    watch: view ? view.watch : !!record && !record.you,
    handles,
    practice: view?.practice ?? false,
    free: view?.free ?? false,
    comms: view ? view.said : null,
  };
}

function registryOf(ranked: boolean, record: V2MatchRecord | undefined, debrief: V2Debrief | null): RegistryLine {
  if (!ranked) return 'casual';
  switch (record?.registry.status) {
    case 'recorded':
      return 'written';
    case 'pending':
      return 'pending';
    case 'failed':
      return 'failed';
    case 'local':
      return 'local';
    case 'none':
      return 'none';
  }
  return debrief?.registry === 'written' ? 'written' : debrief?.registry === 'pending' ? 'pending' : 'none';
}

/** The crew's best agent: the debrief's pick, else delivered × 3 + verbs used + pickups. */
export function mvpOf(d: V2Debrief): { agentId: string; name: string } | null {
  const pick = d.mvp ? d.agents.find((a) => a.agentId === d.mvp) : null;
  if (pick) return pick;
  const best = [...d.agents].sort((a, b) => b.delivered * 3 + b.used + b.picks - (a.delivered * 3 + a.used + a.picks))[0];
  return best ?? null;
}
