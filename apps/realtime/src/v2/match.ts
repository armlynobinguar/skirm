// One v2 match held in memory. Both crews accept within 10 s,
// then lock in their talk tiers within 30 s, and may change the crew while they do (swap, remove or
// add up to the map's crew limit; the head start is re-sent). The rival's handle stays hidden until
// the start. Then the shared map plays in 2 s ticks at the match's difficulty: every agent that can
// act or speak asks the brain, whatever is not back by the action deadline is a wait, talk is
// delivered by the engine, and each crew gets its own fogged frame with its own plan. Credits: a hold
// of every tick at the crew's talk rates up front (whole credits, rounded up once), then each tick
// the crew's cost in hundredths of a credit is added to a running total and only the whole credits
// it newly crosses are charged, so charges never exceed the hold; the rest is returned at the end
// (all of it on a void). A free crew (the practice bot, or a practice player on the greedy brain)
// holds and pays nothing. The match log is hash-chained per tick. At the end each crew gets its
// debrief, and every frame is kept for replay.
import { V2_ACTION_DEADLINE_MS, V2_PLANNER_DEADLINE_MS, maySpeak, type V2Brain, type V2Decision } from '@skirm/decision-engine/v2';
import { chargeDue } from '@skirm/shared';
import {
  RANKED_DIFFICULTY,
  TICK_MS,
  V2_REPLAN_EVERY,
  actionText,
  appendTick,
  createMatch,
  frameFor,
  holdFor,
  logHash,
  observe,
  startLog,
  stepMatch,
  tickCostPer100,
  type Action,
  type AgentSpec,
  type Difficulty,
  type FrameView,
  type MapDefV2,
  type MatchEvent,
  type MatchLog,
  type MatchState,
  type SayInput,
  type TalkTier,
  type Team,
  type V2Frame,
} from '@skirm/engine/v2';
import type { MatchTimelineInput, V2MatchMessageInput } from '@skirm/db';
import type { V2Debrief, V2EndReason, V2ServerMessage } from '@skirm/server';
import type { Logger } from '../deps';
import type { Scheduler } from '../timing';
import { DebriefTally, buildDebrief } from './debrief';
import { DecisionTimeline } from './timeline';

export const TEAMS: readonly Team[] = ['A', 'B'];

export interface V2Timing {
  acceptMs: number;
  lockMs: number;
  tickMs: number;
  actionMs: number;
  planMs: number;
  /** The crew plan is rewritten every this many ticks. */
  replanEvery: number;
}

export const DEFAULT_V2_TIMING: V2Timing = {
  acceptMs: 10_000,
  lockMs: 30_000,
  tickMs: TICK_MS,
  actionMs: V2_ACTION_DEADLINE_MS,
  planMs: V2_PLANNER_DEADLINE_MS,
  replanEvery: V2_REPLAN_EVERY,
};

/** The ledger seen from a match: one hold per crew, charged per tick, the rest returned. */
export interface V2Credits {
  hold(team: Team, accountId: string, amount: number): Promise<{ ok: true } | { ok: false; need: number; have: number }>;
  charge(team: Team, amount: number): Promise<void>;
  /** Ends the hold, returning what was not charged. */
  settle(team: Team): Promise<void>;
  /** Voids the hold, returning everything. */
  release(team: Team): Promise<void>;
}

/** A crew as it plays: the agents, their skill prompts and which run a bought skill. */
export interface V2Roster {
  crew: AgentSpec[];
  /** Each agent's equipped skill prompts (secret: sent to its model only). */
  skills: string[][];
  /** Per agent: runs a skill this player did not write (its plan is never shown). Absent: none. */
  bought?: boolean[];
  /** Per agent: the owner's instructions (agents.system_prompt), private like the skills. */
  instructions?: (string | null)[];
  /** Per agent: the skill versions it plays with (recorded on v2_matches.crews, never in the log). */
  skillKeys?: { id: string; version: number }[][];
}

export interface V2Side extends V2Roster {
  accountId: string;
  handle: string;
}

