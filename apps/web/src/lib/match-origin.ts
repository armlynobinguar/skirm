// Where a match was started from, so its debrief can send the player back there ("Play again" after a
// campaign mission goes to the campaign, not the generic crew screen). Set by the screen that queued
// the match just before it navigates to /matches/:id; read by the debrief. Session storage (one tab),
// with an in-memory fallback when storage is blocked.
import { routes } from './routes';

export type MatchOrigin =
  /** Queued from the crew builder or the tutorial: Back goes to the Command deck. */
  | { kind: 'command' }
  | { kind: 'campaign'; missionId?: string }
  | { kind: 'lobby'; lobbyId: string }
  | { kind: 'tournament'; tournamentId: string };

const KEY = 'skirm:match-origin:';
const memory = new Map<string, MatchOrigin>();

export const matchOrigin = {
  set(matchId: string, origin: MatchOrigin): void {
    memory.set(matchId, origin);
    try {
      window.sessionStorage.setItem(KEY + matchId, JSON.stringify(origin));
    } catch {
      /* storage blocked: memory only */
    }
  },
  get(matchId: string): MatchOrigin | null {
    try {
      const raw = window.sessionStorage.getItem(KEY + matchId);
      if (raw) return JSON.parse(raw) as MatchOrigin;
    } catch {
      /* storage blocked or bad JSON: fall back to memory */
    }
    return memory.get(matchId) ?? null;
  },
};

/**
 * Where "Play again" goes and what it says, for a match started from a campaign, lobby or bracket.
 * Null for matches queued from the crew builder, whose debrief keeps "Queue/Practice again".
 */
export function originLink(origin: MatchOrigin): { href: string; label: string } | null {
  switch (origin.kind) {
    case 'command':
      return null;
    case 'campaign':
      return { href: routes.campaign(origin.missionId), label: 'Back to the campaign' };
    case 'lobby':
      return { href: routes.lobby(origin.lobbyId), label: 'Back to the lobby' };
    case 'tournament':
      return { href: routes.tournament(origin.tournamentId), label: 'Back to the bracket' };
  }
}

/**
 * Back from a match page (`/matches/:id`, its result): the screen the match was started from when
 * this tab knows it, else `fallback` (the PvP hub). Resolved at click time, never during render.
 */
export function matchBack(pathname: string, fallback: string): string {
  const m = /^\/matches\/([^/]+)/.exec(pathname);
  if (!m) return fallback;
  let id: string;
  try {
    id = decodeURIComponent(m[1]!);
  } catch {
    return fallback;
  }
  const origin = matchOrigin.get(id);
  if (!origin) return fallback;
  return originLink(origin)?.href ?? routes.home();
}
