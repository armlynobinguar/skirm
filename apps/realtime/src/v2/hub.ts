// v2 matchmaking and the v2 matches this instance holds. The connection hub routes every v2_*
// message here. A search is one account with 1 to 3 of its agents (each with a talk tier), paired by
// player Elo within its mode (ranked or casual; a casual search also names its map and difficulty,
// and pairs only with the same pick); a pair becomes a V2Match on a map that fits both crews. The
// result is written to `v2_matches` (Elo moves in the same transaction), a ranked result is queued
// for the registry, and the frames are kept a while for replay. Practice skips matchmaking: the
// player meets the greedy bot (SYSTEM_ACCOUNT_ID) at once, casual, with no Elo and no registry job.
// Draft mode is a casual search with `draft`: it pairs only with draft searches, and its match bans
// skills between accept and lock-in (V2Match.ban).
//
// Players are served only by the instance running their match (their sockets are routed to it).
// Watchers can be anywhere: the running instance publishes every watch-view message on
// `v2match:<id>` and keeps the latest in `v2match:<id>:last`, and watch() on any other instance
// relays that channel.
//
// Private lobbies (made and joined over REST) skip matchmaking too: each player readies a crew in
// the lobby (`lobbyReady`), and once both have, the match starts on the host's map, difficulty,
// talk rule and crew size, host as crew A. It is casual (no Elo, no registry) and both crews hold
// credits as usual. When it ends the lobby is settled (LobbiesRepo.settleMatch), which moves a
// tournament bracket on.
//
// A campaign mission (@skirm/shared CAMPAIGN_CHAPTERS) is practice with `mission`: the mission fixes
// the map, difficulty and largest crew, it must be unlocked for the player, and its result is
// recorded (CampaignRepo.record, which grants a completed chapter's rewards) before v2_end goes out.
import { SYSTEM_ACCOUNT_ID, newId, sealedSecretOf, type LobbyRow, type Repos, type V2CrewRecord, type V2MatchRow } from '@skirm/db';
import { campaignMission, forcedTier, isLobbyTalkRule, missionUnlocked } from '@skirm/shared';
import { createGreedyBrain, type V2Brain } from '@skirm/decision-engine/v2';
import {
  BOT_HANDLE,
  DEFAULT_PRACTICE,
  MAPS_V2,
  isCommunityMapId,
  isDifficulty,
  RANKED_DIFFICULTY,
  botCrew,
  practiceRival,
  validateCommunityMap,
  type AgentSpec,
  type Difficulty,
  type FrameView,
  type MapDefV2,
  type MatchResult,
  type Team,
  type V2Frame,
} from '@skirm/engine/v2';
import { DEFAULTS, skillFitsRole } from '@skirm/shared';
import { V2_MATCH_LAST_TTL_S, v2MatchChannel, v2MatchLastKey, type ExternalTurnStore, type V2CrewEntry, type V2EndReason, type V2ServerMessage, type Vault } from '@skirm/server';
import type { Logger, RegistryQueue } from '../deps';
import { Matchmaker, type Lane, type QueueEntry } from '../matchmaker';
import type { WsServerMessage } from '../protocol';
import type { PubSub, Unsubscribe } from '../pubsub';
import type { QueueTiming, Scheduler } from '../timing';
import { LedgerV2Credits, v2HoldId } from './credits';
import { ExternalBrain, isExternalBrain, type WebhookPost } from './external';
import { DEFAULT_V2_TIMING, TEAMS, V2Match, crewLimitOf, type V2BanError, type V2CommandError, type V2CommandInput, type V2Finish, type V2MatchDeps, type V2MatchEnd, type V2Playbook, type V2Roster, type V2Setup, type V2Side, type V2SkillMeta, type V2Timing } from './match';
import type { V2FrameStore } from './replay';

export interface V2Search {
  accountId: string;
  handle: string;
  crew: V2CrewEntry[];
  ranked: boolean;
  /** Casual: the board picked on the atlas (absent: any map that fits). Ranked: always absent. */
  mapId?: string;
  /** Ranked: always RANKED_DIFFICULTY. */
  difficulty: Difficulty;
  /** Casual only: draft mode (a ban phase before lock-in). */
  draft?: boolean;
  /** The player's Elo and ranked matches as they queued (their tier on v2_found). */
  rank?: { elo: number; rankedMatches: number };
}

/** A crew readied in a private lobby. */
interface LobbyWait {
  user: { accountId: string; handle: string };
  crew: V2CrewEntry[];
}

/** Casual pick: a map (or any) and a difficulty. */
export interface V2QueueOptions {
  mapId?: string;
  difficulty?: Difficulty;
  /** Draft mode: casual only. */
  draft?: boolean;
  /** Practice only: a campaign mission (its map and difficulty win over mapId and difficulty). */
  mission?: string;
}

/** The match a roster is loaded for (its external agents' turns name it; ranked has none). */
interface RosterMatch {
  matchId: string;
  ranked: boolean;
}

/**
 * Casual searches pair within one difficulty, on one picked map (or any, '*'), and draft only with
 * draft (a third `|draft` part); ranked has a single pool.
 */
export const v2Pool = (s: Pick<V2Search, 'ranked' | 'mapId' | 'difficulty' | 'draft'>) => (s.ranked ? undefined : `${s.mapId ?? '*'}|${s.difficulty}${s.draft ? '|draft' : ''}`);

/** Two pools pair when they are equal, or at one difficulty and mode when either search takes any map. */
export function v2PoolsMatch(a: string | undefined, b: string | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const [mapA, diffA, modeA] = a.split('|');
  const [mapB, diffB, modeB] = b.split('|');
  return diffA === diffB && modeA === modeB && (mapA === '*' || mapB === '*');
}

export interface V2HubDeps {
  repos: Repos;
  /** decryptPlaybook opens crew playbooks (without it, crews play with none). */
  vault: Pick<Vault, 'decryptSkill'> & Partial<Pick<Vault, 'decryptPlaybook'>>;
  /** The players' brain (practice: the bot always plays greedy). */
  brain: V2Brain;
  scheduler: Scheduler;
  queueTiming: QueueTiming;
  timing?: Partial<V2Timing>;
  maps?: readonly MapDefV2[];
  pickMap?: (fits: readonly MapDefV2[]) => MapDefV2;
  send(accountId: string, msg: WsServerMessage): void;
  /** Ranked results go to the registry worker (`v2_match` jobs). */
  registry?: RegistryQueue;
  /** Frames of ended matches, for v2_replay. */
  frames?: V2FrameStore;
  /** Relays watch-view messages between instances, so a match can be watched from any of them. */
  pubsub: PubSub;
  /** The pull relay for external agents without a webhook (absent: they miss every tick). */
  externalTurns?: ExternalTurnStore;
  /** Tests only: the webhook transport (default: the SSRF-safe safePostJson). */
  externalPost?: WebhookPost;
  log: Logger;
}

