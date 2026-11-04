// Shared bits of the lobby and tournament screens: labels, the bracket grid and the prize preview.
import { TOURNAMENT, bracketRounds, roundMatches, tournamentPayouts, type LobbyTalkRule } from '@skirm/shared';
import type { BracketMatch, Lobby, TournamentDetail } from '@/lib/api/lobbyTypes';

export const TALK_RULE_LABEL: Record<LobbyTalkRule, string> = {
  any: 'Any tier',
  quiet: 'Quiet only',
  standard: 'Standard only',
  open: 'Open only',
};

/** "Final", "Semi-finals", "Quarter-finals", else "Round n". */
export function roundName(size: number, round: number): string {
  const left = bracketRounds(size) - round;
  if (left === 0) return 'Final';
  if (left === 1) return 'Semi-finals';
  if (left === 2) return 'Quarter-finals';
  return `Round ${round}`;
}

/** Every match slot of the bracket, round by round, with the matches made so far filled in. */
export function bracketGrid(t: Pick<TournamentDetail, 'size' | 'matches'>): { round: number; slots: (BracketMatch | null)[] }[] {
  const out: { round: number; slots: (BracketMatch | null)[] }[] = [];
  for (let r = 1; r <= bracketRounds(t.size); r++) {
    const slots = Array.from({ length: roundMatches(t.size, r) }, (_, s) => t.matches.find((m) => m.round === r && m.slot === s) ?? null);
    out.push({ round: r, slots });
  }
  return out;
}

/** What each paid place would get from this pool: champion, runner-up, each semi-final loser. */
export function prizePreview(pool: number): { place: string; credits: number }[] {
  if (pool <= 0) return [];
  const paid = tournamentPayouts(pool, [
    { accountId: '1', place: 1 },
    { accountId: '2', place: 2 },
    { accountId: '3', place: 3 },
    { accountId: '4', place: 3 },
  ]);
  const at = (id: string) => paid.find((p) => p.accountId === id)?.credits ?? 0;
  return [
    { place: '1st', credits: at('1') },
    { place: '2nd', credits: at('2') },
    { place: '3rd–4th (each)', credits: at('3') },
  ];
}

export const PRIZE_SPLIT_TEXT = `${TOURNAMENT.splitBps[0] / 100} / ${TOURNAMENT.splitBps[1] / 100} / ${TOURNAMENT.splitBps[2] / 100} % × 2`;

/** Which side of a lobby the account is on. */
export function sideOf(lobby: Lobby, accountId: string | undefined): 'host' | 'guest' | null {
  if (!accountId) return null;
  if (lobby.host.id === accountId) return 'host';
  if (lobby.guest?.id === accountId) return 'guest';
  return null;
}

/** The lobby's share link on this site. */
export function shareLink(code: string, origin = typeof window !== 'undefined' ? window.location.origin : ''): string {
  return `${origin}/lobbies/join/${encodeURIComponent(code)}`;
}