export interface V2Setup {
  matchId: string;
  map: MapDefV2;
  ranked: boolean;
  /** Casual only; ranked always plays RANKED_DIFFICULTY. Default Normal. */
  difficulty?: Difficulty;
  sides: Record<Team, V2Side>;
  /** Practice against the greedy bot (casual): the rival's handle is shown from v2_found on. */
  practice?: boolean;
  /** Crews that hold and pay nothing: the bot, or a practice player on the offline greedy brain. */
  free?: Partial<Record<Team, true>>;
  /** Extra ticks a crew waits at the start (the practice bot on Easy, practiceRival). */
  hold?: Partial<Record<Team, number>>;
  /** Bluffs a crew may tell when not BLUFF_CAP (the practice bot, practiceRival). */
  lieCap?: Partial<Record<Team, number>>;
}

/** What the hub knows once the result is written: each player's Elo change, the registry line and (ranked) the season points. */
export interface V2Finish {
  eloDelta: Partial<Record<Team, number>>;
  registry: V2Debrief['registry'];
  season?: Partial<Record<Team, NonNullable<V2Debrief['season']>>>;
}

/** Most agents a crew fields on this map (both sides start from the same number of tiles). */
export const crewLimitOf = (map: MapDefV2) => Math.min(3, map.starts.A.length, map.starts.B.length);

export interface V2MatchEnd {
  matchId: string;
  result: MatchState['result'];
  reason: V2EndReason;
  log: MatchLog | null;
  /** The crew at fault for a void (did not accept, declined, short of credits). */
  fault?: Team;
  stats: Record<Team, { timeouts: number; errors: number; illegal: number; refusedSays: number; costUsd: number; charged: number }>;
  /** Every line the engine delivered ('said' events), in tick order; refused lines never appear. */
  messages: V2MatchMessageInput[];
}

export interface V2MatchDeps {
  /** The brain each crew's agents use (practice: the bot plays greedy against the player's brain). */
  brains: Record<Team, V2Brain>;
  scheduler: Scheduler;
  timing?: Partial<V2Timing>;
  credits: V2Credits;
  send(team: Team, msg: V2ServerMessage): void;
  watch?(msg: V2ServerMessage): void;
  /** Writes the result (Elo, registry job, stored frames) before v2_end goes out with the debrief. */
  finish?(end: V2MatchEnd): Promise<V2Finish>;
  log: Logger;
}

type Phase = 'found' | 'lockin' | 'live' | 'ended';

export class V2Match {
  readonly matchId: string;
  readonly timing: V2Timing;
  readonly difficulty: Difficulty;
  readonly crewLimit: number;
  phase: Phase = 'found';
  state: MatchState | null = null;
  lastFrames: Partial<Record<Team | 'watch', V2ServerMessage>> = {};
  private accepted = new Set<Team>();
  private locked = new Map<Team, TalkTier[]>();
  private declined: Team | null = null;
  private stopReason: string | null = null;
  private poke: (() => void) | null = null;
  private plans: Record<Team, string | null> = { A: null, B: null };
  /** The planner's reason for each crew's plan (the planner trace). */
  private planWhys: Record<Team, string | null> = { A: null, B: null };
  /** Each agent's latest inner voice (its THINK line), by agent id. */
  private thoughts = new Map<string, string>();
  /** Each crew's decision timeline for the debrief; set when the match goes live. */
  private timeline: DecisionTimeline | null = null;
  /** Holds still open (released on a void). */
  private held = new Map<Team, number>();
  /** What each crew had held, kept for the debrief. */
  private heldFor: Partial<Record<Team, number>> = {};
  private lockBy = 0;
  private readonly tally: DebriefTally;
  /** Every frame sent, per view, for replay once the match has ended. */
  private readonly frames: Record<FrameView, V2Frame[]> = { A: [], B: [], watch: [] };
  /** Each agent's last actions with where it stood (the brain sees the last 4). */
  private recent = new Map<string, string[]>();
  private readonly messages: V2MatchMessageInput[] = [];
  private stats: V2MatchEnd['stats'] = {
    A: { timeouts: 0, errors: 0, illegal: 0, refusedSays: 0, costUsd: 0, charged: 0 },
    B: { timeouts: 0, errors: 0, illegal: 0, refusedSays: 0, costUsd: 0, charged: 0 },
  };

