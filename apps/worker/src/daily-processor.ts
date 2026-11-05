// Daily challenge consumer: `benchmarks` job `{ kind: 'daily', attemptId }` plays one player's
// crew (as snapshotted when the attempt was queued) against the greedy bot on the UTC day's
// challenge (dailyChallenge(date): map, difficulty, bot crew and twist), headless, with the same
// match loop as a live game (playHeadless). The attempt keeps its points (dailyPoints), outcome,
// ticks and the log hash: on the greedy brain the same crew on the same day replays to that hash.
//
// Credits follow practice and the bench: on the greedy brain nothing is called or held, so an
// attempt is free. With a model the crew's talk rate is held for the challenge clock on the ledger
// (`daily-<attemptId>-<attempt>`, free allowance first), the ticks played are charged and the hold
// settles; an attempt that cannot cover the hold ends `insufficient_credits` without playing (and
// does not use up one of the day's attempts). A failed attempt returns its hold before a retry.
//
// Skills play as in a live match: only versions the player still owns and that fit the agent's
// role, decrypted for the run and never stored. The agent's own instructions are read as they
// stand when the attempt runs.
import type { DailyAttemptRow } from '@skirm/db';
import { createGreedyBrain, playHeadless, type HeadlessOptions, type HeadlessResult, type V2AgentContext } from '@skirm/decision-engine/v2';
import {
  MAPS_V2,
  ROLES,
  botCrew,
  dailyChallenge,
  dailyMatchOptions,
  dailyPoints,
  holdFor,
  type AgentSpec,
  type DailyChallenge,
  type Role,
  type TalkTier,
} from '@skirm/engine/v2';
import { skillFitsRole } from '@skirm/shared';
import type { BenchmarkAttempt, BenchmarkDeps, BenchmarkOutcome } from './benchmark-processor';
import { WorkerError, errorCode } from './deps';

/** What a finished attempt stores in `daily_attempts.result`. No prompt or speech text. */
export interface DailyAttemptResult {
  seed: string;
  mapId: string;
  difficulty: string;
  twist: string;
  outcome: 'win' | 'loss' | 'draw';
  reason: string;
  decidedBy: string;
  score: { you: number; bot: number };
  ticks: number;
  /** The challenge clock the speed bonus counts from. */
  clock: number;
  points: number;
  logHash: string;
  /** Model calls back in time (0 on greedy). */
  calls: number;
}

const TIERS: readonly TalkTier[] = ['quiet', 'standard', 'open'];

/** The crew of an attempt as engine agents (the snapshot's ids, names and attributes). */
export function dailyCrew(row: Pick<DailyAttemptRow, 'crew'>): AgentSpec[] {
  return row.crew.map((c) => ({
    id: c.agentId,
    name: c.name,
    role: ((ROLES as readonly string[]).includes(c.role) ? c.role : ROLES[0]) as Role,
    vision: c.vision,
    comms: c.comms,
    tier: (TIERS as readonly string[]).includes(c.tier) ? (c.tier as TalkTier) : 'standard',
  }));
}

