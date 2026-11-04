// Tournament consumer: the repeatable `tournaments` tick (every TOURNAMENT_TICK_EVERY_MS).
// Realtime settles a lobby as soon as its match ends; this tick settles any lobby it missed (the
// instance died after the result was written, or the orphan sweep voided the match), so a bracket
// never stalls on a lost settlement. It also decides bracket matches nobody started within
// TOURNAMENT.noShowMs of opening: a player who readied a crew beats one who did not, and when
// neither (or both, on different instances) did, the better seed goes through. Every step is
// idempotent, so a tick that dies part way is finished by the next one.
import { TOURNAMENT } from '@skirm/shared';
import { errorCode, type WorkerDeps } from './deps';

export type TournamentDeps = Pick<WorkerDeps, 'repos' | 'logger' | 'clock'>;

export interface TournamentTickOutcome {
  /** Matches whose lobby this tick settled. */
  settled: string[];
  /** Bracket lobbies decided without a match. */
  forfeited: string[];
}

export async function processTournamentTick(deps: TournamentDeps): Promise<TournamentTickOutcome> {
  const { repos, logger, clock } = deps;
  const out: TournamentTickOutcome = { settled: [], forfeited: [] };
  for (const matchId of await repos.lobbies.unsettled()) {
    try {
      if (await repos.lobbies.settleMatch(matchId)) out.settled.push(matchId);
    } catch (err) {
      logger.warn('lobby settle failed', { matchId, code: errorCode(err) });
    }
  }
  const cutoff = new Date(clock.now() - TOURNAMENT.noShowMs);
  for (const lobby of await repos.lobbies.staleBracket(cutoff)) {
    try {
      if (await repos.lobbies.forfeit(lobby.id)) out.forfeited.push(lobby.id);
    } catch (err) {
      logger.warn('bracket no-show failed', { lobbyId: lobby.id, code: errorCode(err) });
    }
  }
  if (out.settled.length || out.forfeited.length) logger.info('tournament tick', { settled: out.settled.length, forfeited: out.forfeited.length });
  return out;
}