  constructor(
    readonly setup: V2Setup,
    private readonly deps: V2MatchDeps,
  ) {
    this.matchId = setup.matchId;
    this.timing = { ...DEFAULT_V2_TIMING, ...deps.timing };
    this.difficulty = setup.ranked ? RANKED_DIFFICULTY : (setup.difficulty ?? RANKED_DIFFICULTY);
    this.crewLimit = crewLimitOf(setup.map);
    this.tally = new DebriefTally((id) => this.state?.agents.find((a) => a.id === id)?.team);
  }

  accept(team: Team): void {
    if (this.phase !== 'found' || this.accepted.has(team)) return;
    this.accepted.add(team);
    this.toAll({ type: 'v2_accepted', matchId: this.matchId, team });
    this.poke?.();
  }

  decline(team: Team): void {
    if (this.phase !== 'found') return;
    this.declined ??= team;
    this.poke?.();
  }

  /**
   * Talk tier per agent, in crew order (ranked plays Standard whatever is sent). `roster`, when
   * given, replaces the crew (its agents' tiers win) and both crews are sent the new head start.
   * Returns false when the crew can no longer lock in (not in lock-in, or already locked).
   */
  lockIn(team: Team, tiers: TalkTier[], roster?: V2Roster): boolean {
    if (this.phase !== 'lockin' || this.locked.has(team)) return false;
    const side = this.setup.sides[team];
    if (roster) {
      if (roster.crew.length < 1 || roster.crew.length > this.crewLimit) throw new Error(`crew ${team} must field 1 to ${this.crewLimit} agents`);
      side.crew = roster.crew;
      side.skills = roster.skills;
      side.bought = roster.bought ?? [];
      side.instructions = roster.instructions ?? [];
      side.skillKeys = roster.skillKeys ?? [];
    }
    this.locked.set(team, side.crew.map((a, i) => (roster ? a.tier : (tiers[i] ?? a.tier))));
    if (roster) for (const t of TEAMS) this.deps.send(t, this.lockinMessage(t));
    this.toAll({ type: 'v2_locked', matchId: this.matchId, team });
    this.poke?.();
    return true;
  }

  /** v2_lockin for a crew: the time left, the rival's crew size and both head starts as the crews stand. */
  lockinMessage(team: Team): V2ServerMessage {
    const { sides } = this.setup;
    return {
      type: 'v2_lockin',
      matchId: this.matchId,
      lockMs: Math.max(0, this.lockBy - this.deps.scheduler.now()),
      rival: { agents: sides[team === 'A' ? 'B' : 'A'].crew.length },
      crewLimit: this.crewLimit,
      headStartTicks: this.headStart(),
      ...(this.setup.free?.[team] ? { free: true as const } : {}),
    };
  }

  /** v2_found for a crew (also re-sent on reconnect). */
  foundMessage(team: Team): V2ServerMessage {
    const { setup } = this;
    return {
      type: 'v2_found',
      matchId: this.matchId,
      team,
      mapId: setup.map.id,
      ranked: setup.ranked,
      acceptMs: this.timing.acceptMs,
      difficulty: this.difficulty,
      ...(setup.practice ? { practice: true as const, rivalHandle: setup.sides[team === 'A' ? 'B' : 'A'].handle } : {}),
      ...(setup.free?.[team] ? { free: true as const } : {}),
    };
  }

  /** Each crew's start hold with the crews as they stand, as the engine would set it. */
  private headStart(): Record<Team, number> {
    try {
      return { ...this.create(this.setup.sides.A.crew, this.setup.sides.B.crew).holdTicks };
    } catch {
      return { A: 0, B: 0 };
    }
  }

  private create(a: AgentSpec[], b: AgentSpec[]): MatchState {
    return createMatch(this.setup.map, { A: a, B: b }, {
      ranked: this.setup.ranked,
      difficulty: this.difficulty,
      ...(this.setup.hold ? { hold: this.setup.hold } : {}),
      ...(this.setup.lieCap ? { lieCap: this.setup.lieCap } : {}),
    });
  }

