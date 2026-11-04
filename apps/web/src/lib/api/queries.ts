'use client';
// Data fetching: TanStack Query v5 (@tanstack/react-query). One pattern everywhere:
//
//   const api = useApi();
//   const q = useQuery({ queryKey: qk.market.one(skillId), queryFn: () => api.marketSkill(skillId) });
//   const m = useMutation({ mutationFn: (p: AgentPatch) => api.patchAgent(agentId, p),
//                           onSuccess: () => qc.invalidateQueries({ queryKey: qk.me }) });
//
// Always build keys with `qk` so invalidation from other screens hits them. Signed-in-only routes
// should pass `enabled: session.status === 'signedIn'` (the hooks below do).
// Errors are ApiError (src/lib/api/errors.ts); 4xx are not retried (see src/app/providers.tsx).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../auth/session';
import { useApi } from '../services';
import type { Cosmetics, MarketQuery, Trial, TrialRequest } from './types';

/** Query keys. Prefix-shaped so `invalidateQueries({ queryKey: qk.skills.all })` clears a family. */
export const qk = {
  me: ['me'] as const,
  /** Under `me`, so invalidating qk.me (credits moved) refreshes it too. */
  earnBack: ['me', 'earn-back'] as const,
  /** Under `me`, so a credits change (a purchase elsewhere) refreshes it too. */
  cosmetics: ['me', 'cosmetics'] as const,
  /** Under `me`, so a match end (qk.me invalidated) refreshes it too. */
  myMatches: ['me', 'matches'] as const,
  agents: ['agents'] as const,
  /** Under `me`, so a match end (qk.me invalidated) refreshes it too. */
  agentRecord: (agentId: string) => ['me', 'agent-record', agentId] as const,
  rentalOffers: ['rentals'] as const,
  /** Under `me`, so a match end (qk.me invalidated) refreshes the passes left. */
  myRentals: ['me', 'rentals'] as const,
  skills: {
    all: ['skills'] as const,
    list: (tab: 'written' | 'owned') => ['skills', 'list', tab] as const,
    one: (skillId: string, version?: number) => ['skills', 'one', skillId, version ?? null] as const,
  },
  playbooks: ['playbooks'] as const,
  market: {
    all: ['market'] as const,
    list: (q: MarketQuery = {}) => ['market', 'list', q.tag ?? null, q.sort ?? 'winrate'] as const,
    one: (skillId: string, version?: number) => ['market', 'one', skillId, version ?? null] as const,
    trials: (skillId: string, version?: number) => ['market', 'trials', skillId, version ?? null] as const,
  },
  seasons: {
    all: ['seasons'] as const,
    current: ['seasons', 'current'] as const,
    standings: (seasonId: string, limit?: number, offset?: number) =>
      ['seasons', 'standings', seasonId, limit ?? null, offset ?? null] as const,
    list: ['seasons', 'list'] as const,
  },
  credits: ['credits'] as const,
  leaderboards: {
    all: ['leaderboards'] as const,
    players: (limit?: number) => ['leaderboards', 'players', limit ?? null] as const,
    map: (mapId: string, limit?: number) => ['leaderboards', 'map', mapId, limit ?? null] as const,
    skills: (mapId?: string, limit?: number) => ['leaderboards', 'skills', mapId ?? null, limit ?? null] as const,
  },
  lobbies: {
    all: ['lobbies'] as const,
    mine: ['lobbies', 'mine'] as const,
    one: (lobbyId: string) => ['lobbies', 'one', lobbyId] as const,
    code: (code: string) => ['lobbies', 'code', code] as const,
  },
  tournaments: {
    all: ['tournaments'] as const,
    list: ['tournaments', 'list'] as const,
    one: (id: string) => ['tournaments', 'one', id] as const,
  },
  matches: {
    all: ['matches'] as const,
    v2: (matchId: string) => ['matches', 'v2', matchId] as const,
    v2Live: ['matches', 'v2-live'] as const,
    highlights: (matchId: string) => ['matches', 'v2', matchId, 'highlights'] as const,
    shares: (matchId: string) => ['matches', 'v2', matchId, 'shares'] as const,
    shared: (shareId: string) => ['matches', 'shared', shareId] as const,
    v2Decisions: (matchId: string) => ['matches', 'v2', matchId, 'decisions'] as const,
  },
};