export class V2HubError extends Error {
  constructor(
    readonly code:
      | 'invalid_crew'
      | 'agent_busy'
      | 'already_queued'
      | 'in_match'
      | 'not_queued'
      | 'not_found'
      | 'unavailable'
      | 'not_in_lockin'
      | 'external_unranked'
      | 'lobby_closed'
      | 'draft_casual'
      | 'mission_locked'
      | V2BanError
      | V2CommandError,
    message: string,
  ) {
    super(message);
  }
}

/** The matchmaker keeps one queue per lane. */
const lane = (ranked: boolean): Lane => (ranked ? 'ranked' : 'casual');

export class V2Hub {
  readonly matchmaker: Matchmaker<V2Search>;
  readonly matches = new Map<string, V2Match>();
  /** Accounts in a v2 match on this instance (or being set up: value undefined). */
  private readonly playing = new Map<string, V2Match | undefined>();
  private readonly watchers = new Map<string, Set<(msg: V2ServerMessage) => void>>();
  private readonly running = new Set<Promise<void>>();
  /** Crews readied in private lobbies on this instance: lobby id → account id → the crew. */
  private readonly lobbyWaits = new Map<string, Map<string, LobbyWait>>();
  /** The lobby each waiting account readied in. */
  private readonly waitingIn = new Map<string, string>();
  /** Matches started from a lobby: settled when they end. */
  private readonly lobbyMatches = new Set<string>();
  /** Campaign matches: match id → the player and the mission, recorded when they end. */
  private readonly campaignMatches = new Map<string, { accountId: string; missionId: string }>();
  private closing = false;

  constructor(private readonly deps: V2HubDeps) {
    this.matchmaker = new Matchmaker<V2Search>(deps.queueTiming, deps.scheduler, {
      status: (e, searchingMs, range) => this.deps.send(e.key, { type: 'queue_status', searchingMs, eloRange: range }),
      pair: (a, b) => this.track(this.start(a, b)),
      pools: v2PoolsMatch,
    });
    this.matchmaker.start();
  }

  isBusy(accountId: string): boolean {
    return this.matchmaker.has(accountId) || this.playing.has(accountId) || this.waitingIn.has(accountId);
  }

  /** Throws when the account is already searching, waiting in a lobby or playing. */
  private free(accountId: string): void {
    if (this.matchmaker.has(accountId)) throw new V2HubError('already_queued', 'already searching for a match');
    if (this.waitingIn.has(accountId)) throw new V2HubError('already_queued', 'already waiting in a lobby');
    if (this.playing.has(accountId)) throw new V2HubError('in_match', 'already in a match');
  }

  /** Ranked ignores `opts` (any fitting map, at RANKED_DIFFICULTY) and refuses draft mode. */
  async queue(user: { accountId: string; handle: string }, crew: V2CrewEntry[], ranked: boolean, opts: V2QueueOptions = {}): Promise<void> {
    if (this.closing) throw new V2HubError('unavailable', 'server is shutting down');
    if (ranked && opts.draft) throw new V2HubError('draft_casual', 'draft mode is casual only');
    const check = () => this.free(user.accountId);
    check();
    const mapId = ranked ? undefined : opts.mapId;
    const difficulty = ranked ? RANKED_DIFFICULTY : (opts.difficulty ?? RANKED_DIFFICULTY);
    if (mapId !== undefined) {
      const map = await this.mapFor(mapId);
      if (!map) throw new V2HubError('invalid_crew', 'no such map');
      if (crew.length > crewLimitOf(map)) throw new V2HubError('invalid_crew', `${map.name} takes at most ${crewLimitOf(map)} agents`);
    }
    await this.ownCrew(user.accountId, crew);
    if (ranked) await this.noExternal(user.accountId, crew);
    if (!this.fitting(crew.length).length) throw new V2HubError('invalid_crew', 'no map takes a crew this size');
    const account = await this.deps.repos.accounts.get(user.accountId);
    check();
    const payload: V2Search = {
      ...user,
      crew,
      ranked,
      difficulty,
      ...(mapId !== undefined ? { mapId } : {}),
      ...(opts.draft ? { draft: true } : {}),
      ...(account ? { rank: { elo: account.elo, rankedMatches: account.rankedMatches } } : {}),
    };
    const pool = v2Pool(payload);
    this.matchmaker.add({ key: user.accountId, lane: lane(ranked), ...(pool ? { pool } : {}), rating: account?.elo ?? 1200, payload });
  }

  /**
   * Practice against the greedy bot: casual, no matchmaking, it starts at once on the picked map that
   * fits the crew (default DEFAULT_PRACTICE). The bot is a greedy-brain crew shaped by the difficulty
   * (practiceRival: size, talk tier, late start) that accepts and locks in by itself and never holds credits; the player plays free
   * on the greedy brain, at the normal rates with a model brain. No Elo, no registry job.
   */
  async practice(user: { accountId: string; handle: string }, crew: V2CrewEntry[], opts: V2QueueOptions = {}): Promise<void> {
    if (this.closing) throw new V2HubError('unavailable', 'server is shutting down');
    this.free(user.accountId);
    if (crew.length < 1 || crew.length > 3) throw new V2HubError('invalid_crew', 'a crew has 1 to 3 agents');
    const mission = opts.mission !== undefined ? campaignMission(opts.mission) : undefined;
    if (opts.mission !== undefined && !mission) throw new V2HubError('not_found', 'no such campaign mission');
    if (mission && crew.length > mission.crewSize) throw new V2HubError('invalid_crew', `this mission takes at most ${mission.crewSize} agents`);
    const map = await this.mapFor(mission?.mapId ?? opts.mapId ?? DEFAULT_PRACTICE.mapId);
    if (!map) throw new V2HubError('invalid_crew', 'no such map');
    if (crew.length > crewLimitOf(map)) throw new V2HubError('invalid_crew', `${map.name} takes at most ${crewLimitOf(map)} agents`);
    if (mission && !missionUnlocked(mission.id, await this.deps.repos.campaign.cleared(user.accountId)))
      throw new V2HubError('mission_locked', 'clear the missions before this one first');
    await this.ownCrew(user.accountId, crew);
    this.free(user.accountId);
    this.track(this.startPractice(user, crew, map, mission?.difficulty ?? opts.difficulty ?? DEFAULT_PRACTICE.difficulty, mission?.id));
  }

