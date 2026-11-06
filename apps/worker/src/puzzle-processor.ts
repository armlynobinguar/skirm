// Puzzle mode: `benchmarks` job `{ kind: 'puzzle', runId }` plays one puzzle run headless (the
// decision engine's playPuzzle): the player's own agents with the skills they carry, against the
// inert rock crew, until the puzzle is solved or failed. The same match loop as a live game.
//
// Credits follow the bench: on the greedy brain nothing is called and nothing is held, so a run is
// free. With a model the run holds the crew for the puzzle's tick cap on the ledger
// (`puzzle-<runId>-<attempt>`, free allowance first), charges the ticks it played and settles; a run
// that cannot cover the hold ends `insufficient_credits` with nothing played. A failed attempt
// returns its hold before BullMQ retries.
//
// What a run keeps: solved or not, ticks, score, medal, the log hash and a short timeline of key
// events (no speech text). A solved run updates the player's best for the puzzle (PuzzlesRepo).
import { playPuzzle, type V2AgentContext } from '@skirm/decision-engine/v2';
import { holdFor, puzzleById, type AgentSpec } from '@skirm/engine/v2';
import { skillFitsRole } from '@skirm/shared';
import type { BenchmarkAttempt, BenchmarkDeps, BenchmarkOutcome } from './benchmark-processor';
import { BENCH_EVENTS_MAX, benchEventLine, type BenchEvent } from './bench-processor';
import { WorkerError, errorCode } from './deps';
import { settleRecorded } from './hold-sweep';

/** What a finished run stores in `puzzle_runs.result`. Never any prompt or speech text. */
export interface PuzzleRunResult {
  puzzleId: string;
  solved: boolean;
  /** goal (solved), time (the tick cap ran out) or eliminated (the whole crew was removed). */
  reason: string;
  ticks: number;
  /** Lower is better; null when not solved. */
  score: number | null;
  medal: 'gold' | 'silver' | 'bronze' | null;
  delivered: number;
  knockdowns: number;
  logHash: string;
  /** Whether this run set the player's best for the puzzle. */
  best: boolean;
  crew: { agentId: string; name: string; role: string }[];
  calls: number;
  events: BenchEvent[];
  eventsDropped: number;
}

