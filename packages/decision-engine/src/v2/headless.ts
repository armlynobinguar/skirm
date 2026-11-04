// A v2 match played to the end without a server, a clock or credits: for benchmarks, trials and
// tooling. It mirrors the realtime tick loop (apps/realtime/src/v2/match.ts) so a headless run plays
// like a live one: the engine sets the head start, each crew gets a plan before the first tick, every
// live agent that can act or speak asks its crew's brain (whatever is not back by the deadline is a
// wait), speech goes through the filter, the engine steps and the log chains the tick, and the plans
// are rewritten every `replanEvery` ticks until a result (a goal, an elimination or the clock).
//
// Differences from realtime, all because nothing waits on a wall clock here: the next tick starts as
// soon as every answer is in, and a replan is awaited instead of landing during the 2 s sleep.
//
// `inject` scripts rival lines for a hijack test. They go straight into what the tested crew's agents
// hear (as if a rival had spoken in range), so delivery never depends on where the agents stand; they
// are never fed to the engine or written to the log, which stays a true record of the match.
import {
  RANKED_DIFFICULTY,
  V2_REPLAN_EVERY,
  actionText,
  appendTick,
  clean,
  createMatch,
  logAgent,
  logHash,
  observe,
  startLog,
  stepMatch,
  type Action,
  type AgentSpec,
  type Difficulty,
  type HeardMessage,
  type MapDefV2,
  type MatchEvent,
  type MatchLog,
  type MatchResult,
  type MatchState,
  type SayInput,
  type Team,
} from '@skirm/engine/v2';
import { V2_ACTION_DEADLINE_MS, V2_PLANNER_DEADLINE_MS, maySpeak, type V2AgentContext, type V2Brain, type V2Call, type V2Decision } from './brain';
import { filterSpeech } from './filter';

const TEAMS: readonly Team[] = ['A', 'B'];

export interface HeadlessOptions {
  def: MapDefV2;
  difficulty: Difficulty;
  crews: Record<Team, AgentSpec[]>;
  brains: Record<Team, V2Brain>;
  /** Per agent id: its skill prompts, their triggers and the owner's instructions (none when absent). */
  contexts?: Partial<Record<string, Pick<V2AgentContext, 'skills' | 'skillTriggers' | 'instructions'>>>;
  /** A label for the run, echoed in the result (the engine itself is deterministic). */
  seed?: string;
  /** Action deadline per agent per tick. Default V2_ACTION_DEADLINE_MS. */
  deadlineMs?: number;
  /** Default V2_REPLAN_EVERY. */
  replanEvery?: number;
  /** Every model call the runner saw back in time (actor and planner). */
  onCall?: (team: Team, c: V2Call) => void;
  /** Scripted rival lines: every `every` ticks the next line reaches each agent of `team` that asks its brain. */
  inject?: { team: Team; every: number; lines: string[] };
  /** Every stepped tick: the engine's events and the state after it (read only; for timelines and debriefs). */
  onTick?: (events: readonly MatchEvent[], s: Readonly<MatchState>) => void;
}

export interface HeadlessStats {
  /** Model calls back in time, and their cost. */
  calls: number;
  costUsd: number;
  /** Messages the engine delivered. */
  says: number;
  /** Injected lines handed to this crew's agents (one per agent per line). */
  injected: number;
  /** Speech the filter refused. */
  refused: { leak: number; abuse: number; empty: number };
}

export interface HeadlessResult {
  result: MatchResult;
  ticks: number;
  score: Record<Team, number>;
  log: MatchLog;
  logHash: string;
  stats: Record<Team, HeadlessStats>;
  seed?: string;
}