  /**
   * Every agent is the player's, or one they hold an unused rental pass for, and none plays another
   * live match (`matchId`: the one locking in). The pass is used up when the match ends.
   */
  private async ownCrew(accountId: string, crew: V2CrewEntry[], matchId?: string): Promise<void> {
    const { repos } = this.deps;
    if (new Set(crew.map((c) => c.agentId)).size !== crew.length) throw new V2HubError('invalid_crew', 'an agent is listed twice');
    const rows = await Promise.all(crew.map((c) => repos.agents.get(c.agentId)));
    if (rows.some((r) => !r)) throw new V2HubError('invalid_crew', 'every agent must be yours');
    const others = rows.filter((r) => r!.ownerId !== accountId).map((r) => r!.id);
    if (others.length) {
      const rented = await repos.rentals.rentable(accountId, others);
      if (others.some((id) => !rented.includes(id))) throw new V2HubError('invalid_crew', 'every agent must be yours or rented');
    }
    const busy = await repos.agents.busyAgents(crew.map((c) => c.agentId), matchId !== undefined ? { exceptMatch: matchId } : {});
    if (busy.length) throw new V2HubError('agent_busy', 'an agent is in a match that has not ended');
  }

  /** Ranked is for the built-in brain only: no agent of the crew may be played by an external agent. */
  private async noExternal(accountId: string, crew: V2CrewEntry[]): Promise<void> {
    const bound = await this.deps.repos.externalAgents.boundTo(accountId, crew.map((c) => c.agentId));
    if (bound.length) throw new V2HubError('external_unranked', 'an agent played by an external agent plays casual and practice only');
  }

  /**
   * Readies a crew in a private lobby the player is in. Once both players have, the match starts.
   * Readying again replaces the crew. The crew must fit the lobby: its crew size (and the map's),
   * and every agent plays the lobby's talk tier when it forces one.
   */
  async lobbyReady(user: { accountId: string; handle: string }, lobbyId: string, crew: V2CrewEntry[]): Promise<void> {
    if (this.closing) throw new V2HubError('unavailable', 'server is shutting down');
    const { repos } = this.deps;
    if (this.waitingIn.get(user.accountId) === lobbyId) this.unready(user.accountId, false);
    this.free(user.accountId);
    const lobby = await repos.lobbies.get(lobbyId);
    if (!lobby || (lobby.hostId !== user.accountId && lobby.guestId !== user.accountId)) throw new V2HubError('not_found', 'lobby not found');
    if (lobby.status !== 'open') throw new V2HubError('lobby_closed', 'this lobby is not open');
    if (!lobby.guestId) throw new V2HubError('lobby_closed', 'the lobby is waiting for a guest');
    const map = this.pool().find((m) => m.id === lobby.mapId);
    if (!map) throw new V2HubError('invalid_crew', 'no such map');
    const limit = Math.min(crewLimitOf(map), lobby.crewSize);
    if (crew.length > limit) throw new V2HubError('invalid_crew', `this lobby takes at most ${limit} agents`);
    const forced = isLobbyTalkRule(lobby.talk) ? forcedTier(lobby.talk) : null;
    const entries = forced ? crew.map((c) => ({ ...c, tier: forced })) : crew;
    await this.ownCrew(user.accountId, entries);
    this.free(user.accountId);
    let waits = this.lobbyWaits.get(lobbyId);
    if (!waits) this.lobbyWaits.set(lobbyId, (waits = new Map()));
    waits.set(user.accountId, { user, crew: entries });
    this.waitingIn.set(user.accountId, lobbyId);
    const host = waits.get(lobby.hostId);
    const guest = waits.get(lobby.guestId);
    if (host && guest) {
      this.lobbyWaits.delete(lobbyId);
      this.waitingIn.delete(lobby.hostId);
      this.waitingIn.delete(lobby.guestId);
      this.lobbyStatus(lobby, { host: true, guest: true });
      this.track(this.startLobby(lobby, host, guest));
      return;
    }
    this.lobbyStatus(lobby);
    await repos.lobbies.setReady(lobbyId, user.accountId, true).catch((err: unknown) => this.deps.log.warn(`lobby ${lobbyId}: ready not stored: ${(err as Error).message}`));
  }

  /** Steps out of a lobby wait (cancel, disconnect). Returns whether there was one. */
  private unready(accountId: string, store = true): boolean {
    const lobbyId = this.waitingIn.get(accountId);
    if (lobbyId === undefined) return false;
    this.waitingIn.delete(accountId);
    const waits = this.lobbyWaits.get(lobbyId);
    waits?.delete(accountId);
    if (waits && !waits.size) this.lobbyWaits.delete(lobbyId);
    if (!store) return true;
    const { repos, log } = this.deps;
    this.track(
      repos.lobbies
        .setReady(lobbyId, accountId, false)
        .then(() => repos.lobbies.get(lobbyId))
        .then((l) => void (l && this.lobbyStatus(l)))
        .catch((err: unknown) => log.warn(`lobby ${lobbyId}: unready not stored: ${(err as Error).message}`)),
    );
    return true;
  }

  /** Tells both players who has a crew readied (as this instance knows it). */
  private lobbyStatus(lobby: LobbyRow, ready?: { host: boolean; guest: boolean }): void {
    const waits = this.lobbyWaits.get(lobby.id);
    const r = ready ?? { host: !!waits?.has(lobby.hostId), guest: !!(lobby.guestId && waits?.has(lobby.guestId)) };
    for (const a of [lobby.hostId, lobby.guestId]) if (a) this.deps.send(a, { type: 'v2_lobby', lobbyId: lobby.id, ready: r });
  }

  cancel(accountId: string): void {
    if (this.matchmaker.remove(accountId)) return;
    if (this.unready(accountId)) return;
    if (this.playing.has(accountId)) throw new V2HubError('in_match', 'the match is already found');
    throw new V2HubError('not_queued', 'not searching for a match');
  }

  /** Drops a search when its player has no connection left (a found match plays on). */
  dropSearch(accountId: string): void {
    this.matchmaker.remove(accountId);
    this.unready(accountId);
  }

  private mine(accountId: string, matchId: string): { match: V2Match; team: Team } {
    const match = this.matches.get(matchId);
    const team = match && TEAMS.find((t) => match.setup.sides[t].accountId === accountId);
    if (!match || !team) throw new V2HubError('not_found', 'match not found');
    return { match, team };
  }

  accept(accountId: string, matchId: string): void {
    const { match, team } = this.mine(accountId, matchId);
    match.accept(team);
  }