  /** Every frame a view was sent; empty until the match went live. */
  framesOf(view: FrameView): readonly V2Frame[] {
    return this.frames[view];
  }

  /** Each crew's decision timeline (the debrief's "why did it do that?"); empty until the match went live. */
  timelines(): MatchTimelineInput[] {
    return this.timeline?.records() ?? [];
  }

  /** Stops the match at the next checkpoint; it ends void with every credit returned. */
  abort(reason: string): void {
    this.stopReason ??= reason;
    this.poke?.();
  }

  async play(): Promise<V2MatchEnd> {
    let end: V2MatchEnd;
    try {
      end = await this.run();
    } catch (err) {
      this.deps.log.error(`v2 match ${this.matchId}: ${(err as Error).stack ?? String(err)}`);
      end = await this.voidMatch('error');
    }
    this.phase = 'ended';
    let fin: V2Finish = { eloDelta: {}, registry: null };
    if (this.deps.finish)
      fin = await this.deps.finish(end).catch((err: unknown) => {
        this.deps.log.error(`v2 match ${this.matchId}: finish failed: ${(err as Error).message}`);
        return fin;
      });
    const base = { type: 'v2_end' as const, matchId: this.matchId, result: end.result, reason: end.reason, logHash: end.log && end.result ? logHash(end.log) : null };
    for (const t of TEAMS) this.deps.send(t, { ...base, debrief: this.debrief(t, end, fin) });
    this.deps.watch?.(base);
    return end;
  }

  /** One crew's own numbers for v2_end. */
  debrief(team: Team, end: V2MatchEnd, fin: V2Finish): V2Debrief {
    const held = this.heldFor[team] ?? 0;
    return buildDebrief({
      state: this.state,
      team,
      difficulty: this.difficulty,
      tally: this.tally,
      held,
      charged: this.stats[team].charged,
      void: !end.result,
      eloDelta: end.result ? (fin.eloDelta[team] ?? null) : null,
      registry: end.result ? fin.registry : null,
      ...(end.result && fin.season?.[team] ? { season: fin.season[team] } : {}),
    });
  }

  private toAll(msg: V2ServerMessage) {
    for (const t of TEAMS) this.deps.send(t, msg);
  }

  /** Resolves once `done()` holds (re-checked on every poke) or after `ms`. */
  private waitFor(done: () => boolean, ms: number): Promise<void> {
    const s = this.deps.scheduler;
    return new Promise((resolve) => {
      const finish = () => {
        s.clearTimeout(h);
        this.poke = null;
        resolve();
      };
      const h = s.setTimeout(finish, ms);
      this.poke = () => {
        if (done() || this.stopReason) finish();
      };
      this.poke();
    });
  }