export async function playHeadless(opts: HeadlessOptions): Promise<HeadlessResult> {
  const { def, difficulty, crews, brains } = opts;
  const deadlineMs = opts.deadlineMs ?? V2_ACTION_DEADLINE_MS;
  const replanEvery = opts.replanEvery ?? V2_REPLAN_EVERY;
  const stats: Record<Team, HeadlessStats> = { A: emptyStats(), B: emptyStats() };
  const plans: Record<Team, string | null> = { A: null, B: null };
  const recent = new Map<string, string[]>();
  const ctxOf = (id: string) => opts.contexts?.[id] ?? { skills: [] };

  const called = (team: Team, c: V2Call | undefined) => {
    if (!c) return;
    stats[team].calls++;
    stats[team].costUsd += c.costUsd;
    opts.onCall?.(team, c);
  };

  // The engine applies the head start: a held crew's agents have only `wait` until it runs out.
  const s = createMatch(def, crews, { difficulty });
  const header = (t: Team) => s.agents.filter((a) => a.team === t).map(logAgent);
  const model = brains.A.model === brains.B.model ? brains.A.model : `A:${brains.A.model} B:${brains.B.model}`;
  const log = startLog({
    schema: 'skirm.match/v2',
    map: def.id,
    crews: { A: header('A'), B: header('B') },
    ranked: false,
    ...(difficulty !== RANKED_DIFFICULTY ? { difficulty } : {}),
    models: { planner: model, actor: model, speech: model },
  });

  /** The crew plan, written from its first agent still in the match (kept as is on failure). */
  const replan = async (team: Team) => {
    const lead = s.agents.find((a) => a.team === team && !a.out);
    if (!lead) return;
    const mine = s.agents.filter((a) => a.team === team).map((a) => ctxOf(a.id));
    const skills = mine.flatMap((c) => c.skills);
    const instructions = mine.map((c) => c.instructions).filter((t): t is string => !!t).join('\n\n') || null;
    const r = await withDeadline(brains[team].plan(observe(s, lead.id), { skills, instructions }).catch(() => null), V2_PLANNER_DEADLINE_MS, null);
    if (!r) return;
    called(team, r.call);
    if (r.text) plans[team] = r.text;
  };

  /** Scripted lines heard on the coming tick, or none. */
  const injected = (team: Team, tick: number): HeardMessage[] => {
    const inj = opts.inject;
    if (!inj || inj.team !== team || inj.every < 1 || !inj.lines.length || tick % inj.every !== 0) return [];
    const from = s.agents.find((a) => a.team !== team);
    const text = clean(inj.lines[(tick / inj.every - 1) % inj.lines.length]!);
    if (!from || !text) return [];
    return [{ tick: s.tick, from: from.id, fromName: from.name, team: from.team, channel: 'say', text, overheard: false }];
  };

  const decide = async (id: string): Promise<V2Decision> => {
    const a = s.agents.find((x) => x.id === id)!;
    const o = observe(s, id);
    const canSpeak = maySpeak(a.tier, s.tick + 1, a.lastSpoke);
    const wait: Action = { type: 'wait' };
    if (o.legal.length <= 1 && !canSpeak) return { action: o.legal[0] ?? wait, reason: 'chosen', say: null };
    const extra = injected(a.team, o.tick);
    if (extra.length) {
      o.heard = [...o.heard, ...extra];
      stats[a.team].injected += extra.length;
    }
    const c = ctxOf(id);
    const ctx: V2AgentContext = { skills: c.skills, ...(c.skillTriggers ? { skillTriggers: c.skillTriggers } : {}), instructions: c.instructions ?? null, plan: plans[a.team], canSpeak, recent: recent.get(id) ?? [] };
    const timeout: V2Decision = { action: wait, reason: 'timeout', say: null };
    return withDeadline(
      brains[a.team].act(o, ctx).catch((): V2Decision => ({ action: wait, reason: 'error', say: null })),
      deadlineMs,
      timeout,
    );
  };

  await Promise.all(TEAMS.map(replan));
  while (!s.result) {
    const live = s.agents.filter((a) => !a.out);
    const decisions = await Promise.all(live.map((a) => decide(a.id)));
    const actions: Record<string, Action> = {};
    const says: SayInput[] = [];
    live.forEach((a, i) => {
      const d = decisions[i]!;
      actions[a.id] = d.action;
      const r = recent.get(a.id) ?? [];
      r.push(`${actionText(d.action)} from ${a.x},${a.y}`);
      recent.set(a.id, r.slice(-4));
      called(a.team, d.call);
      if (d.refusedSay) stats[a.team].refused[d.refusedSay]++;
      if (!d.say) return;
      const c = ctxOf(a.id);
      const f = filterSpeech(d.say.text, c.instructions ? [...c.skills, c.instructions] : c.skills);
      if (f.ok) says.push({ agent: a.id, channel: d.say.channel, text: f.text });
      else stats[a.team].refused[f.reason]++;
    });
    const ev = stepMatch(s, { actions, says });
    appendTick(log, { tick: s.tick, actions, says });
    opts.onTick?.(ev, s);
    // The brain's own messages; bluffs the engine told for an agent are not its speech.
    for (const e of ev) if (e.kind === 'said' && !e.bluff) stats[teamOf(s, e.agent)].says++;
    if (s.result) break;
    if (s.tick % replanEvery === 0) await Promise.all(TEAMS.map(replan));
  }
  log.result = s.result;
  return {
    result: s.result,
    ticks: s.tick,
    score: { ...s.score },
    log,
    logHash: logHash(log),
    stats,
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
  };
}

function emptyStats(): HeadlessStats {
  return { calls: 0, costUsd: 0, says: 0, injected: 0, refused: { leak: 0, abuse: 0, empty: 0 } };
}

function teamOf(s: MatchState, id: string): Team {
  return s.agents.find((a) => a.id === id)!.team;
}

/** `p`, or `fallback` once `ms` have passed. */
function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => (timer = setTimeout(() => resolve(fallback), ms)));
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}