  decline(accountId: string, matchId: string): void {
    const { match, team } = this.mine(accountId, matchId);
    match.decline(team);
  }

  /** Draft mode: the player's ban (or pass, `skillId` null) on their crew's step. */
  ban(accountId: string, matchId: string, skillId: string | null): void {
    const { match, team } = this.mine(accountId, matchId);
    const r = match.ban(team, skillId);
    if (!r.ok) throw new V2HubError(r.code, r.message);
  }

  /**
   * Locks a crew in. `crew` swaps, removes or adds agents (up to the map's crew limit) and its tiers
   * win over `tiers`; the new roster is loaded (skills decrypted) before the lock lands.
   */
  async lockIn(accountId: string, matchId: string, tiers: V2CrewEntry['tier'][], crew?: V2CrewEntry[], playbookId?: string | null): Promise<void> {
    const { match, team } = this.mine(accountId, matchId);
    // The crew playbook for this match: absent keeps the one selected when the match was made, null plays none.
    const playbook = playbookId === undefined ? undefined : playbookId === null ? null : await this.playbook(accountId, playbookId);
    if (playbook === undefined && playbookId) throw new V2HubError('not_found', 'playbook not found');
    if (!crew) {
      match.lockIn(team, tiers, undefined, playbook);
      return;
    }
    // A crew change that misses the lock says so: the client must not show a crew that won't play.
    const missed = () => new V2HubError('not_in_lockin', 'lock-in is over; the crew you queued with plays');
    if (match.phase !== 'lockin') throw missed();
    if (crew.length < 1 || crew.length > match.crewLimit) throw new V2HubError('invalid_crew', `this map takes 1 to ${match.crewLimit} agents`);
    await this.ownCrew(accountId, crew, matchId);
    if (match.setup.ranked) await this.noExternal(accountId, crew);
    const roster = await this.roster(accountId, crew, { matchId, ranked: match.setup.ranked });
    if (!match.lockIn(team, tiers, roster, playbook)) throw missed();
    this.deps.log.info(`v2 match ${matchId} ${team}: crew changed at lock-in (${roster.crew.length} agents)`);
  }

  /**
   * A live command to the player's own crew in a match on this instance (V2Match.command): applied
   * on the next tick, seen by that crew only. Throws the reason it was refused.
   */
  command(accountId: string, matchId: string, input: V2CommandInput): { tick: number; left: number } {
    const { match, team } = this.mine(accountId, matchId);
    const r = match.command(team, input);
    if (!r.ok) throw new V2HubError(r.code, r.message);
    this.deps.log.info(`v2 match ${matchId} ${team}: command ${input.preset ?? 'text'}${input.agentId ? ` to ${input.agentId}` : ' to the crew'} (${r.left} left)`);
    return { tick: r.tick, left: r.left };
  }

  /**
   * Every stored frame of an ended match, through the asker's own view (its crew's fog and plans);
   * anyone who did not play it gets the whole board. A live match is never replayed.
   */
  async replay(accountId: string | null, matchId: string): Promise<V2Frame[]> {
    if (this.matches.has(matchId)) throw new V2HubError('not_found', 'the match has not ended');
    const row = await this.deps.repos.v2Matches.get(matchId);
    if (!row || row.status === 'live') throw new V2HubError('not_found', 'match not found');
    const view: FrameView = accountId === row.teamAAccountId ? 'A' : accountId === row.teamBAccountId ? 'B' : 'watch';
    const frames = await this.deps.frames?.get(matchId, view);
    if (!frames) throw new V2HubError('not_found', 'no frames are kept for this match');
    return frames;
  }

  /**
   * Spectating: the latest whole-board frame now, then every one after, and v2_end. A match on this
   * instance is watched directly; one elsewhere through its `v2match:<id>` channel (never both, so
   * no frame arrives twice). An ended or void match answers at once with a v2_end from its row.
   */
  async watch(matchId: string, fn: (msg: V2ServerMessage) => void): Promise<Unsubscribe> {
    if (this.matches.has(matchId)) return this.watchLocal(matchId, fn);
    const row = await this.deps.repos.v2Matches.get(matchId);
    if (this.matches.has(matchId)) return this.watchLocal(matchId, fn);
    if (!row) throw new V2HubError('not_found', 'match not found');
    if (row.status !== 'live') {
      fn(v2EndOf(row));
      return async () => undefined;
    }
    return this.watchRemote(matchId, fn);
  }

  private watchLocal(matchId: string, fn: (msg: V2ServerMessage) => void): Unsubscribe {
    const match = this.matches.get(matchId)!;
    let set = this.watchers.get(matchId);
    if (!set) this.watchers.set(matchId, (set = new Set()));
    set.add(fn);
    if (match.lastFrames.watch) fn(match.lastFrames.watch);
    return async () => void set.delete(fn);
  }