/**
 * GET /me: account, rank, credits and agents. Shared by the header and most screens; disabled while
 * signed out. Invalidated when a match the tab watches ends.
 */
export function useMe() {
  const api = useApi();
  const { status } = useSession();
  return useQuery({
    queryKey: qk.me,
    queryFn: () => api.me(),
    enabled: status === 'signedIn',
    staleTime: 15_000,
  });
}

/** GET /me/matches (signed in): the caller's latest v2 matches, newest first. */
export function useMyMatches() {
  const api = useApi();
  const { status } = useSession();
  return useQuery({
    queryKey: qk.myMatches,
    queryFn: () => api.myMatches(),
    enabled: status === 'signedIn',
    staleTime: 15_000,
  });
}

/** GET /seasons/current (public; signed in adds your row). Refreshed every minute. */
export function useCurrentSeason() {
  const api = useApi();
  const { status } = useSession();
  return useQuery({
    queryKey: [...qk.seasons.current, status === 'signedIn'],
    queryFn: () => api.currentSeason(),
    enabled: status !== 'loading',
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** GET /seasons/:id/standings, once the season id is known. */
export function useSeasonStandings(seasonId: string | undefined, page: { limit?: number; offset?: number } = {}) {
  const api = useApi();
  return useQuery({
    queryKey: qk.seasons.standings(seasonId ?? '', page.limit, page.offset),
    queryFn: () => api.seasonStandings(seasonId!, page),
    enabled: !!seasonId,
    staleTime: 30_000,
  });
}

/** GET /seasons: recent seasons. */
export function useSeasons() {
  const api = useApi();
  return useQuery({ queryKey: qk.seasons.list, queryFn: () => api.seasons(), staleTime: 60_000 });
}

/** GET /v2/matches/live, polled while mounted. */
export function useV2LiveMatches() {
  const api = useApi();
  return useQuery({ queryKey: qk.matches.v2Live, queryFn: () => api.v2LiveMatches(), refetchInterval: 5000 });
}

const OPEN_TRIAL = new Set<Trial['status']>(['queued', 'running']);

/** GET /market/:id/trials (signed in), polled every 2 s while a trial is queued or running. */
export function useTrials(skillId: string, version?: number, opts: { enabled?: boolean } = {}) {
  const api = useApi();
  const { status } = useSession();
  return useQuery({
    queryKey: qk.market.trials(skillId, version),
    queryFn: () => api.trials(skillId, version),
    enabled: status === 'signedIn' && (opts.enabled ?? true),
    refetchInterval: (q) => (q.state.data?.some((t) => OPEN_TRIAL.has(t.status)) ? 2000 : false),
  });
}

/** POST /market/:id/trial; refreshes the trial list and the drawer's trials left. */
export function useStartTrial(skillId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TrialRequest) => api.startTrial(skillId, body),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['market', 'trials', skillId] });
      void qc.invalidateQueries({ queryKey: ['market', 'one', skillId] });
    },
  });
}

/** GET /cosmetics (signed in): the premium catalog and the items you own. */
export function useCosmetics() {
  const api = useApi();
  const { status } = useSession();
  return useQuery({
    queryKey: qk.cosmetics,
    queryFn: () => api.cosmetics(),
    enabled: status === 'signedIn',
    staleTime: 60_000,
  });
}

/** POST /cosmetics/:id/buy: stores what you own now and refreshes credits. */
export function useBuyCosmetic() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => api.buyCosmetic(itemId),
    onSuccess: ({ owned }) => {
      qc.setQueryData<Cosmetics>(qk.cosmetics, (c) => (c ? { ...c, owned } : c));
      void qc.invalidateQueries({ queryKey: qk.me, exact: true });
      void qc.invalidateQueries({ queryKey: qk.credits });
    },
  });
}