  private async run(): Promise<V2MatchEnd> {
    const { setup, timing } = this;
    for (const t of TEAMS) this.deps.send(t, this.foundMessage(t));
    await this.waitFor(() => this.accepted.size === 2 || this.declined !== null, timing.acceptMs);
    if (this.stopReason) return this.voidMatch('aborted');
    if (this.declined) return this.voidMatch('declined', this.declined);
    if (this.accepted.size < 2) return this.voidMatch('accept_timeout', TEAMS.find((t) => !this.accepted.has(t)));

    this.phase = 'lockin';
    this.lockBy = this.deps.scheduler.now() + timing.lockMs;
    for (const t of TEAMS) this.deps.send(t, this.lockinMessage(t));
    await this.waitFor(() => this.locked.size === 2, timing.lockMs);
    if (this.stopReason) return this.voidMatch('aborted');
    const crews = {} as Record<Team, AgentSpec[]>;
    for (const t of TEAMS) {
      const tiers = this.locked.get(t);
      crews[t] = setup.sides[t].crew.map((a, i) => ({ ...a, tier: tiers?.[i] ?? a.tier }));
    }

    // The state first (it is pure): the difficulty sets the clock the hold covers. A free crew holds nothing.
    const s = this.create(crews.A, crews.B);
    const pays = TEAMS.filter((t) => !setup.free?.[t]);
    for (const t of pays) {
      const amount = holdFor(crews[t], setup.ranked, s.limit);
      const r = await this.deps.credits.hold(t, setup.sides[t].accountId, amount);
      if (!r.ok) return this.voidMatch('credits', t);
      this.held.set(t, amount);
      this.heldFor[t] = amount;
    }

    this.state = s;
    const crewOf = (t: Team) => ({ brain: this.deps.brains[t].kind, bought: setup.sides[t].bought ?? [], skillKeys: setup.sides[t].skillKeys ?? [] });
    this.timeline = new DecisionTimeline({ A: crewOf('A'), B: crewOf('B') });
    // One model name when both crews share a brain, else each crew's (as the headless runner writes it).
    const { A: brainA, B: brainB } = this.deps.brains;
    const model = brainA.model === brainB.model ? brainA.model : `A:${brainA.model} B:${brainB.model}`;
    const log = startLog({
      schema: 'skirm.match/v2',
      map: setup.map.id,
      crews: { A: s.agents.filter((a) => a.team === 'A').map(header), B: s.agents.filter((a) => a.team === 'B').map(header) },
      ranked: setup.ranked,
      ...(this.difficulty !== RANKED_DIFFICULTY ? { difficulty: this.difficulty } : {}),
      models: { planner: model, actor: model, speech: model },
    });

    await Promise.all(TEAMS.map((t) => this.replan(t)));
    this.phase = 'live';
    for (const t of TEAMS)
      this.deps.send(t, { type: 'v2_start', matchId: this.matchId, team: t, rival: { handle: setup.sides[t === 'A' ? 'B' : 'A'].handle }, tickMs: timing.tickMs, holdTicks: { ...s.holdTicks } });
    this.publish([]);

    const sched = this.deps.scheduler;
    /** Each crew's running cost in hundredths of a credit; stats.charged is what has been charged. */
    const cum100: Record<Team, number> = { A: 0, B: 0 };
    while (!s.result) {
      if (this.stopReason) return this.voidMatch('aborted', undefined, log);
      const tickStart = sched.now();
      const costPer100 = { A: tickCostPer100(s, 'A'), B: tickCostPer100(s, 'B') };
      const live = s.agents.filter((a) => !a.out);
      const decisions = await Promise.all(live.map((a) => this.decide(s, a.id)));
      if (this.stopReason) return this.voidMatch('aborted', undefined, log);
      const actions: Record<string, Action> = {};
      const says: SayInput[] = [];
      live.forEach((a, i) => {
        const d = decisions[i]!;
        actions[a.id] = d.action;
        const r = this.recent.get(a.id) ?? [];
        r.push(`${actionText(d.action)} from ${a.x},${a.y}`);
        this.recent.set(a.id, r.slice(-4));
        if (d.say) says.push({ agent: a.id, channel: d.say.channel, text: d.say.text });
        // The inner voice is never part of the match (not in the log, never heard); only its own crew's frames show it.
        if (d.thought) this.thoughts.set(a.id, d.thought);
        this.count(a.team, d);
        this.timeline?.turn(a, d);
      });
      const ev = stepMatch(s, { actions, says });
      appendTick(log, { tick: s.tick, actions, says });
      this.tally.add(ev);
      this.timeline?.resolve(s, ev);
      this.collect(s, ev);
      for (const t of pays) {
        cum100[t] += costPer100[t];
        const due = chargeDue(cum100[t], this.stats[t].charged);
        if (due > 0) {
          await this.deps.credits.charge(t, due);
          this.stats[t].charged += due;
        }
      }
      this.publish(ev);
      if (s.result) break;
      if (s.tick % timing.replanEvery === 0) for (const t of TEAMS) void this.replan(t);
      await this.sleepUntil(tickStart + timing.tickMs);
    }
    log.result = s.result;
    for (const t of this.held.keys()) await this.deps.credits.settle(t).catch((e: unknown) => this.deps.log.warn(`v2 match ${this.matchId} ${t}: settle failed: ${(e as Error).message}`));
    return { matchId: this.matchId, result: s.result, reason: s.result!.reason, log, stats: this.stats, messages: this.messages };
  }

