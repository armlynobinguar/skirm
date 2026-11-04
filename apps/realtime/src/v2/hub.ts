// v2 matchmaking and the v2 matches this instance holds. The connection hub routes every v2_*
// message here. A search is one account with 1 to 3 of its agents (each with a talk tier), paired by
// player Elo within its mode (ranked or casual; a casual search also names its map and difficulty,
// and pairs only with the same pick); a pair becomes a V2Match on a map that fits both crews. The
// result is written to `v2_matches` (Elo moves in the same transaction), a ranked result is queued
// for the registry, and the frames are kept a while for replay. Practice skips matchmaking: the
// player meets the greedy bot (SYSTEM_ACCOUNT_ID) at once, casual, with no Elo and no registry job.
//
// Players are served only by the instance running their match (their sockets are routed to it).
// Watchers can be anywhere: the running instance publishes every watch-view message on
// `v2match:<id>` and keeps the latest in `v2match:<id>:last`, and watch() on any other instance
// relays that channel.
import { SYSTEM_ACCOUNT_ID, newId, sealedSecretOf, type Repos, type V2CrewRecord, type V2MatchRow } from '@skirm/db';
import { createGreedyBrain, type V2Brain } from '@skirm/decision-engine/v2';
import {
  BOT_HANDLE,
  DEFAULT_PRACTICE,
  MAPS_V2,
  RANKED_DIFFICULTY,
  botCrew,
  practiceRival,
  type AgentSpec,
  type Difficulty,
  type FrameView,
  type MapDefV2,
  type MatchResult,
  type Team,
  type V2Frame,
} from '@skirm/engine/v2';
import { V2_MATCH_LAST_TTL_S, v2MatchChannel, v2MatchLastKey, type ExternalTurnStore, type V2CrewEntry, type V2EndReason, type V2ServerMessage, type Vault } from '@skirm/server';
import { DEFAULTS } from '@skirm/shared';
import type { Logger, RegistryQueue } from '../deps';
import { Matchmaker, type Lane, type QueueEntry } from '../matchmaker';
import type { WsServerMessage } from '../protocol';
import type { PubSub, Unsubscribe } from '../pubsub';
import type { QueueTiming, Scheduler } from '../timing';
import { LedgerV2Credits, v2HoldId } from './credits';
import { ExternalBrain, isExternalBrain, type WebhookPost } from './external';
import { DEFAULT_V2_TIMING, TEAMS, V2Match, crewLimitOf, type V2CommandError, type V2CommandInput, type V2Finish, type V2MatchDeps, type V2MatchEnd, type V2Roster, type V2Setup, type V2Side, type V2Timing } from './match';
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
  /** The player's Elo and ranked matches as they queued (their tier on v2_found). */
  rank?: { elo: number; rankedMatches: number };
}

/** Casual pick: a map (or any) and a difficulty. */
export interface V2QueueOptions {
  mapId?: string;
  difficulty?: Difficulty;
}

/** The match a roster is loaded for (its external agents' turns name it; ranked has none). */
interface RosterMatch {
  matchId: string;
  ranked: boolean;
}

/** Casual searches pair within one difficulty, on one picked map (or any, '*'); ranked has a single pool. */
export const v2Pool = (s: Pick<V2Search, 'ranked' | 'mapId' | 'difficulty'>) => (s.ranked ? undefined : `${s.mapId ?? '*'}|${s.difficulty}`);

/** Two pools pair when they are equal, or at one difficulty when either search takes any map. */
export function v2PoolsMatch(a: string | undefined, b: string | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const [mapA, diffA] = a.split('|');
  const [mapB, diffB] = b.split('|');
  return diffA === diffB && (mapA === '*' || mapB === '*');
}

