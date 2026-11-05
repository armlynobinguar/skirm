// /daily* : the daily challenge. Every UTC day one challenge comes from the date alone
// (@skirm/engine dailyChallenge: a practice map, a difficulty, the bot's crew size and a twist).
// A player queues an attempt with their own crew (1 up to the bot's size, built-in brain only); the
// worker plays it headless against the greedy bot (`benchmarks` job `{ kind: 'daily' }`). Free on
// the greedy brain; with a model an attempt pays the crew's talk rate (the worker holds it).
// At most DAILY_ATTEMPTS (DEFAULTS.daily.attemptsPerDay) attempts that played per account per UTC
// day: 429 `daily_limit`. The board is each player's best finished attempt of the day.
import { Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import type { AccountRow, DailyAttemptRow, DailyBoardRow, DailyCrewRecord } from '@skirm/db';
import { v2BrainKind } from '@skirm/decision-engine/v2';
import {
  DAILY_TWISTS,
  MAPS_V2,
  dailyChallenge,
  dailyDate,
  dailyMsLeft,
  holdFor,
  isDailyDate,
  type DailyChallenge,
  type TalkTier,
} from '@skirm/engine/v2';
import { DEFAULTS } from '@skirm/shared';
import { z } from 'zod';
import { CurrentAccount, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError } from '../errors';
import { agentId, parse } from '../validation';

const attemptBody = z.object({
  /** The crew to run (default: your first agents, as many as the challenge takes). */
  agentIds: z.array(agentId).min(1).max(3).optional(),
});
const boardQuery = z.object({
  date: z.preprocess((v) => (v === '' ? undefined : v), z.string().refine(isDailyDate, 'YYYY-MM-DD').optional()),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

@Controller('daily')
export class DailyController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  private get limit(): number {
    return this.deps.config.DAILY_ATTEMPTS ?? DEFAULTS.daily.attemptsPerDay;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Today's challenge, what an attempt costs, the caller's attempts and the time left. */
  @Get()
  async today(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const now = this.now();
    const date = dailyDate(now);
    const c = dailyChallenge(date);
    const brain = v2BrainKind(this.deps.config);
    const [rows, used] = await Promise.all([
      this.deps.repos.daily.listOn(account.id, date),
      this.deps.repos.daily.usedOn(account.id, date),
    ]);
    return {
      challenge: challengeView(c),
      brain,
      free: brain === 'greedy',
      /** Credits a full crew holds for the challenge clock with a model brain (0 when free). */
      costCredits: brain === 'greedy' ? 0 : holdFor(Array.from({ length: c.crewSize }, () => ({ tier: 'standard' as TalkTier })), false, c.ticks),
      attempts: { perDay: this.limit, used, left: Math.max(0, this.limit - used) },
      msLeft: dailyMsLeft(now),
      endsAt: new Date(now.getTime() + dailyMsLeft(now)).toISOString(),
      mine: rows.map(attemptView),
    };
  }

  /** Queues an attempt on today's challenge with the caller's crew (202). */
  @Post('attempts')
  @HttpCode(202)
  async attempt(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const b = parse(attemptBody, body);
    const { repos, benchmarkQueue } = this.deps;
    const date = dailyDate(this.now());
    const c = dailyChallenge(date);

    const mine = await repos.agents.listByOwner(account.id);
    let picked;
    if (b.agentIds) {
      if (new Set(b.agentIds).size !== b.agentIds.length) throw new ApiError(400, 'invalid_crew', 'an agent is listed twice');
      picked = b.agentIds.map((id) => mine.find((a) => a.id === id));
      if (picked.some((a) => !a)) throw new ApiError(400, 'invalid_crew', 'every agent must be yours');
    } else {
      picked = mine.slice(0, c.crewSize);
    }
    const crewAgents = picked.filter((a): a is NonNullable<typeof a> => !!a);
    if (!crewAgents.length) throw new ApiError(400, 'invalid_crew', 'you have no agents yet');
    if (crewAgents.length > c.crewSize)
      throw new ApiError(400, 'invalid_crew', `today's challenge takes at most ${c.crewSize} agents`);
    // A board is for the built-in brain: an agent your own program plays sits this out.
    const bound = await repos.externalAgents.boundTo(account.id, crewAgents.map((a) => a.id));
    if (bound.length) throw new ApiError(400, 'invalid_crew', 'an agent played by an external agent cannot run the daily challenge');

    const crew: DailyCrewRecord[] = crewAgents.map((a) => ({
      agentId: a.id,
      name: a.name,
      role: a.role,
      vision: a.vision,
      comms: a.comms,
      tier: a.tier,
      skills: a.skills.map((s) => ({ id: s.id, version: s.version, name: s.name })),
    }));
    const row = await repos.daily.create({
      accountId: account.id,
      date,
      seed: c.seed,
      mapId: c.mapId,
      difficulty: c.difficulty,
      twist: c.twist,
      crew,
      limit: this.limit,
    });
    try {
      await benchmarkQueue.enqueue({ kind: 'daily', attemptId: row.id });
    } catch {
      await repos.daily.finish(row.id, { status: 'failed', error: 'queue_unavailable' });
      throw new ApiError(503, 'queue_unavailable', 'the daily challenge is paused, try again shortly');
    }
    return attemptView(row);
  }

  /** A day's board (today by default): the top `limit` best attempts and the caller's rank. */
  @Get('leaderboard')
  async leaderboard(@Query() query: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const q = parse(boardQuery, query);
    const today = dailyDate(this.now());
    const date = q.date ?? today;
    if (date > today) throw new ApiError(400, 'invalid_request', 'that day has not started');
    const n = q.limit ?? DEFAULTS.daily.boardSize;
    const board = await this.deps.repos.daily.board(date);
    const at = board.findIndex((r) => r.accountId === account.id);
    return {
      date,
      challenge: challengeView(dailyChallenge(date)),
      players: board.length,
      top: board.slice(0, n).map((r, i) => boardView(r, i + 1, account.id)),
      me: at < 0 ? null : boardView(board[at]!, at + 1, account.id),
    };
  }
}

function challengeView(c: DailyChallenge) {
  const map = MAPS_V2.find((m) => m.id === c.mapId);
  return {
    ...c,
    mapName: map?.name ?? c.mapId,
    twistName: DAILY_TWISTS[c.twist].name,
    twistLine: DAILY_TWISTS[c.twist].line,
  };
}

function crewView(crew: DailyCrewRecord[]) {
  return crew.map((a) => ({ name: a.name, role: a.role, skills: a.skills.map((s) => s.name) }));
}

function attemptView(r: DailyAttemptRow) {
  return {
    id: r.id,
    date: r.date,
    status: r.status,
    brain: r.brain,
    credits: r.credits,
    crew: crewView(r.crew),
    points: r.points,
    outcome: r.outcome,
    ticks: r.ticks,
    logHash: r.logHash,
    result: r.status === 'done' ? r.result : null,
    /** insufficient_credits: `{ need, have }`. */
    shortfall: r.status === 'insufficient_credits' ? r.result : null,
    error: r.error,
    createdAt: new Date(r.createdAt).toISOString(),
    finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
  };
}

function boardView(r: DailyBoardRow, rank: number, me: string) {
  return {
    rank,
    attemptId: r.attemptId,
    handle: r.handle,
    you: r.accountId === me,
    points: r.points,
    outcome: r.outcome,
    ticks: r.ticks,
    logHash: r.logHash,
    crew: crewView(r.crew),
    finishedAt: r.finishedAt.toISOString(),
  };
}