  /** The lines the engine delivered this tick, with who heard and who overheard them. */
  private collect(s: MatchState, ev: readonly MatchEvent[]) {
    for (const e of ev) {
      if (e.kind !== 'said') continue;
      const a = s.agents.find((x) => x.id === e.agent);
      if (!a) continue;
      this.messages.push({ tick: s.tick, team: a.team, agentId: a.id, agentName: a.name, channel: e.channel, text: e.text, heardBy: [...e.heardBy], overheardBy: [...e.overheardBy] });
    }
  }

  private async sleepUntil(at: number): Promise<void> {
    const ms = at - this.deps.scheduler.now();
    if (ms > 0) await this.waitFor(() => false, ms);
  }

  /** The brain's answer, or a wait at the action deadline. Agents that can neither act nor speak skip the call. */
  private decide(s: MatchState, id: string): Promise<V2Decision> {
    const a = s.agents.find((x) => x.id === id)!;
    const o = observe(s, id);
    this.timeline?.observe(id, o);
    const canSpeak = maySpeak(a.tier, s.tick + 1, a.lastSpoke);
    const wait: Action = { type: 'wait' };
    if (o.legal.length <= 1 && !canSpeak) return Promise.resolve({ action: o.legal[0] ?? wait, reason: 'chosen', say: null });
    const side = this.setup.sides[a.team];
    const ctx = { skills: side.skills[a.slot] ?? [], instructions: side.instructions?.[a.slot] ?? null, plan: this.plans[a.team], canSpeak, recent: this.recent.get(id) ?? [] };
    const sched = this.deps.scheduler;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (d: V2Decision) => {
        if (settled) return;
        settled = true;
        sched.clearTimeout(h);
        resolve(d);
      };
      const h = sched.setTimeout(() => finish({ action: wait, reason: 'timeout', say: null }), this.timing.actionMs);
      this.deps.brains[a.team].act(o, ctx).then(finish, () => finish({ action: wait, reason: 'error', say: null }));
    });
  }

  private count(team: Team, d: V2Decision) {
    const st = this.stats[team];
    if (d.reason === 'timeout') st.timeouts++;
    else if (d.reason === 'error') st.errors++;
    else if (d.reason === 'illegal') st.illegal++;
    if (d.refusedSay) st.refusedSays++;
    st.costUsd += d.call?.costUsd ?? 0;
  }

  /** The crew plan, written from its first agent still in the match (kept as is on failure). */
  private async replan(team: Team): Promise<void> {
    const s = this.state!;
    const lead = s.agents.find((a) => a.team === team && !a.out);
    if (!lead) return;
    const skills = this.setup.sides[team].skills.flat();
    const instructions = (this.setup.sides[team].instructions ?? []).filter((t): t is string => !!t).join('\n\n') || null;
    let timer: unknown;
    const late = new Promise<null>((r) => (timer = this.deps.scheduler.setTimeout(() => r(null), this.timing.planMs)));
    const r = await Promise.race([this.deps.brains[team].plan(observe(s, lead.id), { skills, instructions }).catch(() => null), late]);
    this.deps.scheduler.clearTimeout(timer);
    if (r) {
      this.stats[team].costUsd += r.call?.costUsd ?? 0;
      if (r.text) {
        this.plans[team] = r.text;
        this.planWhys[team] = r.why ?? null;
        this.timeline?.plan(team, s.tick + 1, r.text, r.why ?? null);
      }
    }
  }

  private publish(ev: MatchEvent[]) {
    const s = this.state!;
    for (const t of TEAMS) {
      let frame = withOwnCrew(frameFor(s, t, ev), s, t, ev, this.plans[t], this.setup.sides[t].bought ?? [], { why: this.planWhys[t], thoughts: this.thoughts });
      // Practice shows all minds (the prototype): the player also sees the bot's plan, reason and inner voice.
      if (this.setup.practice) {
        const r: Team = t === 'A' ? 'B' : 'A';
        frame = withRivalMind(frame, t, this.plans[r], this.planWhys[r], this.thoughts, this.setup.sides[r].bought ?? []);
      }
      const msg: V2ServerMessage = { type: 'v2_frame', matchId: this.matchId, frame };
      this.frames[t].push(frame);
      this.lastFrames[t] = msg;
      this.deps.send(t, msg);
    }
    const watch = frameFor(s, 'watch', ev);
    this.frames.watch.push(watch);
    if (this.deps.watch) {
      const msg: V2ServerMessage = { type: 'v2_frame', matchId: this.matchId, frame: watch };
      this.lastFrames.watch = msg;
      this.deps.watch(msg);
    }
  }

  private async voidMatch(reason: V2EndReason, fault?: Team, log: MatchLog | null = null): Promise<V2MatchEnd> {
    this.deps.log.warn(`v2 match ${this.matchId}: void (${reason}${fault ? `, crew ${fault}` : ''})`);
    for (const t of this.held.keys()) await this.deps.credits.release(t).catch(() => undefined);
    this.held.clear();
    return { matchId: this.matchId, result: null, reason, log, ...(fault ? { fault } : {}), stats: this.stats, messages: this.messages };
  }
}

