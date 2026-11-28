// /seasons*: v2 seasons, their pool and standings (points from ranked v2 matches only). Public; a
// signed-in caller also gets their own row. Prizes are projected from the pool while a season is
// open and read from the written payouts once it is locked.
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import type { AccountRow, SeasonRow } from '@skirm/db';
import { SEASON, seasonPayouts } from '@skirm/shared';
import { z } from 'zod';
import { CurrentAccount, Public } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { notFound } from '../errors';
import { CACHE, readCacheOf } from '../read-cache';
import { intQuery, parse, seasonId } from '../validation';
import { seasonView, standingView } from '../views';
import { idOr404 } from './util';

const TOP = 10;
const standingsQuery = z.object({
  limit: intQuery(1, 200, 50),
  offset: intQuery(0, 1_000_000, 0),
});
const listQuery = z.object({ limit: intQuery(1, 50, 20) });

@Public()
@Controller('seasons')
export class SeasonsController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  /** The pool and the prize per place: projected from the pool while open, as written once locked. */
  private async money(season: SeasonRow): Promise<{ pool: bigint; prizes: Map<number, bigint> }> {
    const { seasons } = this.deps.repos;
    const pool = await seasons.pool(season.id);
    if (season.status !== 'open') {
      const payouts = await seasons.payouts(season.id);
      return { pool, prizes: new Map(payouts.map((p) => [p.rank, BigInt(p.amountYocto)])) };
    }
    const places = SEASON.splitBps.map((_, i) => ({ accountId: String(i) }));
    const { payouts } = seasonPayouts(pool, places);
    return { pool, prizes: new Map(payouts.map((p) => [p.rank, p.amountYocto])) };
  }

  @Get()
  async list(@Query() query: unknown) {
    const { limit } = parse(listQuery, query);
    const { scope, ttl } = CACHE.seasons;
    return readCacheOf(this.deps).read(scope, `list:${limit}`, ttl, async () => {
      const rows = await this.deps.repos.seasons.list(limit);
      return Promise.all(rows.map(async (s) => seasonView(s, await this.deps.repos.seasons.pool(s.id))));
    });
  }

  /** The season running now (opened on first ask), its top 10 and the caller's row. */
  @Get('current')
  async current(@CurrentAccount() account?: AccountRow) {
    const { seasons } = this.deps.repos;
    const { scope, ttl } = CACHE.seasons;
    // The season, its pool and top 10 are the same for everyone (cached); the caller's row is not.
    const board = await readCacheOf(this.deps).read(scope, 'current', ttl, async () => {
      const season = await seasons.ensureCurrent();
      const [{ pool, prizes }, top] = await Promise.all([this.money(season), seasons.standings(season.id, { limit: TOP })]);
      return {
        season: seasonView(season, pool),
        top: top.rows.map((r) => standingView(r, prizes)),
        prizes: [...prizes].map(([rank, yocto]) => [rank, yocto.toString()] as [number, string]),
      };
    });
    const you = account ? await seasons.rowFor(board.season.id, account.id) : undefined;
    const prizes = new Map(board.prizes.map(([rank, yocto]) => [rank, BigInt(yocto)]));
    return {
      season: board.season,
      top: board.top,
      ...(you ? { you: standingView(you, prizes) } : {}),
    };
  }

  @Get(':id/standings')
  async standings(@Param('id') id: string, @Query() query: unknown) {
    const { limit, offset } = parse(standingsQuery, query);
    const { seasons } = this.deps.repos;
    const sid = idOr404(seasonId, id, 'season');
    const { scope, ttl } = CACHE.seasons;
    const page = await readCacheOf(this.deps).read(scope, `standings:${sid}:${limit}:${offset}`, ttl, async () => {
      const season = await seasons.get(sid);
      if (!season) return null;
      const [{ prizes }, page] = await Promise.all([
        this.money(season),
        seasons.standings(season.id, { limit, offset }),
      ]);
      return { rows: page.rows.map((r) => standingView(r, prizes)), total: page.total };
    });
    if (!page) throw notFound('season');
    return page;
  }
}
