// /bench* : the writers' skill test bench. A writer runs a skill version (a draft they wrote, or a
// minted version they hold) on any map and difficulty against the greedy bot, headless on the
// worker (`benchmarks` job `{ kind: 'bench' }`), optionally with an edited prompt draft that is
// sealed on the run like a skill version. Free on the greedy brain; with a model a run pays one
// Standard agent at the talk rate (the worker holds it). At most `BENCH_RUNS_PER_HOUR`
// (DEFAULTS.bench.runsPerHour) runs per account per rolling hour: 429 `bench_limit`.
//
// Hidden-prompt rule: a run's prompt text comes back only to the account that ran it, and only
// when it is that account's own text (a draft they typed, or a version they wrote). A bought
// version plays, but its text and its diff stay hidden.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import type { AccountRow, SkillBenchRunRow, SkillVersionView } from '@skirm/db';
import { v2BrainKind } from '@skirm/decision-engine/v2';
import { DIFFICULTIES, MAPS_V2, holdFor, type Difficulty } from '@skirm/engine/v2';
import { DEFAULTS } from '@skirm/shared';
import { z } from 'zod';
import { CurrentAccount, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError, notFound } from '../errors';
import { diffWords } from '../text-diff';
import { parse, skillId } from '../validation';
import { idOr404 } from './util';

const runId = z.string().regex(/^bnr_[0-9A-HJKMNP-TV-Z]{26}$/);
const MAP_IDS = MAPS_V2.map((m) => m.id) as [string, ...string[]];

const runBody = z.object({
  skillId,
  version: z.number().int().min(1).max(1_000_000).optional(),
  mapId: z.enum(MAP_IDS),
  difficulty: z.enum(DIFFICULTIES as unknown as [Difficulty, ...Difficulty[]]),
  /** An edited prompt draft to play instead of the version's own (the writer's own skills only). */
  prompt: z.string().min(1).max(1200).optional(),
  reflexes: z.string().max(400).nullish(),
});
const listQuery = z.object({
  skillId: z.preprocess((v) => (v === '' ? undefined : v), skillId.optional()),
});
const compareQuery = z.object({ a: runId, b: runId });

/** The bench's tested agent: one Standard agent for the whole match. */
const BENCH_CREW = [{ tier: 'standard' as const }];

