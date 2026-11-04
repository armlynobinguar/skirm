// Private lobbies and single-elimination tournaments. A lobby is a private casual match between two
// players (a share code, the host's map, difficulty, talk rule and crew size); it never counts for
// Elo, the season or the registry, and both crews hold and pay credits as in any casual match. A
// tournament is a bracket of 4, 8 or 16 players built from such lobbies: seeded by Elo, each
// round's lobbies made as the results come in, and an optional prize pool of the creator's paid
// credits paid to the top finishers.
import type { TalkTierName } from './talk';

/** Bracket sizes a tournament may have. */
export const TOURNAMENT_SIZES = [4, 8, 16] as const;
export type TournamentSize = (typeof TOURNAMENT_SIZES)[number];
export const isTournamentSize = (v: unknown): v is TournamentSize => TOURNAMENT_SIZES.includes(v as TournamentSize);

/** A lobby's talk rule: any tier per agent, or every agent on one tier. */
export const LOBBY_TALK_RULES = ['any', 'quiet', 'standard', 'open'] as const;
export type LobbyTalkRule = (typeof LOBBY_TALK_RULES)[number];
export const isLobbyTalkRule = (v: unknown): v is LobbyTalkRule => LOBBY_TALK_RULES.includes(v as LobbyTalkRule);

/** The tier a talk rule forces on every agent, or null when each agent keeps its own. */
export const forcedTier = (rule: LobbyTalkRule): TalkTierName | null => (rule === 'any' ? null : rule);

export const TOURNAMENT = {
  /** Most paid credits a prize pool may hold. */
  maxPrizePool: 100_000,
  /** Prize split by place in basis points: champion, runner-up, then each semi-final loser. */
  splitBps: [6000, 2500, 750, 750] as const,
  /**
   * A bracket match not played this long after it opened is decided without it: a player who
   * readied beats one who did not; when neither did, the better seed goes through.
   */
  noShowMs: 15 * 60_000,
  nameMax: 40,
} as const;

/** Lobby share codes: 6 characters with no look-alikes (no 0/O, 1/I/L). */
export const LOBBY_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LOBBY_CODE_LENGTH = 6;
export const isLobbyCode = (v: unknown): v is string =>
  typeof v === 'string' && v.length === LOBBY_CODE_LENGTH && [...v].every((ch) => LOBBY_CODE_ALPHABET.includes(ch));

/** A share code from `bytes` random bytes (at least LOBBY_CODE_LENGTH of them). */
export function lobbyCodeFrom(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < LOBBY_CODE_LENGTH; i++) out += LOBBY_CODE_ALPHABET[bytes[i]! % LOBBY_CODE_ALPHABET.length];
  return out;
}

/** Rounds in a bracket of `size` players (4 → 2, 8 → 3, 16 → 4). */
export const bracketRounds = (size: number): number => Math.round(Math.log2(size));

/** Matches in round `round` (1-based) of a bracket of `size`. */
export const roundMatches = (size: number, round: number): number => size >> round;

/**
 * Seeds in bracket order: consecutive pairs are the first-round matches, and seeds 1 and 2 can only
 * meet in the final (8 → 1 8 4 5 2 7 3 6).
 */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap((s) => [s, n - s]);
  }
  return order;
}

/** Where the winner of (round, slot) plays next: the next round's slot, as host (even) or guest (odd). */
export function nextMatch(round: number, slot: number): { round: number; slot: number; side: 'host' | 'guest' } {
  return { round: round + 1, slot: slot >> 1, side: slot % 2 === 0 ? 'host' : 'guest' };
}

/** The place of a player knocked out in `round` of a bracket of `size` (final loser 2, semi-final losers 3, …). */
export const placeOfLoser = (size: number, round: number): number => (size >> round) + 1;

export interface TournamentPayout {
  accountId: string;
  place: number;
  credits: number;
}

/**
 * The prize pool split over the finishers (`place` 1, 2, 3, 3, …): place 1 gets splitBps[0], 2 gets
 * splitBps[1], and each 3rd place one of the rest, floored; the rounding dust goes to the champion,
 * so the payouts add up to the pool exactly. Players outside the paid places get nothing.
 */
export function tournamentPayouts(pool: number, finishers: readonly { accountId: string; place: number }[]): TournamentPayout[] {
  if (!Number.isSafeInteger(pool) || pool < 0) throw new RangeError('pool must be a whole number ≥ 0');
  if (pool === 0) return [];
  const ranked = [...finishers].filter((f) => f.place <= 3).sort((a, b) => a.place - b.place);
  const out = ranked.slice(0, TOURNAMENT.splitBps.length).map((f, i) => ({
    accountId: f.accountId,
    place: f.place,
    credits: Math.floor((pool * TOURNAMENT.splitBps[i]!) / 10_000),
  }));
  const champion = out.find((p) => p.place === 1);
  const dust = pool - out.reduce((n, p) => n + p.credits, 0);
  if (champion) champion.credits += dust;
  return out.filter((p) => p.credits > 0);
}