  /**
   * A match another instance runs. Subscribe first, then read the last message, so nothing published
   * in between is lost; frames at or before a tick already sent are dropped, and the watch lets go of
   * the channel by itself after v2_end.
   */
  private async watchRemote(matchId: string, fn: (msg: V2ServerMessage) => void): Promise<Unsubscribe> {
    const { pubsub, log } = this.deps;
    let lastTick = -1;
    let ended = false;
    let buffer: string[] | null = [];
    let unsub: Unsubscribe | undefined;
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      await unsub?.();
    };
    const deliver = (raw: string) => {
      if (ended) return;
      const msg = relayV2Watch(matchId, raw);
      if (!msg) return;
      if (msg.type === 'v2_frame') {
        if (msg.frame.tick <= lastTick) return;
        lastTick = msg.frame.tick;
      } else ended = true;
      fn(msg);
      if (ended) void release();
    };
    unsub = await pubsub.subscribe(v2MatchChannel(matchId), (raw) => {
      if (buffer) buffer.push(raw);
      else deliver(raw);
    });
    try {
      const raw = await pubsub.get(v2MatchLastKey(matchId));
      if (raw) deliver(raw);
    } catch (err) {
      log.warn(`v2 match ${matchId}: last frame unreadable: ${(err as Error).message}`);
    } finally {
      const pending = buffer ?? [];
      buffer = null;
      for (const raw of pending) deliver(raw);
    }
    return release;
  }

  /** On reconnect: where the player's match stands (found, lock-in or the latest frame). */
  resume(accountId: string, send: (msg: V2ServerMessage) => void): void {
    const match = this.playing.get(accountId);
    if (!match || match.phase === 'ended') return;
    const team = TEAMS.find((t) => match.setup.sides[t].accountId === accountId)!;
    if (match.phase === 'found') send(match.foundMessage(team));
    else if (match.phase === 'draft') {
      send(match.foundMessage(team));
      send(match.draftMessage(team));
    }
    else if (match.phase === 'lockin') send(match.lockinMessage(team));
    else {
      const frame = match.lastFrames[team];
      if (frame) send(frame);
    }
  }

  private pool(): readonly MapDefV2[] {
    return this.deps.maps ?? MAPS_V2;
  }

  /**
   * A map by id: one of the pool, or a published community map (practice and casual only; ranked
   * never names a map). A stored community map that no longer parses is treated as missing.
   */
  private async mapFor(id: string): Promise<MapDefV2 | undefined> {
    const own = this.pool().find((m) => m.id === id);
    if (own || !isCommunityMapId(id)) return own;
    const row = await this.deps.repos.communityMaps.published(id);
    if (!row) return undefined;
    const check = validateCommunityMap(row.map);
    return check.ok ? check.map.def : undefined;
  }

  /** Counts a match started on a community map (best effort: the match goes on regardless). */
  private countPlay(map: MapDefV2): void {
    if (!isCommunityMapId(map.id)) return;
    this.deps.repos.communityMaps.played(map.id).catch((err: Error) => this.deps.log.warn(`community map ${map.id}: play not counted: ${err.message}`));
  }

  private fitting(size: number): MapDefV2[] {
    return this.pool().filter((m) => crewLimitOf(m) >= size);
  }

  private track(p: Promise<void>) {
    this.running.add(p);
    void p.finally(() => this.running.delete(p));
  }

  private async side(s: Pick<V2Search, 'accountId' | 'handle' | 'crew' | 'rank'>, match: RosterMatch): Promise<V2Side> {
    const selected = await this.deps.repos.playbooks.selected(s.accountId);
    // A playbook that cannot be opened never holds up a match: the crew plays without one.
    const playbook = selected
      ? await this.playbook(s.accountId, selected.id).catch((err: unknown) => {
          this.deps.log.warn(`v2: ${s.accountId} plays without playbook ${selected.id}: ${(err as Error).message}`);
          return undefined;
        })
      : undefined;
    return { accountId: s.accountId, handle: s.handle, ...(s.rank ? { rank: s.rank } : {}), ...(await this.roster(s.accountId, s.crew, match)), ...(playbook ? { playbook } : {}) };
  }

  /**
   * One of the player's own crew playbooks, decrypted for the planner (undefined when it is not theirs,
   * or this hub cannot open playbooks). Only the match runner reads the text; frames carry the name alone.
   */
  private async playbook(accountId: string, id: string): Promise<V2Playbook | undefined> {
    const { repos, vault } = this.deps;
    if (!vault.decryptPlaybook) return undefined;
    const [view, sealed] = await Promise.all([repos.playbooks.get(accountId, id), repos.playbooks.loadSealed(accountId, id)]);
    if (!view || !sealed) return undefined;
    return { id: view.id, name: view.name, text: await vault.decryptPlaybook(sealed) };
  }

  /**
   * The crew's agents as they stand now, their decrypted skills, and which run a bought skill. Only
   * skills the agent's player owns are decrypted: one still equipped after it was sold is skipped. A
   * rented agent plays with its owner's skills, and counts as bought: its plans are withheld from
   * the renter, who never reads another player's strategy.
   */
  private async roster(accountId: string, entries: V2CrewEntry[], match: RosterMatch): Promise<V2Roster> {
    const { repos, vault, log } = this.deps;
    const crew: AgentSpec[] = [];
    const skills: string[][] = [];
    const skillKeys: { id: string; version: number }[][] = [];
    const skillMeta: V2SkillMeta[][] = [];
    const skillNames: string[][] = [];
    const bought: boolean[] = [];
    const instructions: (string | null)[] = [];
    for (const c of entries) {
      const v = await repos.agents.view(c.agentId);
      if (!v) throw new V2HubError('invalid_crew', 'an agent no longer exists');
      // Progression traits travel with the agent (a rented one plays its owner's); ranked drops them in the engine.
      const traits = v.progression?.traits ?? [];
      crew.push({ id: v.id, name: v.name, role: v.role, vision: v.vision, comms: v.comms, tier: c.tier, ...(traits.length ? { traits } : {}) });
      const prompts: string[] = [];
      const keys: { id: string; version: number }[] = [];
      const names: string[] = [];
      // A rented agent (ownCrew checked the pass) plays with the skills its owner holds.
      const ownerId = (await repos.agents.get(c.agentId))?.ownerId ?? accountId;
      const rented = ownerId !== accountId;
      const holder = ownerId;
      // Role slots: the API refuses a skill for another role, so one here is stale; it sits out.
      const roles = new Map((v.skills.length ? await repos.skills.getMany(v.skills) : []).map((m) => [`${m.id}:${m.version}`, m.roles]));
      for (const k of v.skills) {
        if (!(await repos.skills.owns(holder, k.id, k.version))) {
          log.warn(`v2: agent ${v.id} plays without skill ${k.id} v${k.version}: its player does not own it`);
          continue;
        }
        if (!skillFitsRole(roles.get(`${k.id}:${k.version}`), v.role)) {
          log.warn(`v2: agent ${v.id} plays without skill ${k.id} v${k.version}: it is not for a ${v.role}`);
          continue;
        }
        const sealed = await repos.skills.loadSealed(k.id, k.version);
        if (!sealed) continue;
        prompts.push((await vault.decryptSkill(sealed)).prompt);
        keys.push({ id: k.id, version: k.version });
        names.push(k.name);
      }
      skills.push(prompts);
      skillKeys.push(keys);
      skillNames.push(names);
      const meta = keys.length ? await repos.skills.getMany(keys) : [];
      // Public name and trigger per skill, in prompt order (a version missing here plays always).
      skillMeta.push(
        keys.map((k) => {
          const m = meta.find((x) => x.id === k.id && x.version === k.version);
          return { name: m?.name ?? 'Skill', trigger: m?.trigger ?? null };
        }),
      );
      bought.push(rented || meta.some((m) => m.creatorId !== accountId));
      instructions.push(v.systemPrompt ?? null);
    }
    const brains = await this.externalBrains(accountId, crew, bought, match);
    return { crew, skills, skillKeys, skillNames, skillMeta, bought, instructions, ...(brains ? { brains } : {}) };
  }

  /**
   * The brains of the agents their player's own program plays (bring your own agent), per slot, or
   * undefined when none does. Never in ranked: a binding made after a ranked search started is
   * ignored there and the agent plays the built-in brain.
   */
  private async externalBrains(accountId: string, crew: AgentSpec[], bought: boolean[], match: RosterMatch): Promise<(V2Brain | null)[] | undefined> {
    if (match.ranked) return undefined;
    const { repos, vault, log } = this.deps;
    const rows = await repos.externalAgents.boundTo(accountId, crew.map((a) => a.id));
    if (!rows.length) return undefined;
    const t = { ...DEFAULT_V2_TIMING, ...this.deps.timing };
    // Its answer must be back before the match's own action deadline gives up on the tick.
    const timeoutMs = Math.max(50, Math.min(DEFAULTS.external.timeoutMs, t.actionMs - 100));
    const hidePlan = bought.some(Boolean);
    const brains: (V2Brain | null)[] = [];
    for (const a of crew) {
      const row = rows.find((r) => r.agentId === a.id);
      if (!row) {
        brains.push(null);
        continue;
      }
      const secret = (await vault.decryptSkill(sealedSecretOf(row))).prompt;
      brains.push(
        new ExternalBrain({
          agent: { id: row.id, webhookUrl: row.webhookUrl },
          secret,
          matchId: match.matchId,
          timeoutMs,
          ...(this.deps.externalTurns ? { turns: this.deps.externalTurns } : {}),
          ...(this.deps.externalPost ? { post: this.deps.externalPost } : {}),
          scheduler: this.deps.scheduler,
          log,
          hidePlan,
        }),
      );
      log.info(`v2 match ${match.matchId}: agent ${a.id} is played by external agent ${row.id} (${row.webhookUrl ? 'webhook' : 'pull'})`);
    }
    return brains;
  }

  /** A V2Match wired to this hub: its credits on the ledger, its watchers, and finish(). */
  private newMatch(setup: V2Setup, brains: Record<Team, V2Brain>, send: V2MatchDeps['send']): V2Match {
    const { repos, log } = this.deps;
    const match: V2Match = new V2Match(setup, {
      brains,
      scheduler: this.deps.scheduler,
      ...(this.deps.timing ? { timing: this.deps.timing } : {}),
      credits: new LedgerV2Credits(repos.ledger, setup.matchId, log),
      send,
      watch: (msg) => {
        for (const fn of this.watchers.get(setup.matchId) ?? []) fn(msg);
        this.relay(setup.matchId, msg);
      },
      finish: (end) => this.finish(end, match),
      log,
    });
    return match;
  }

  /**
   * Hands a watch-view message to the other instances: the latest one is kept (a watcher arriving now
   * reads it first), then it is published. Both go out on one connection in this order, so a watcher
   * that subscribed too late for the publish still reads it from the key.
   */
  private relay(matchId: string, msg: V2ServerMessage): void {
    const { pubsub, log } = this.deps;
    const payload = JSON.stringify(msg);
    const failed = (err: unknown) => log.warn(`v2 match ${matchId}: relay failed: ${(err as Error).message}`);
    pubsub.set(v2MatchLastKey(matchId), payload, V2_MATCH_LAST_TTL_S).catch(failed);
    pubsub.publish(v2MatchChannel(matchId), payload).catch(failed);
  }

  private async start(a: QueueEntry<V2Search>, b: QueueEntry<V2Search>): Promise<void> {
    const matchId = newId('mat');
    await this.launch(matchId, [a.key, b.key], async () => {
      const at = { matchId, ranked: a.payload.ranked };
      const sides = { A: await this.side(a.payload, at), B: await this.side(b.payload, at) };
      const size = Math.max(sides.A.crew.length, sides.B.crew.length);
      const fits = this.fitting(size);
      // A casual pair picked the same map (an official or a community one), or one of them takes any map (v2PoolsMatch).
      const pickedId = a.payload.mapId ?? b.payload.mapId;
      const pickedMap = pickedId !== undefined ? await this.mapFor(pickedId) : undefined;
      const picked = pickedMap && crewLimitOf(pickedMap) >= size ? pickedMap : undefined;
      if (pickedId !== undefined && !picked) throw new V2HubError('invalid_crew', 'the picked map does not take both crews');
      const map = picked ?? (this.deps.pickMap ?? ((f) => f[Math.floor(Math.random() * f.length)]!))(fits);
      const ranked = a.payload.ranked;
      const difficulty = ranked ? RANKED_DIFFICULTY : a.payload.difficulty;
      // Draft searches pair only with draft searches (v2PoolsMatch).
      const draft = !ranked && !!a.payload.draft;
      await this.deps.repos.v2Matches.create({ id: matchId, mapId: map.id, ranked, teamA: a.key, teamB: b.key, crews: { A: crewRecords(sides.A), B: crewRecords(sides.B) }, ...(ranked ? {} : { difficulty }) });
      this.countPlay(map);
      return this.newMatch({ matchId, map, ranked, difficulty, sides, ...(draft ? { draft } : {}) }, { A: this.deps.brain, B: this.deps.brain }, (t, msg) => this.deps.send(sides[t].accountId, msg));
    });
  }

  /** A private lobby's match: the host is crew A, casual on the lobby's map, difficulty and rules. */
  private async startLobby(lobby: LobbyRow, host: LobbyWait, guest: LobbyWait): Promise<void> {
    const matchId = newId('mat');
    const { repos } = this.deps;
    await this.launch(matchId, [host.user.accountId, guest.user.accountId], async () => {
      const map = this.pool().find((m) => m.id === lobby.mapId);
      if (!map) throw new V2HubError('invalid_crew', 'no such map');
      const at = { matchId, ranked: false };
      const sides = { A: await this.side({ ...host.user, crew: host.crew }, at), B: await this.side({ ...guest.user, crew: guest.crew }, at) };
      const difficulty = isDifficulty(lobby.difficulty) ? lobby.difficulty : RANKED_DIFFICULTY;
      await repos.v2Matches.create({ id: matchId, mapId: map.id, ranked: false, teamA: host.user.accountId, teamB: guest.user.accountId, crews: { A: crewRecords(sides.A), B: crewRecords(sides.B) }, difficulty });
      if (!(await repos.lobbies.begin(lobby.id, matchId))) {
        await repos.v2Matches.finish(matchId, { winner: null, reason: 'aborted' }).catch(() => undefined);
        throw new V2HubError('lobby_closed', 'the lobby changed before the match could start');
      }
      this.lobbyMatches.add(matchId);
      const forced = isLobbyTalkRule(lobby.talk) ? forcedTier(lobby.talk) : null;
      const setup: V2Setup = { matchId, map, ranked: false, difficulty, sides, crewMax: lobby.crewSize, ...(forced ? { talk: forced } : {}) };
      return this.newMatch(setup, { A: this.deps.brain, B: this.deps.brain }, (t, msg) => this.deps.send(sides[t].accountId, msg));
    });
  }

  /** The player is crew A; the bot (crew B) answers its own v2_found and v2_lockin. */
  private async startPractice(user: { accountId: string; handle: string }, entries: V2CrewEntry[], map: MapDefV2, difficulty: Difficulty, missionId?: string): Promise<void> {
    const matchId = newId('mat');
    await this.launch(matchId, [user.accountId], async () => {
      // The difficulty shapes the bot: crew size, talk tier, a late start and its bluff cap (practiceRival).
      const rival = practiceRival(difficulty, entries.length as 1 | 2 | 3, crewLimitOf(map));
      const botAgents = botCrew(rival.size, `bot_${matchId}`, rival.tier);
      const bot: V2Side = { accountId: SYSTEM_ACCOUNT_ID, handle: BOT_HANDLE, crew: botAgents, skills: botAgents.map(() => []) };
      const sides = { A: await this.side({ ...user, crew: entries }, { matchId, ranked: false }), B: bot };
      // The greedy brain makes no model calls, so a player on it plays free; the bot always does.
      const free: V2Setup['free'] = this.deps.brain.kind === 'greedy' ? { A: true, B: true } : { B: true };
      await this.deps.repos.v2Matches.create({ id: matchId, mapId: map.id, ranked: false, practice: true, teamA: user.accountId, teamB: SYSTEM_ACCOUNT_ID, crews: { A: crewRecords(sides.A), B: crewRecords(bot) }, difficulty });
      this.countPlay(map);
      const hold = rival.hold ? { B: rival.hold } : undefined;
      if (missionId !== undefined) this.campaignMatches.set(matchId, { accountId: user.accountId, missionId });
      const match = this.newMatch({ matchId, map, ranked: false, difficulty, sides, practice: true, free, lieCap: { B: rival.lieCap }, ...(hold ? { hold } : {}) }, { A: this.deps.brain, B: createGreedyBrain() }, (t, msg) => {
        if (t === 'A') return this.deps.send(user.accountId, msg);
        if (msg.type === 'v2_found') queueMicrotask(() => match.accept('B'));
        else if (msg.type === 'v2_lockin') queueMicrotask(() => match.lockIn('B', bot.crew.map(() => rival.tier)));
      });
      return match;
    });
  }

  /**
   * Holds the accounts in `keys` while `prepare` loads the crews and writes the row, then plays the
   * match. A failed setup frees them again and tells them why.
   */
  private async launch(matchId: string, keys: string[], prepare: () => Promise<V2Match>): Promise<void> {
    const { log } = this.deps;
    for (const k of keys) this.playing.set(k, undefined);
    const release = (m?: V2Match) => {
      for (const k of keys) if (this.playing.get(k) === m) this.playing.delete(k);
    };
    let match: V2Match;
    try {
      if (this.closing) throw new V2HubError('unavailable', 'server is shutting down');
      match = await prepare();
    } catch (err) {
      release(undefined);
      const msg = err instanceof V2HubError ? err.message : 'could not start the match';
      if (!(err instanceof V2HubError)) log.error(`v2 match setup failed: ${(err as Error).stack ?? String(err)}`);
      for (const k of keys) this.deps.send(k, { type: 'error', code: err instanceof V2HubError ? err.code : 'internal', message: msg });
      return;
    }
    this.matches.set(matchId, match);
    for (const k of keys) this.playing.set(k, match);
    const { setup } = match;
    const mode = setup.ranked ? 'ranked' : `${setup.practice ? 'practice' : setup.draft ? 'draft' : 'casual'}, ${match.difficulty}`;
    log.info(`v2 match ${matchId} on ${setup.map.id} (${mode}): ${setup.sides.A.handle} vs ${setup.sides.B.handle}`);
    try {
      const end = await match.play();
      log.info(`v2 match ${matchId} ended: ${end.result?.winner ?? 'void'} (${end.reason})`);
    } finally {
      this.matches.delete(matchId);
      this.watchers.delete(matchId);
      release(match);
    }
  }

  /**
   * Before v2_end goes out: the result and Elo are written, a ranked result is queued for the
   * registry, and the frames are stored for replay. A failed step is logged and the rest still run.
   */
  private async finish(end: V2MatchEnd, match: V2Match): Promise<V2Finish> {
    const { log } = this.deps;
    const out: V2Finish = { eloDelta: {}, registry: null };
    const row = await this.record(end, match).catch((err: unknown) => {
      log.error(`v2 match ${end.matchId}: record failed: ${(err as Error).message}`);
      return null;
    });
    if (row) for (const d of row.eloDeltas ?? []) out.eloDelta[d.team] = d.delta;
    // The decision timelines, before v2_end goes out, so the debrief can ask for them at once.
    if (row?.status === 'ended')
      await this.deps.repos.matchTimelines
        .put(end.matchId, match.timelines())
        .catch((err: unknown) => log.warn(`v2 match ${end.matchId}: decision timeline not kept: ${(err as Error).message}`));
    // The season points finish stored in each crew's debrief (ranked only).
    for (const t of TEAMS) {
      const season = row?.debriefs?.[t]?.season;
      if (season) (out.season ??= {})[t] = season;
      const xp = row?.debriefs?.[t]?.xp;
      if (xp?.length) (out.xp ??= {})[t] = xp;
    }
    if (row?.registryStatus === 'pending') {
      out.registry = 'pending';
      await this.deps.registry
        ?.enqueue({ kind: 'v2_match', id: end.matchId })
        .catch((err: unknown) => log.warn(`v2 match ${end.matchId}: registry enqueue failed: ${(err as Error).message}`));
    }
    // A lobby's match moves its lobby on (a rematch, or the next bracket round); the worker settles
    // any lobby left unsettled.
    const campaign = this.campaignMatches.get(end.matchId);
    if (campaign) {
      this.campaignMatches.delete(end.matchId);
      if (end.result) await this.recordCampaign(end.matchId, campaign, end.result);
    }
    if (this.lobbyMatches.delete(end.matchId))
      await this.deps.repos.lobbies.settleMatch(end.matchId).catch((err: unknown) => log.warn(`v2 match ${end.matchId}: lobby not settled: ${(err as Error).message}`));
    // Frames are kept for replay in the background, so a slow store never holds up v2_end.
    if (this.deps.frames && match.framesOf('watch').length) {
      const views: FrameView[] = ['A', 'B', 'watch'];
      this.track(
        Promise.all(views.map((v) => this.deps.frames!.put(end.matchId, v, match.framesOf(v)))).then(
          () => undefined,
          (err: unknown) => log.warn(`v2 match ${end.matchId}: frames not kept: ${(err as Error).message}`),
        ),
      );
    }
    await this.recordExternal(end.matchId, match);
    return out;
  }

  /** A campaign match's result for its player; a cleared chapter grants its rewards (logged, never fatal). */
  private async recordCampaign(matchId: string, c: { accountId: string; missionId: string }, result: MatchResult): Promise<void> {
    const { repos, log } = this.deps;
    try {
      const r = await repos.campaign.record(c.accountId, c.missionId, matchId, { winner: result.winner, score: result.score, ticks: result.ticks });
      if (r.newlyCleared) log.info(`v2 match ${matchId}: campaign mission ${c.missionId} cleared${r.granted.length ? `, rewards of ${r.granted.join(', ')} granted` : ''}`);
    } catch (err) {
      log.warn(`v2 match ${matchId}: campaign result not kept: ${(err as Error).message}`);
    }
  }

  /** Each external agent's calls and misses in this match, added to its counters. */
  private async recordExternal(matchId: string, match: V2Match): Promise<void> {
    const { repos, log } = this.deps;
    for (const t of TEAMS)
      for (const b of match.setup.sides[t].brains ?? []) {
        if (!isExternalBrain(b)) continue;
        const u = b.usage;
        if (u.calls) log.info(`v2 match ${matchId}: external agent ${b.id} answered ${u.calls - u.misses} of ${u.calls} ticks`);
        await repos.externalAgents.recordUsage(b.id, u).catch((err: unknown) => log.warn(`v2 match ${matchId}: external agent usage not kept: ${(err as Error).message}`));
      }
  }

  private async record(end: V2MatchEnd, match: V2Match) {
    const r = end.result;
    const { sides } = match.setup;
    // The crews as they played (lock-in changes included), even for a void with no log, with the
    // skill versions each agent ran (kept out of the hashed log header).
    const played = (t: Team) => end.log!.header.crews[t].map((a) => ({ ...a, skills: skillsOf(sides[t], a.id), ...externalOf(sides[t], a.id) }));
    const crews = end.log ? { A: played('A'), B: played('B') } : { A: crewRecords(sides.A), B: crewRecords(sides.B) };
    return this.deps.repos.v2Matches.finish(end.matchId, {
      winner: r?.winner ?? null,
      reason: end.reason,
      decidedBy: r?.decidedBy ?? null,
      fault: end.fault ?? null,
      score: r ? r.score : null,
      ticks: r?.ticks ?? null,
      crews,
      stats: end.stats,
      log: end.log,
      logHash: r && end.log ? end.log.hashes[end.log.hashes.length - 1]! : null,
      // Elo and the registry line are filled in by the repo from the row it writes.
      debriefs: r ? { A: match.debrief('A', end, { eloDelta: {}, registry: null }), B: match.debrief('B', end, { eloDelta: {}, registry: null }) } : null,
      messages: end.messages,
    });
  }

  /** Voids every live match (credits returned) and stops matchmaking. */
  async close(): Promise<void> {
    this.closing = true;
    this.matchmaker.stop();
    this.matchmaker.clear();
    for (const a of [...this.waitingIn.keys()]) this.unready(a);
    for (const m of this.matches.values()) m.abort('shutdown');
    await Promise.all([...this.running]);
  }

  /** Live `v2_matches` rows no instance holds (a crashed instance) are voided and their holds released. */
  async sweepOrphans(olderThanMs: number): Promise<string[]> {
    const { repos } = this.deps;
    const cutoff = this.deps.scheduler.now() - olderThanMs;
    const voided: string[] = [];
    for (const m of await repos.v2Matches.listLive(500)) {
      if (this.matches.has(m.id) || m.createdAt.getTime() > cutoff) continue;
      const row = await repos.v2Matches.finish(m.id, { winner: null, reason: 'aborted' });
      if (row.status !== 'void') continue;
      for (const t of TEAMS) await repos.ledger.abort(v2HoldId(m.id, t)).catch(() => undefined);
      // Its instance is gone, so nobody else will end it for the watchers relaying its channel.
      this.relay(m.id, v2EndOf(row));
      voided.push(m.id);
    }
    return voided;
  }
}