/**
 * A crew's frame with what only that crew may see: the crew plan and the planner's reason on each of
 * its agents, each agent's inner voice, and the rival agents that overheard each of its team
 * messages. The plan is one crew plan written with every equipped skill in its prompt, so when any
 * agent of the crew runs a bought skill the plan and its reason are withheld from the whole crew
 * (`planHidden`): a bought skill never leaks through plan text. An agent's inner voice comes from its
 * own prompt, so it is withheld when that agent runs a bought (or rented) skill.
 */
export function withOwnCrew(
  frame: V2Frame,
  s: MatchState,
  team: Team,
  ev: readonly MatchEvent[],
  plan: string | null,
  bought: readonly boolean[],
  mind: { why?: string | null; thoughts?: ReadonlyMap<string, string> } = {},
): V2Frame {
  const hidden = bought.some(Boolean);
  const slotOf = (id: string) => s.agents.find((x) => x.id === id)?.slot ?? -1;
  const agents = frame.agents.map((a) => {
    if (a.team !== team) return a;
    const thought = bought[slotOf(a.id)] ? undefined : mind.thoughts?.get(a.id);
    const own = thought ? { ...a, thought } : a;
    if (hidden) return { ...own, planHidden: true };
    return plan ? { ...own, plan, ...(mind.why ? { planWhy: mind.why } : {}) } : own;
  });
  const nameOf = (id: string) => s.agents.find((a) => a.id === id)?.name ?? id;
  const comms = frame.comms.map((m) => {
    if (m.team !== team || m.overheardBy) return m;
    // An agent speaks at most once a tick, so its message this tick is its one 'said' event.
    const e = ev.find((x) => x.kind === 'said' && x.agent === m.from && x.text === m.text);
    const by = e?.kind === 'said' ? e.overheardBy.filter((id) => s.agents.find((a) => a.id === id)?.team !== team).map(nameOf) : [];
    return by.length ? { ...m, overheardBy: by } : m;
  });
  return { ...frame, agents, comms };
}

/**
 * Practice only: the rival agents in a crew's frame with their own crew's plan, its reason and each
 * agent's inner voice. Never in ranked or casual play against people, whose strategy stays theirs;
 * withheld like an own crew's for any rival on a bought skill.
 */
export function withRivalMind(
  frame: V2Frame,
  team: Team,
  plan: string | null,
  why: string | null,
  thoughts: ReadonlyMap<string, string>,
  rivalBought: readonly boolean[],
): V2Frame {
  if (rivalBought.some(Boolean)) return frame;
  const agents = frame.agents.map((a) => {
    if (a.team === team) return a;
    const thought = thoughts.get(a.id);
    return { ...a, ...(plan ? { plan } : {}), ...(plan && why ? { planWhy: why } : {}), ...(thought ? { thought } : {}) };
  });
  return { ...frame, agents };
}

const header = (a: { id: string; name: string; role: string; vision: number; comms: number; tier: string }) => ({ id: a.id, name: a.name, role: a.role, vision: a.vision, comms: a.comms, tier: a.tier });