export interface V2HubDeps {
  repos: Repos;
  vault: Pick<Vault, 'decryptSkill'>;
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
    return this.matchmaker.has(accountId) || this.playing.has(accountId);
  }

  /** Throws when the account is already searching or playing. */
  private free(accountId: string): void {
    if (this.matchmaker.has(accountId)) throw new V2HubError('already_queued', 'already searching for a match');
    if (this.playing.has(accountId)) throw new V2HubError('in_match', 'already in a match');
  }

  /** Ranked ignores `opts`: any fitting map, at RANKED_DIFFICULTY. */
  async queue(user: { accountId: string; handle: string }, crew: V2CrewEntry[], ranked: boolean, opts: V2QueueOptions = {}): Promise<void> {
    if (this.closing) throw new V2HubError('unavailable', 'server is shutting down');
    const check = () => this.free(user.accountId);
    check();
    const mapId = ranked ? undefined : opts.mapId;
    const difficulty = ranked ? RANKED_DIFFICULTY : (opts.difficulty ?? RANKED_DIFFICULTY);
    if (mapId !== undefined) {
      const map = this.pool().find((m) => m.id === mapId);
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
    const map = this.pool().find((m) => m.id === (opts.mapId ?? DEFAULT_PRACTICE.mapId));
    if (!map) throw new V2HubError('invalid_crew', 'no such map');
    if (crew.length > crewLimitOf(map)) throw new V2HubError('invalid_crew', `${map.name} takes at most ${crewLimitOf(map)} agents`);
    await this.ownCrew(user.accountId, crew);
    this.free(user.accountId);
    this.track(this.startPractice(user, crew, map, opts.difficulty ?? DEFAULT_PRACTICE.difficulty));
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

  cancel(accountId: string): void {
    if (this.matchmaker.remove(accountId)) return;
    if (this.playing.has(accountId)) throw new V2HubError('in_match', 'the match is already found');
    throw new V2HubError('not_queued', 'not searching for a match');
  }

  /** Drops a search when its player has no connection left (a found match plays on). */
  dropSearch(accountId: string): void {
    this.matchmaker.remove(accountId);
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

  /**
   * Locks a crew in. `crew` swaps, removes or adds agents (up to the map's crew limit) and its tiers
   * win over `tiers`; the new roster is loaded (skills decrypted) before the lock lands.
   */
  async lockIn(accountId: string, matchId: string, tiers: V2CrewEntry['tier'][], crew?: V2CrewEntry[]): Promise<void> {
    const { match, team } = this.mine(accountId, matchId);
    if (!crew) {
      match.lockIn(team, tiers);
      return;
    }
    // A crew change that misses the lock says so: the client must not show a crew that won't play.
    const missed = () => new V2HubError('not_in_lockin', 'lock-in is over; the crew you queued with plays');
    if (match.phase !== 'lockin') throw missed();
    if (crew.length < 1 || crew.length > match.crewLimit) throw new V2HubError('invalid_crew', `this map takes 1 to ${match.crewLimit} agents`);
    await this.ownCrew(accountId, crew, matchId);
    if (match.setup.ranked) await this.noExternal(accountId, crew);
    const roster = await this.roster(accountId, crew, { matchId, ranked: match.setup.ranked });
    if (!match.lockIn(team, tiers, roster)) throw missed();
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
    else if (match.phase === 'lockin') send(match.lockinMessage(team));
    else {
      const frame = match.lastFrames[team];
      if (frame) send(frame);
    }
  }

  private pool(): readonly MapDefV2[] {
    return this.deps.maps ?? MAPS_V2;
  }

  private fitting(size: number): MapDefV2[] {
    return this.pool().filter((m) => crewLimitOf(m) >= size);
  }

  private track(p: Promise<void>) {
    this.running.add(p);
    void p.finally(() => this.running.delete(p));
  }

  private async side(s: Pick<V2Search, 'accountId' | 'handle' | 'crew' | 'rank'>, match: RosterMatch): Promise<V2Side> {
    return { accountId: s.accountId, handle: s.handle, ...(s.rank ? { rank: s.rank } : {}), ...(await this.roster(s.accountId, s.crew, match)) };
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
    const bought: boolean[] = [];
    const instructions: (string | null)[] = [];
    for (const c of entries) {
      const v = await repos.agents.view(c.agentId);
      if (!v) throw new V2HubError('invalid_crew', 'an agent no longer exists');
      crew.push({ id: v.id, name: v.name, role: v.role, vision: v.vision, comms: v.comms, tier: c.tier });
      const prompts: string[] = [];
      const keys: { id: string; version: number }[] = [];
      // A rented agent (ownCrew checked the pass) plays with the skills its owner holds.
      const ownerId = (await repos.agents.get(c.agentId))?.ownerId ?? accountId;
      const rented = ownerId !== accountId;
      const holder = ownerId;
      for (const k of v.skills) {
        if (!(await repos.skills.owns(holder, k.id, k.version))) {
          log.warn(`v2: agent ${v.id} plays without skill ${k.id} v${k.version}: its player does not own it`);
          continue;
        }
        const sealed = await repos.skills.loadSealed(k.id, k.version);
        if (!sealed) continue;
        prompts.push((await vault.decryptSkill(sealed)).prompt);
        keys.push({ id: k.id, version: k.version });
      }
      skills.push(prompts);
      skillKeys.push(keys);
      const meta = keys.length ? await repos.skills.getMany(keys) : [];
      bought.push(rented || meta.some((m) => m.creatorId !== accountId));
      instructions.push(v.systemPrompt ?? null);
    }
    const brains = await this.externalBrains(accountId, crew, bought, match);
    return { crew, skills, skillKeys, bought, instructions, ...(brains ? { brains } : {}) };
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
      const fits = this.fitting(Math.max(sides.A.crew.length, sides.B.crew.length));
      // A casual pair picked the same map, or one of them takes any map (v2PoolsMatch).
      const pickedId = a.payload.mapId ?? b.payload.mapId;
      const picked = pickedId !== undefined ? fits.find((m) => m.id === pickedId) : undefined;
      if (pickedId !== undefined && !picked) throw new V2HubError('invalid_crew', 'the picked map does not take both crews');
      const map = picked ?? (this.deps.pickMap ?? ((f) => f[Math.floor(Math.random() * f.length)]!))(fits);
      const ranked = a.payload.ranked;
      const difficulty = ranked ? RANKED_DIFFICULTY : a.payload.difficulty;
      await this.deps.repos.v2Matches.create({ id: matchId, mapId: map.id, ranked, teamA: a.key, teamB: b.key, crews: { A: crewRecords(sides.A), B: crewRecords(sides.B) }, ...(ranked ? {} : { difficulty }) });
      return this.newMatch({ matchId, map, ranked, difficulty, sides }, { A: this.deps.brain, B: this.deps.brain }, (t, msg) => this.deps.send(sides[t].accountId, msg));
    });
  }

  /** The player is crew A; the bot (crew B) answers its own v2_found and v2_lockin. */
  private async startPractice(user: { accountId: string; handle: string }, entries: V2CrewEntry[], map: MapDefV2, difficulty: Difficulty): Promise<void> {
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
      const hold = rival.hold ? { B: rival.hold } : undefined;
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
    const mode = setup.ranked ? 'ranked' : `${setup.practice ? 'practice' : 'casual'}, ${match.difficulty}`;
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
    }
    if (row?.registryStatus === 'pending') {
      out.registry = 'pending';
      await this.deps.registry
        ?.enqueue({ kind: 'v2_match', id: end.matchId })
        .catch((err: unknown) => log.warn(`v2 match ${end.matchId}: registry enqueue failed: ${(err as Error).message}`));
    }
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

const rec = (a: AgentSpec) => ({ id: a.id, name: a.name, role: a.role, vision: a.vision, comms: a.comms, tier: a.tier });

/** The skill versions an agent of this crew runs. */
const skillsOf = (side: V2Roster, agentId: string) => side.skillKeys?.[side.crew.findIndex((a) => a.id === agentId)] ?? [];

/** `{ external: true }` when its player's own program plays the agent (bring your own agent). */
const externalOf = (side: V2Roster, agentId: string): { external?: true } =>
  isExternalBrain(side.brains?.[side.crew.findIndex((a) => a.id === agentId)]) ? { external: true } : {};

/** A crew as v2_matches.crews records it. */
const crewRecords = (side: V2Roster): V2CrewRecord[] => side.crew.map((a) => ({ ...rec(a), skills: skillsOf(side, a.id), ...externalOf(side, a.id) }));
