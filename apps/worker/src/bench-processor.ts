// Writers' skill test bench: `benchmarks` job `{ kind: 'bench', runId }` plays one headless match
// of a skill version (a draft the writer wrote or a minted version they hold) on the map and
// difficulty they chose, against the greedy bot, with the prompt sealed on the run (an edited draft)
// or the version's own. The same match loop as a live game (playHeadless).
//
// Credits follow the match rules: on the greedy brain nothing is called and nothing is held, so a
// bench run is free. With a model the run holds one Standard agent for the whole match on the
// ledger (`bench-<runId>-<attempt>`, free allowance first), charges the ticks it played and settles;
// a run that cannot cover the hold ends `insufficient_credits` with nothing played. A failed attempt
// returns its hold before BullMQ retries.
//
// Offline honesty: the greedy brain never reads skills, so a greedy run shows how the map plays,
// not what the prompt changes. The result says which brain played (`brain`), and the web says so.
//
// What a run keeps: the result, score, a short timeline of key events (no speech text), the
// crew's debrief and the log hash. Never prompt text: the speech filter keeps it out of what the
// agent says, and only counts of refused lines are stored.
import type { SkillVersionView } from '@skirm/db';
import { createGreedyBrain, playHeadless, type HeadlessResult } from '@skirm/decision-engine/v2';
import {
  DIFFICULTIES,
  MAPS_V2,
  ROLES,
  botCrew,
  crewReport,
  holdFor,
  type AgentSpec,
  type CrewReport,
  type Difficulty,
  type MatchEvent,
  type MatchState,
  type Role,
} from '@skirm/engine/v2';
import type { BenchmarkAttempt, BenchmarkDeps, BenchmarkOutcome } from './benchmark-processor';
import { WorkerError, errorCode } from './deps';

/** The tested agent's id; the bot's are `bot-<n>`. */
export const BENCH_AGENT_ID = 'bench-1';
/** Most key events a run keeps (the earliest ones). */
export const BENCH_EVENTS_MAX = 80;

export interface BenchEvent {
  tick: number;
  /** Whose agent it was about: the tested agent, the bot, or the map. */
  side: 'you' | 'bot' | 'map';
  kind: MatchEvent['kind'];
  text: string;
}

/** What a finished run stores in `skill_bench_runs.result`. Never any prompt or speech text. */
export interface BenchRunResult {
  /** `<mapId>:<difficulty>`: run it again on the same seed. */
  seed: string;
  mapId: string;
  difficulty: Difficulty;
  role: Role;
  outcome: 'win' | 'loss' | 'draw';
  reason: string;
  decidedBy: string;
  score: { you: number; bot: number };
  ticks: number;
  logHash: string;
  /** The tested agent's talk: lines delivered, and lines the filter refused. */
  talk: { says: number; leaks: number; abuse: number; empty: number };
  /** Model calls back in time (0 on greedy). */
  calls: number;
  events: BenchEvent[];
  /** Events past BENCH_EVENTS_MAX that were dropped. */
  eventsDropped: number;
  debrief: CrewReport;
}

/**
 * The role the tested agent plays: one the skill may be equipped on (its `roles`; `any` allows
 * all), preferring the role of its first required action, else the first allowed one.
 */
export function benchRole(v: Pick<SkillVersionView, 'requiresActions'> & { roles?: readonly string[] }): Role {
  const want: Record<string, Role> = { place_block: 'Builder', dig: 'Digger', extinguish: 'Firefighter' };
  const named = (v.roles ?? []).filter((r): r is Role => (ROLES as readonly string[]).includes(r));
  const allowed: readonly Role[] = named.length && !(v.roles ?? []).includes('any') ? named : ROLES;
  for (const a of v.requiresActions) if (want[a] && allowed.includes(want[a]!)) return want[a]!;
  return allowed[0]!;
}

/** One line per event a writer cares about; null for the rest (moves, hazard waves, speech). */
export function benchEventLine(
  e: MatchEvent,
  name: (id: string) => string,
): Omit<BenchEvent, 'tick' | 'side'> | null {
  switch (e.kind) {
    case 'delivered':
      return { kind: e.kind, text: `${name(e.agent)} delivered ${e.count} (score ${e.score})` };
    case 'picked':
      return e.stolen ? { kind: e.kind, text: `${name(e.agent)} stole an item` } : null;
    case 'knocked_down':
      return {
        kind: e.kind,
        text: `${name(e.agent)} was knocked down by ${e.by}${e.dropped ? `, dropped ${e.dropped}` : ''}`,
      };
    case 'eliminated':
      return { kind: e.kind, text: `${name(e.agent)} was eliminated by ${e.by}` };
    case 'switch':
      return { kind: e.kind, text: `${name(e.agent)} pulled ${e.name}` };
    case 'stunned':
      return { kind: e.kind, text: `${name(e.agent)} was stunned by ${name(e.by)}` };
    case 'shocked':
      return { kind: e.kind, text: `${name(e.agent)} was shocked by ${e.by}` };
    case 'bluff':
      return {
        kind: e.kind,
        text: `${name(e.agent)} bluffed ${name(e.victim)}${e.believed ? ' (believed)' : ''}`,
      };
    case 'dug':
      return e.done ? { kind: e.kind, text: `${name(e.agent)} dug through` } : null;
    case 'supply_drop':
      return { kind: e.kind, text: 'A supply drop landed' };
    default:
      return null;
  }
}

