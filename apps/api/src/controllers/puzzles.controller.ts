// /puzzles*: puzzle mode (@skirm/engine/v2 PUZZLES). Small hand-made boards with fixed hazards,
// solved by the player's own crew (1 to the puzzle's crew size, with the skills they carry) in as
// few ticks as possible, against no rival. A run plays headless on the worker (`benchmarks` job
// `{ kind: 'puzzle' }`): POST queues it (202) and the client polls GET /puzzles/:id/runs/:runId.
// Free on the greedy brain; with a model a run holds the crew for the puzzle's tick cap at its talk
// rate and pays the ticks it played (the worker holds it). At most PUZZLE_RUNS_PER_HOUR runs per
// account per rolling hour: 429 `puzzle_limit`. The board (GET /puzzles/:id/leaderboard) is public.
import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { V2_TALK_TIERS, type AccountRow, type PuzzleBestRow, type PuzzleCrewEntry, type PuzzleRunRow } from '@skirm/db';
import { v2BrainKind } from '@skirm/decision-engine/v2';
import { PUZZLES, PUZZLE_RUNS_PER_HOUR, holdFor, puzzleById, puzzleGoal, type PuzzleDef } from '@skirm/engine/v2';
import { z } from 'zod';
import { CurrentAccount, Public, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError, notFound } from '../errors';
import { agentId, parse } from '../validation';
import { idOr404 } from './util';

const runId = z.string().regex(/^pzr_[0-9A-HJKMNP-TV-Z]{26}$/);
const runBody = z.object({
  crew: z
    .array(z.object({ agentId, tier: z.enum(V2_TALK_TIERS).optional() }))
    .min(1)
    .max(3),
});

const iso = (d: Date | null) => (d ? d.toISOString() : null);