export async function processPuzzleRun(
  deps: BenchmarkDeps,
  runId: string,
  attempt: BenchmarkAttempt = { attemptsMade: 0, attempts: 1 },
): Promise<BenchmarkOutcome> {
  const { repos, logger, brain, vault } = deps;
  const out = (status: BenchmarkOutcome['status'], extra: Partial<BenchmarkOutcome> = {}) => ({
    kind: 'puzzle' as const,
    id: runId,
    status,
    ...extra,
  });

  // A retried or stalled job takes over the row its earlier attempt left running.
  let run = await repos.puzzles.claim(runId);
  if (!run) {
    const cur = await repos.puzzles.get(runId);
    if (cur?.status === 'running') run = cur;
  }
  if (!run) {
    logger.info('puzzle run skipped', { runId, reason: 'not_queued' });
    return out('skipped', { reason: 'not_queued' });
  }

  const fail = async (code: string) => {
    await repos.puzzles.finish(runId, { status: 'failed', brain: brain.kind, error: code });
    logger.warn('puzzle run failed', { runId, code });
    return out('failed', { reason: code });
  };

  const puzzle = puzzleById(run.puzzleId);
  if (!puzzle) return fail('puzzle_not_found');
  if (run.crew.length < 1 || run.crew.length > puzzle.crewSize) return fail('invalid_crew');

  const free = brain.kind === 'greedy';
  const holdId = `puzzle-${runId}-${attempt.attemptsMade}`;
  let held = false;
  try {
    // The crew as it stands now: each agent still the player's, with the skills the player holds
    // that fit its role (as realtime loads a roster).
    const crew: AgentSpec[] = [];
    const contexts: Record<
      string,
      Pick<V2AgentContext, 'skills' | 'skillTriggers' | 'instructions'>
    > = {};
    for (const c of run.crew) {
      const row = await repos.agents.get(c.agentId);
      const v =
        row && row.ownerId === run.accountId ? await repos.agents.view(c.agentId) : undefined;
      if (!v) return await fail('invalid_crew');
      crew.push({
        id: v.id,
        name: v.name,
        role: v.role,
        vision: v.vision,
        comms: v.comms,
        tier: c.tier,
      });
      const meta = v.skills.length ? await repos.skills.getMany(v.skills) : [];
      const skills: string[] = [];
      const triggers: V2AgentContext['skillTriggers'] = [];
      for (const k of v.skills) {
        const m = meta.find((x) => x.id === k.id && x.version === k.version);
        if (!(await repos.skills.owns(run.accountId, k.id, k.version))) continue;
        if (!skillFitsRole(m?.roles, v.role)) continue;
        const sealed = await repos.skills.loadSealed(k.id, k.version);
        if (!sealed) continue;
        skills.push((await vault.decryptSkill(sealed)).prompt);
        triggers.push(m?.trigger ?? null);
      }
      contexts[v.id] = { skills, skillTriggers: triggers, instructions: v.systemPrompt ?? null };
    }

    if (!free) {
      const amount = holdFor(crew, false, puzzle.cap);
      const h = await repos.ledger.hold({
        accountId: run.accountId,
        runId: holdId,
        stepLimit: amount,
        agents: crew.length,
      });
      if (!h.ok) {
        if (h.error === 'insufficient_credits' || h.error === 'free_budget_exhausted') {
          await repos.puzzles.finish(runId, {
            status: 'insufficient_credits',
            brain: brain.kind,
            error: h.error,
            result: { need: h.need ?? amount, have: h.have ?? 0 },
          });
          logger.info('puzzle run needs credits', { runId, need: h.need ?? amount });
          return out('insufficient_credits', { reason: h.error });
        }
        throw new WorkerError(h.error, `puzzle hold refused: ${h.error}`);
      }
      held = true;
    }

    const names = new Map(crew.map((a) => [a.id, a.name]));
    const name = (id: string) => names.get(id) ?? id;
    const events: BenchEvent[] = [];
    let dropped = 0;
    const r = await playPuzzle({
      puzzle,
      crew,
      brain,
      contexts,
      onTick: (ev, s) => {
        for (const e of ev) {
          const line = benchEventLine(e, name);
          if (!line) continue;
          const agent = 'agent' in e ? e.agent : null;
          // The rock crew never does anything worth a line; skip it all the same.
          if (agent !== null && !names.has(agent)) continue;
          if (events.length >= BENCH_EVENTS_MAX) {
            dropped++;
            continue;
          }
          events.push({ tick: s.tick, side: agent === null ? 'map' : 'you', ...line });
        }
      },
    });

    let credits = 0;
    if (held) {
      credits = holdFor(crew, false, r.ticks);
      if (credits > 0) {
        const c = await repos.ledger.chargeTurns(
          holdId,
          Array.from({ length: credits }, () => ({ agent: 0, reason: null })),
        );
        if (!c.ok) logger.warn('puzzle charge failed', { runId, code: c.error });
      }
      // Settled after finish below (settleRecorded): a retry never charges twice.
    }

    const result: PuzzleRunResult = {
      puzzleId: puzzle.id,
      solved: r.solved,
      reason: r.reason,
      ticks: r.ticks,
      score: r.score,
      medal: r.medal,
      delivered: r.delivered,
      knockdowns: r.knockdowns,
      logHash: r.headless.logHash,
      best: false,
      crew: crew.map((a) => ({ agentId: a.id, name: a.name, role: a.role })),
      calls: r.headless.stats.A.calls,
      events,
      eventsDropped: dropped,
    };
    const solve =
      r.solved && r.score !== null
        ? { score: r.score, ticks: r.ticks, medal: r.medal, logHash: result.logHash }
        : undefined;
    // finish sets result.best (whether this run beat the player's best) in the same transaction.
    await repos.puzzles.finish(runId, {
      status: 'done',
      brain: brain.kind,
      credits,
      result,
      ...(solve ? { solve } : {}),
    });
    if (held) {
      held = false;
      await settleRecorded(deps, holdId, 'puzzle settle failed', { runId });
    }
    logger.info('puzzle run done', {
      runId,
      puzzle: puzzle.id,
      solved: r.solved,
      ticks: r.ticks,
      brain: brain.kind,
      credits,
    });
    return out('done', r.score !== null ? { score: r.score } : {});
  } catch (err) {
    if (held) await repos.ledger.abort(holdId).catch(() => undefined);
    const final = attempt.attemptsMade + 1 >= attempt.attempts;
    logger.warn('puzzle run failed', { runId, code: errorCode(err), last: final });
    if (final)
      await repos.puzzles
        .finish(runId, { status: 'failed', brain: brain.kind, error: errorCode(err) })
        .catch(() => undefined);
    throw err;
  }
}