export async function processDailyAttempt(
  deps: BenchmarkDeps,
  attemptId: string,
  attempt: BenchmarkAttempt = { attemptsMade: 0, attempts: 1 },
): Promise<BenchmarkOutcome> {
  const { repos, logger, brain } = deps;
  const out = (status: BenchmarkOutcome['status'], extra: Partial<BenchmarkOutcome> = {}) => ({
    kind: 'daily' as const,
    id: attemptId,
    status,
    ...extra,
  });

  // A retried or stalled job takes over the row its earlier attempt left running.
  let row = await repos.daily.claim(attemptId);
  if (!row) {
    const cur = await repos.daily.get(attemptId);
    if (cur?.status === 'running') row = cur;
  }
  if (!row) {
    logger.info('daily attempt skipped', { attemptId, reason: 'not_queued' });
    return out('skipped', { reason: 'not_queued' });
  }

  const fail = async (code: string) => {
    await repos.daily.finish(attemptId, { status: 'failed', brain: brain.kind, error: code });
    logger.warn('daily attempt failed', { attemptId, code });
    return out('failed', { reason: code });
  };

  let challenge: DailyChallenge;
  try {
    challenge = dailyChallenge(row.date);
  } catch {
    return fail('bad_date');
  }
  const def = MAPS_V2.find((m) => m.id === challenge.mapId);
  if (!def) return fail('map_not_found');
  const crew = dailyCrew(row);
  if (crew.length < 1 || crew.length > challenge.crewSize) return fail('invalid_crew');

  const free = brain.kind === 'greedy';
  const holdId = `daily-${attemptId}-${attempt.attemptsMade}`;
  let held = false;

  try {
    // Skills and instructions as a live match loads them (realtime's roster).
    const contexts: NonNullable<HeadlessOptions['contexts']> = {};
    for (const c of row.crew) {
      const agent = await repos.agents.view(c.agentId);
      const keys = c.skills.map((k) => ({ id: k.id, version: k.version }));
      const meta = keys.length ? await repos.skills.getMany(keys) : [];
      const skills: string[] = [];
      const triggers: NonNullable<V2AgentContext['skillTriggers']> = [];
      for (const k of keys) {
        const m = meta.find((x) => x.id === k.id && x.version === k.version);
        if (!m || !skillFitsRole(m.roles, c.role)) continue;
        if (!(await repos.skills.owns(row.accountId, k.id, k.version))) continue;
        const sealed = await repos.skills.loadSealed(k.id, k.version);
        if (!sealed) continue;
        skills.push((await deps.vault.decryptSkill(sealed)).prompt);
        triggers.push(m.trigger ?? null);
      }
      contexts[c.agentId] = { skills, skillTriggers: triggers, instructions: agent?.systemPrompt ?? null };
    }

    if (!free) {
      const amount = holdFor(crew, false, challenge.ticks);
      const h = await repos.ledger.hold({ accountId: row.accountId, runId: holdId, stepLimit: amount, agents: 1 });
      if (!h.ok) {
        if (h.error === 'insufficient_credits' || h.error === 'free_budget_exhausted') {
          await repos.daily.finish(attemptId, {
            status: 'insufficient_credits',
            brain: brain.kind,
            error: h.error,
            result: { need: h.need ?? amount, have: h.have ?? 0 },
          });
          logger.info('daily attempt needs credits', { attemptId, need: h.need ?? amount });
          return out('insufficient_credits', { reason: h.error });
        }
        throw new WorkerError(h.error, `daily hold refused: ${h.error}`);
      }
      held = true;
    }

    const r: HeadlessResult = await playHeadless({
      def,
      difficulty: challenge.difficulty,
      crews: { A: crew, B: botCrew(challenge.crewSize, 'bot', challenge.bot.tier) },
      brains: { A: brain, B: createGreedyBrain() },
      contexts,
      seed: `daily:${challenge.date}:${challenge.seed}`,
      match: dailyMatchOptions(challenge),
    });

    let credits = 0;
    if (held) {
      credits = holdFor(crew, false, r.ticks);
      if (credits > 0) {
        const c = await repos.ledger.chargeTurns(
          holdId,
          Array.from({ length: credits }, () => ({ agent: 0, reason: null })),
        );
        if (!c.ok) logger.warn('daily charge failed', { attemptId, code: c.error });
      }
      const st = await repos.ledger.settle(holdId);
      if (!st.ok) logger.warn('daily settle failed', { attemptId, code: st.error });
      held = false;
    }

    const w = r.result.winner;
    const outcome = w === 'draw' ? 'draw' : w === 'A' ? 'win' : 'loss';
    const points = dailyPoints({ outcome, you: r.score.A, bot: r.score.B, ticks: r.ticks, clock: challenge.ticks });
    const result: DailyAttemptResult = {
      seed: challenge.seed,
      mapId: challenge.mapId,
      difficulty: challenge.difficulty,
      twist: challenge.twist,
      outcome,
      reason: r.result.reason,
      decidedBy: r.result.decidedBy,
      score: { you: r.score.A, bot: r.score.B },
      ticks: r.ticks,
      clock: challenge.ticks,
      points,
      logHash: r.logHash,
      calls: r.stats.A.calls,
    };
    await repos.daily.finish(attemptId, {
      status: 'done',
      brain: brain.kind,
      credits,
      points,
      outcome,
      ticks: r.ticks,
      logHash: r.logHash,
      result,
    });
    logger.info('daily attempt done', { attemptId, outcome, points, ticks: r.ticks, brain: brain.kind, credits });
    return out('done', { score: points });
  } catch (err) {
    if (held) await repos.ledger.abort(holdId).catch(() => undefined);
    const final = attempt.attemptsMade + 1 >= attempt.attempts;
    logger.warn('daily attempt failed', { attemptId, code: errorCode(err), last: final });
    if (final)
      await repos.daily
        .finish(attemptId, { status: 'failed', brain: brain.kind, error: errorCode(err) })
        .catch(() => undefined);
    throw err;
  }
}