@Controller('puzzles')
export class PuzzlesController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  private get free(): boolean {
    return v2BrainKind(this.deps.config) === 'greedy';
  }

  /** Credits a run holds for a crew of `size` Standard agents (0 on the greedy brain). */
  private costOf(p: PuzzleDef, size = 1): number {
    return this.free ? 0 : holdFor(Array.from({ length: size }, () => ({ tier: 'standard' as const })), false, p.cap);
  }

  private puzzle(id: string): PuzzleDef {
    const p = puzzleById(id);
    if (!p) throw notFound('puzzle');
    return p;
  }

  /** Every puzzle with its par, medals and the caller's best, plus the brain, cost and hourly cap. */
  @Get()
  async list(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { puzzles } = this.deps.repos;
    const [bests, used] = await Promise.all([puzzles.bests(account.id), puzzles.usedInWindow(account.id)]);
    const byId = new Map(bests.map((b) => [b.puzzleId, b]));
    return {
      brain: v2BrainKind(this.deps.config),
      free: this.free,
      limit: { perHour: PUZZLE_RUNS_PER_HOUR, used, left: Math.max(0, PUZZLE_RUNS_PER_HOUR - used) },
      puzzles: PUZZLES.map((p) => this.puzzleView(p, byId.get(p.id))),
      medals: {
        gold: bests.filter((b) => b.medal === 'gold').length,
        silver: bests.filter((b) => b.medal === 'silver').length,
        bronze: bests.filter((b) => b.medal === 'bronze').length,
        solved: bests.length,
        total: PUZZLES.length,
      },
    };
  }

  /** One puzzle with its board (the layout to preview), the caller's best and recent runs. */
  @Get(':id')
  async one(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const p = this.puzzle(id);
    const { puzzles } = this.deps.repos;
    const [bests, runs] = await Promise.all([puzzles.bests(account.id), puzzles.list(account.id, p.id, 10)]);
    return {
      ...this.puzzleView(p, bests.find((b) => b.puzzleId === p.id)),
      board: {
        layout: p.layout,
        w: p.layout[0]!.length,
        h: p.layout.length,
        hazards: p.hazards,
        blockSupply: p.blockSupply,
      },
      runs: runs.map((r) => this.runView(r)),
    };
  }

  /** Queues a run of the caller's crew (202). 403 for an agent that is not the caller's. */
  @Post(':id/runs')
  @HttpCode(202)
  async start(@Param('id') id: string, @Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const p = this.puzzle(id);
    const b = parse(runBody, body);
    const { repos, benchmarkQueue } = this.deps;
    if (b.crew.length > p.crewSize)
      throw new ApiError(400, 'invalid_crew', `${p.title} takes at most ${p.crewSize} agent${p.crewSize === 1 ? '' : 's'}`);
    if (new Set(b.crew.map((c) => c.agentId)).size !== b.crew.length) throw new ApiError(400, 'invalid_crew', 'an agent is listed twice');
    const rows = await Promise.all(b.crew.map((c) => repos.agents.get(c.agentId)));
    if (rows.some((r) => !r || r.ownerId !== account.id)) throw new ApiError(403, 'forbidden', 'every agent must be yours');
    // The agent's own talk tier unless the request picks one.
    const tierOf = (t: string | undefined): PuzzleCrewEntry['tier'] => ((V2_TALK_TIERS as readonly string[]).includes(t ?? '') ? (t as PuzzleCrewEntry['tier']) : 'standard');
    const crew = b.crew.map((c, i) => ({ agentId: c.agentId, tier: c.tier ?? tierOf(rows[i]!.tier) }));
    const run = await repos.puzzles.create({ accountId: account.id, puzzleId: p.id, crew, limit: PUZZLE_RUNS_PER_HOUR });
    try {
      await benchmarkQueue.enqueue({ kind: 'puzzle', runId: run.id });
    } catch {
      await repos.puzzles.finish(run.id, { status: 'failed', error: 'queue_unavailable' });
      throw new ApiError(503, 'queue_unavailable', 'puzzle runs are paused, try again shortly');
    }
    return this.runView(run);
  }

  /** One of the caller's runs of this puzzle (poll it until `status` is no longer queued or running). */
  @Get(':id/runs/:runId')
  async run(@Param('id') id: string, @Param('runId') rid: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const p = this.puzzle(id);
    const run = await this.deps.repos.puzzles.get(idOr404(runId, rid, 'puzzle run'));
    // Someone else's run is as good as missing.
    if (!run || run.accountId !== account.id || run.puzzleId !== p.id) throw notFound('puzzle run');
    return this.runView(run);
  }

  /** The puzzle's board: each player's best, lowest score first (ties share a rank). */
  @Public()
  @Get(':id/leaderboard')
  async leaderboard(@Param('id') id: string) {
    const p = this.puzzle(id);
    const rows = await this.deps.repos.puzzles.leaderboard(p.id, 50);
    return {
      puzzleId: p.id,
      par: p.medals.gold,
      medals: p.medals,
      entries: rows.map((r) => ({ ...r, achievedAt: r.achievedAt.toISOString() })),
    };
  }

  private puzzleView(p: PuzzleDef, best: PuzzleBestRow | undefined) {
    const g = puzzleGoal(p);
    return {
      id: p.id,
      n: p.n,
      title: p.title,
      briefing: p.briefing,
      goal: g,
      crewSize: p.crewSize,
      cap: p.cap,
      /** The gold threshold: the designer's par. */
      par: p.medals.gold,
      medals: p.medals,
      item: p.item,
      deliverTo: p.deliverTo,
      costCredits: this.costOf(p),
      best: best
        ? {
            score: best.score,
            ticks: best.ticks,
            medal: best.medal,
            runId: best.runId,
            logHash: best.logHash,
            brain: best.brain,
            solves: best.solves,
            achievedAt: best.achievedAt.toISOString(),
          }
        : null,
    };
  }

  private runView(r: PuzzleRunRow) {
    return {
      id: r.id,
      puzzleId: r.puzzleId,
      crew: r.crew,
      status: r.status,
      brain: r.brain,
      credits: r.credits,
      result: r.status === 'done' ? r.result : null,
      /** insufficient_credits: `{ need, have }`. */
      shortfall: r.status === 'insufficient_credits' ? r.result : null,
      error: r.error,
      createdAt: iso(r.createdAt),
      finishedAt: iso(r.finishedAt),
    };
  }
}
