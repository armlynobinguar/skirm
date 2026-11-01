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
    const rows = await this.deps.repos.seasons.list(limit);
    return Promise.all(
      rows.map(async (s) => seasonView(s, await this.deps.repos.seasons.pool(s.id))),
    );
  }

  /** The season running now (opened on first ask), its top 10 and the caller's row. */
  @Get('current')
  async current(@CurrentAccount() account?: AccountRow) {
    const { seasons } = this.deps.repos;
    const season = await seasons.ensureCurrent();
    const [{ pool, prizes }, top, you] = await Promise.all([
      this.money(season),
      seasons.standings(season.id, { limit: TOP }),
      account ? seasons.rowFor(season.id, account.id) : Promise.resolve(undefined),
    ]);
    return {
      season: seasonView(season, pool),
      top: top.rows.map((r) => standingView(r, prizes)),
      ...(you ? { you: standingView(you, prizes) } : {}),
    };
  }

  @Get(':id/standings')
  async standings(@Param('id') id: string, @Query() query: unknown) {
    const { limit, offset } = parse(standingsQuery, query);
    const { seasons } = this.deps.repos;
    const season = await seasons.get(idOr404(seasonId, id, 'season'));
    if (!season) throw notFound('season');
    const [{ prizes }, page] = await Promise.all([
      this.money(season),
      seasons.standings(season.id, { limit, offset }),
    ]);
    return { rows: page.rows.map((r) => standingView(r, prizes)), total: page.total };
  }
}