/** A `v2match:<id>` message as a watcher gets it; anything else is dropped. */
export function relayV2Watch(matchId: string, payload: string): V2ServerMessage | undefined {
  let m: V2ServerMessage;
  try {
    m = JSON.parse(payload) as V2ServerMessage;
  } catch {
    return undefined;
  }
  if (m?.type === 'v2_frame' && m.frame && typeof m.frame.tick === 'number') return { type: 'v2_frame', matchId, frame: m.frame };
  if (m?.type === 'v2_end' && typeof m.reason === 'string') return { type: 'v2_end', matchId, result: m.result ?? null, reason: m.reason, logHash: m.logHash ?? null };
  return undefined;
}

/** The v2_end a watcher gets for a match that is already over, from its row. */
export function v2EndOf(row: V2MatchRow): Extract<V2ServerMessage, { type: 'v2_end' }> {
  const { winner, decidedBy, scoreA, scoreB, ticks } = row;
  const played = row.status === 'ended' && winner !== null && decidedBy !== null && scoreA !== null && scoreB !== null && ticks !== null;
  const result = played
    ? { winner: winner as MatchResult['winner'], reason: row.reason as MatchResult['reason'], decidedBy: decidedBy as MatchResult['decidedBy'], score: { A: scoreA, B: scoreB }, ticks }
    : null;
  return { type: 'v2_end', matchId: row.id, result, reason: (row.reason ?? 'aborted') as V2EndReason, logHash: row.logHash };
}

const rec = (a: AgentSpec) => ({ id: a.id, name: a.name, role: a.role, vision: a.vision, comms: a.comms, tier: a.tier, ...(a.traits?.length ? { traits: [...a.traits] } : {}) });

/** The skill versions an agent of this crew runs. */
const skillsOf = (side: V2Roster, agentId: string) => side.skillKeys?.[side.crew.findIndex((a) => a.id === agentId)] ?? [];

/** `{ external: true }` when its player's own program plays the agent (bring your own agent). */
const externalOf = (side: V2Roster, agentId: string): { external?: true } =>
  isExternalBrain(side.brains?.[side.crew.findIndex((a) => a.id === agentId)]) ? { external: true } : {};

/** A crew as v2_matches.crews records it. */
const crewRecords = (side: V2Roster): V2CrewRecord[] => side.crew.map((a) => ({ ...rec(a), skills: skillsOf(side, a.id), ...externalOf(side, a.id) }));