export async function processBenchRun(
  deps: BenchmarkDeps,
  runId: string,
  attempt: BenchmarkAttempt = { attemptsMade: 0, attempts: 1 },
): Promise<BenchmarkOutcome> {
  const { repos, logger, brain } = deps;
  const out = (status: BenchmarkOutcome['status'], extra: Partial<BenchmarkOutcome> = {}) => ({
    kind: 'bench' as const,
    id: runId,
    status,
    ...extra,
  });

  // A retried or stalled job takes over the row its earlier attempt left running.
  let run = await repos.bench.claim(runId);
  if (!run) {
    const cur = await repos.bench.get(runId);
    if (cur?.status === 'running') run = cur;
  }
  if (!run) {
    logger.info('bench run skipped', { runId, reason: 'not_queued' });
    return out('skipped', { reason: 'not_queued' });
  }

  const fail = async (code: string) => {
    await repos.bench.finish(runId, { status: 'failed', brain: brain.kind, error: code });
    logger.warn('bench run failed', { runId, code });
    return out('failed', { reason: code });
  };

  const def = MAPS_V2.find((m) => m.id === run.mapId);
  const difficulty = run.difficulty as Difficulty;
  if (!def) return fail('map_not_found');
  if (!DIFFICULTIES.includes(difficulty)) return fail('bad_difficulty');
  const version = await repos.skills.get(run.skillId, run.version);
  if (!version) return fail('skill_not_found');

  const free = brain.kind === 'greedy';
  const role = benchRole(version);
  const tested: AgentSpec = {
    id: BENCH_AGENT_ID,
    name: 'You',
    role,
    vision: 3,
    comms: 3,
    tier: 'standard',
  };
  const holdId = `bench-${runId}-${attempt.attemptsMade}`;
  let held = false;

  try {
    const sealed = repos.bench.sealedOf(run) ?? (await repos.skills.loadSealed(run.skillId, run.version));
    if (!sealed) return await fail('skill_not_found');
    const text = await deps.vault.decryptSkill(sealed);
    // As matches play it (realtime's roster, the benchmark): the prompt, only on ticks the
    // version's trigger holds.
    const context = { skills: [text.prompt], skillTriggers: [version.trigger ?? null] };

    if (!free) {
      const amount = holdFor([tested], false);
      const h = await repos.ledger.hold({ accountId: run.accountId, runId: holdId, stepLimit: amount, agents: 1 });
      if (!h.ok) {
        if (h.error === 'insufficient_credits' || h.error === 'free_budget_exhausted') {
          await repos.bench.finish(runId, {
            status: 'insufficient_credits',
            brain: brain.kind,
            error: h.error,
            result: { need: h.need ?? amount, have: h.have ?? 0 },
          });
          logger.info('bench run needs credits', { runId, need: h.need ?? amount });
          return out('insufficient_credits', { reason: h.error });
        }
        throw new WorkerError(h.error, `bench hold refused: ${h.error}`);
      }
      held = true;
    }

    const bot = botCrew(1, 'bot');
    const names = new Map<string, string>([[tested.id, tested.name], ...bot.map((b) => [b.id, b.name] as [string, string])]);
    const name = (id: string) => names.get(id) ?? id;
    const events: BenchEvent[] = [];
    let dropped = 0;
    let last: MatchState | undefined;
    const r: HeadlessResult = await playHeadless({
      def,
      difficulty,
      crews: { A: [tested], B: bot },
      brains: { A: brain, B: createGreedyBrain() },
      contexts: { [tested.id]: context },
      seed: `${def.id}:${difficulty}`,
      onTick: (ev, s) => {
        last = s as MatchState;
        for (const e of ev) {
          const line = benchEventLine(e, name);
          if (!line) continue;
          if (events.length >= BENCH_EVENTS_MAX) {
            dropped++;
            continue;
          }
          const agent = 'agent' in e ? e.agent : null;
          const side = agent === null ? 'map' : agent === tested.id ? 'you' : 'bot';
          events.push({ tick: s.tick, side, ...line });
        }
      },
    });

    let credits = 0;
    if (held) {
      credits = holdFor([tested], false, r.ticks);
      if (credits > 0) {
        const c = await repos.ledger.chargeTurns(
          holdId,
          Array.from({ length: credits }, () => ({ agent: 0, reason: null })),
        );
        if (!c.ok) logger.warn('bench charge failed', { runId, code: c.error });
      }
      const st = await repos.ledger.settle(holdId);
      if (!st.ok) logger.warn('bench settle failed', { runId, code: st.error });
      held = false;
    }

    const w = r.result.winner;
    const result: BenchRunResult = {
      seed: `${def.id}:${difficulty}`,
      mapId: def.id,
      difficulty,
      role,
      outcome: w === 'draw' ? 'draw' : w === 'A' ? 'win' : 'loss',
      reason: r.result.reason,
      decidedBy: r.result.decidedBy,
      score: { you: r.score.A, bot: r.score.B },
      ticks: r.ticks,
      logHash: r.logHash,
      talk: {
        says: r.stats.A.says,
        leaks: r.stats.A.refused.leak,
        abuse: r.stats.A.refused.abuse,
        empty: r.stats.A.refused.empty,
      },
      calls: r.stats.A.calls,
      events,
      eventsDropped: dropped,
      debrief: crewReport(last!, 'A', difficulty),
    };
    await repos.bench.finish(runId, { status: 'done', brain: brain.kind, credits, result });
    logger.info('bench run done', {
      runId,
      outcome: result.outcome,
      ticks: result.ticks,
      brain: brain.kind,
      credits,
    });
    return out('done', { score: result.score.you });
  } catch (err) {
    // Whatever was held comes back before a retry (the next attempt holds afresh).
    if (held) await repos.ledger.abort(holdId).catch(() => undefined);
    const final = attempt.attemptsMade + 1 >= attempt.attempts;
    logger.warn('bench run failed', { runId, code: errorCode(err), last: final });
    if (final)
      await repos.bench
        .finish(runId, { status: 'failed', brain: brain.kind, error: errorCode(err) })
        .catch(() => undefined);
    throw err;
  }
}