@Controller('bench')
export class BenchController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  private get limit(): number {
    return this.deps.config.BENCH_RUNS_PER_HOUR ?? DEFAULTS.bench.runsPerHour;
  }

  /** What a run costs here and how many the caller has left this hour. */
  @Get()
  async info(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const brain = v2BrainKind(this.deps.config);
    const used = await this.deps.repos.bench.usedInWindow(account.id);
    return {
      brain,
      free: brain === 'greedy',
      costCredits: brain === 'greedy' ? 0 : holdFor(BENCH_CREW, false),
      limit: { perHour: this.limit, used, left: Math.max(0, this.limit - used) },
    };
  }

  /** Queues one run (202). 403 for a version the caller neither wrote as a draft nor holds. */
  @Post('runs')
  @HttpCode(202)
  async start(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const b = parse(runBody, body);
    const { repos, vault, benchmarkQueue } = this.deps;
    const v = await repos.skills.get(b.skillId, b.version);
    if (!v) throw notFound('skill');
    const mine = v.creatorId === account.id;
    const held = await repos.skills.owns(account.id, v.id, v.version);
    if (!(held || (mine && v.status === 'draft')))
      throw new ApiError(403, 'forbidden', 'bench a draft you wrote or a version you hold');
    if (b.prompt !== undefined && !mine)
      throw new ApiError(403, 'forbidden', 'only the writer can edit this prompt');
    const sealed =
      b.prompt !== undefined ? await vault.encryptSkill(b.prompt, b.reflexes ?? undefined) : undefined;
    const run = await repos.bench.create({
      accountId: account.id,
      skillId: v.id,
      version: v.version,
      mapId: b.mapId,
      difficulty: b.difficulty,
      limit: this.limit,
      ...(sealed ? { sealed } : {}),
    });
    try {
      await benchmarkQueue.enqueue({ kind: 'bench', runId: run.id });
    } catch {
      await repos.bench.finish(run.id, { status: 'failed', error: 'queue_unavailable' });
      throw new ApiError(503, 'queue_unavailable', 'the bench is paused, try again shortly');
    }
    return this.view(run, v);
  }

  /** The caller's runs (of one skill, or all), newest first. */
  @Get('runs')
  async list(@Query() query: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const q = parse(listQuery, query);
    const rows = await this.deps.repos.bench.list(account.id, q.skillId);
    const versions = await this.versions(rows);
    return rows.map((r) => this.view(r, versions.get(`${r.skillId}:${r.version}`)));
  }

  /** One of the caller's runs, with the prompt that played when it is the caller's own text. */
  @Get('runs/:id')
  async one(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const run = await this.own(account, id);
    const v = await this.deps.repos.skills.get(run.skillId, run.version);
    const text = await this.promptOf(account, run, v);
    return { ...this.view(run, v), prompt: text?.prompt ?? null, reflexes: text?.reflexes ?? null, promptHidden: !text };
  }

  /** Two of the caller's runs side by side, and a word diff of the prompts that played (a → b). */
  @Get('compare')
  async compare(@Query() query: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const q = parse(compareQuery, query);
    const [ra, rb] = await Promise.all([this.own(account, q.a), this.own(account, q.b)]);
    const versions = await this.versions([ra, rb]);
    const va = versions.get(`${ra.skillId}:${ra.version}`);
    const vb = versions.get(`${rb.skillId}:${rb.version}`);
    const [ta, tb] = await Promise.all([this.promptOf(account, ra, va), this.promptOf(account, rb, vb)]);
    const full = (t: { prompt: string; reflexes: string | null }) =>
      t.reflexes ? `${t.prompt}\n\n${t.reflexes}` : t.prompt;
    const hidden = !ta || !tb;
    return {
      a: this.view(ra, va),
      b: this.view(rb, vb),
      prompt: hidden
        ? { hidden: true, same: null, diff: null }
        : { hidden: false, same: full(ta) === full(tb), diff: diffWords(full(ta), full(tb)) },
    };
  }

  private async own(account: AccountRow, id: string): Promise<SkillBenchRunRow> {
    const rid = idOr404(runId, id, 'bench run');
    const run = await this.deps.repos.bench.get(rid);
    // Someone else's run is as good as missing.
    if (!run || run.accountId !== account.id) throw notFound('bench run');
    return run;
  }

  private async versions(rows: readonly SkillBenchRunRow[]) {
    const keys = [...new Map(rows.map((r) => [`${r.skillId}:${r.version}`, { id: r.skillId, version: r.version }])).values()];
    const vs = keys.length ? await this.deps.repos.skills.getMany(keys) : [];
    return new Map(vs.map((v) => [`${v.id}:${v.version}`, v]));
  }

  /** The text that played, when it is the caller's own: their sealed draft, or a version they wrote. */
  private async promptOf(account: AccountRow, run: SkillBenchRunRow, v: SkillVersionView | undefined) {
    const { repos, vault } = this.deps;
    const draft = repos.bench.sealedOf(run);
    const sealed = draft ?? (v && v.creatorId === account.id ? await repos.skills.loadSealed(run.skillId, run.version) : undefined);
    if (!sealed) return null;
    const t = await vault.decryptSkill(sealed);
    return { prompt: t.prompt, reflexes: t.reflexes ?? null };
  }

  private view(r: SkillBenchRunRow, v: SkillVersionView | undefined) {
    return {
      id: r.id,
      skillId: r.skillId,
      version: r.version,
      skillName: v?.name ?? null,
      mapId: r.mapId,
      difficulty: r.difficulty,
      seed: `${r.mapId}:${r.difficulty}`,
      status: r.status,
      brain: r.brain,
      credits: r.credits,
      /** The run played an edited draft rather than the version's own prompt. */
      edited: !!r.promptSha256,
      promptSha256: r.promptSha256 ?? v?.promptSha256 ?? null,
      result: r.status === 'done' ? r.result : null,
      /** insufficient_credits: `{ need, have }`. */
      shortfall: r.status === 'insufficient_credits' ? r.result : null,
      error: r.error,
      createdAt: new Date(r.createdAt).toISOString(),
      finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
    };
  }
}
