// GET /ops/stats: aggregates for the operator dashboard (skirm-ops). No session: it takes the
// OPS_TOKEN bearer token instead, and answers 404 like an unknown route while OPS_TOKEN is unset.
// Totals only, never a player's handle, balance or ledger row.
import { createHash, timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, Inject, Query } from '@nestjs/common';
import { DEFAULTS, measureTalkRates } from '@skirm/shared';
import { Public } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError } from '../errors';

const DAY_MS = 86_400_000;
/** Days in the per-day match series. */
export const OPS_SERIES_DAYS = 14;

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * The v2 brain the worker and realtime build from the same environment (createV2Brain): Haiku when an
 * OpenRouter key is set, unless V2_BRAIN=greedy; otherwise the offline greedy brain.
 */
export function v2BrainKind(env: { V2_BRAIN?: string | undefined; OPENROUTER_API_KEY?: string | undefined }): 'haiku' | 'greedy' {
  return env.V2_BRAIN !== 'greedy' && env.OPENROUTER_API_KEY ? 'haiku' : 'greedy';
}

/** Constant-time compare of `Authorization: Bearer <token>` with the configured token. */
export function opsTokenMatches(header: string | undefined, token: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!m) return false;
  return timingSafeEqual(digest(m[1]!.trim()), digest(token));
}

@Public()
@Controller('ops')
export class OpsController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  @Get('stats')
  async stats(@Headers('authorization') authorization?: string) {
    const token = this.deps.config.OPS_TOKEN;
    if (!token) throw new ApiError(404, 'not_found', 'route not found');
    if (!opsTokenMatches(authorization, token)) throw new ApiError(401, 'unauthenticated', 'ops token required');

    const now = Date.now();
    const midnight = Date.parse(`${utcDay(now)}T00:00:00Z`);
    const stats = await this.deps.repos.ops.stats({
      today: utcDay(now),
      since1d: new Date(now - DAY_MS),
      since7d: new Date(now - 7 * DAY_MS),
      since30d: new Date(now - 30 * DAY_MS),
      seriesFrom: new Date(midnight - (OPS_SERIES_DAYS - 1) * DAY_MS),
    });
    // Redis keeps three days of spend totals: today and the two before.
    const days = [0, 1, 2].map((i) => utcDay(midnight - i * DAY_MS));
    const spend = this.deps.costs ? await this.deps.costs.usd(days) : null;
    return {
      at: new Date(now).toISOString(),
      /** The v2 brain kind (V2_BRAIN, or 'haiku' when an OpenRouter key is set). */
      engine: v2BrainKind(this.deps.config),
      ai: {
        dailyBudgetUsd: this.deps.config.COST_ALERT_DAILY_USD ?? null,
        spend: spend ? days.map((day) => ({ day, usd: spend[day] ?? 0 })) : null,
        matchCostUsd30d: stats.matches.costUsd30d,
      },
      players: stats.players,
      credits: { ...stats.credits, creditsPerNear: this.deps.config.CREDITS_PER_NEAR },
      matches: stats.matches,
    };
  }

  /**
   * Talk-tier rates from measured model spend (the prototype: "rates are placeholders until token
   * counts are measured"): per tier, the model USD per agent-tick over the last `days` (default 30)
   * of ended matches, the rate that covers it with a 25% margin, the current rate, and whether there
   * are enough samples. Apply a suggestion by changing DEFAULTS.talk.ratePer100 (every client prices
   * crews from it).
   */
  @Get('talk-rates')
  async talkRates(@Headers('authorization') authorization?: string, @Query('days') daysQ?: string) {
    const token = this.deps.config.OPS_TOKEN;
    if (!token) throw new ApiError(404, 'not_found', 'route not found');
    if (!opsTokenMatches(authorization, token)) throw new ApiError(401, 'unauthenticated', 'ops token required');
    const days = Math.min(365, Math.max(1, Number.parseInt(daysQ ?? '30', 10) || 30));
    const samples = await this.deps.repos.ops.talkUsage(new Date(Date.now() - days * DAY_MS));
    return { days, margin: 1.25, creditUsd: DEFAULTS.credits.priceUsd, tiers: measureTalkRates(samples, { margin: 1.25 }) };
  }
}
