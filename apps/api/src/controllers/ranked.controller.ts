// Ranked tiers and the leaderboards beyond the overall ladder (GET /leaderboards/players):
// /leaderboards/tiers, /leaderboards/maps/:mapId and /leaderboards/skills. All public.
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { mapV2 } from '@skirm/engine/v2';
import { DEFAULTS, RANKED_TIERS, playerTier } from '@skirm/shared';
import { z } from 'zod';
import { Public } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { notFound } from '../errors';
import { CACHE, readCacheOf } from '../read-cache';
import { intQuery, parse } from '../validation';

const mapQuery = z.object({ limit: intQuery(1, 200, 100) });
const skillsQuery = z.object({
  limit: intQuery(1, 200, 100),
  mapId: z.string().min(1).max(64).optional(),
});

@Public()
@Controller('leaderboards')
export class RankedController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  /** The tier thresholds, placement rule and Elo decay as this server applies them. */
  @Get('tiers')
  tiers() {
    const decay = this.deps.config.rankedDecay ?? DEFAULTS.ranked.decay;
    return {
      tiers: RANKED_TIERS.map((t, i) => ({ name: t.name, min: t.min, nextAt: RANKED_TIERS[i + 1]?.min ?? null })),
      placementMatches: DEFAULTS.ranked.placementMatches,
      kPlacement: DEFAULTS.elo.kPlacement,
      decay: { fromTier: DEFAULTS.ranked.decay.fromTier, days: decay.days, amount: decay.amount },
      skillMinMatches: DEFAULTS.ranked.skillMinMatches,
    };
  }

  /** Players by ranked results on one map (most wins, then win rate), with their tier. 404 for an unknown map. */
  @Get('maps/:mapId')
  async map(@Param('mapId') mapId: string, @Query() query: unknown) {
    const { limit } = parse(mapQuery, query);
    if (!mapV2(mapId)) throw notFound('map');
    const { scope, ttl } = CACHE.leaderboards;
    const rows = await readCacheOf(this.deps).read(scope, `map:${mapId}:${limit}`, ttl, async () =>
      (await this.deps.repos.ranked.mapLadder(mapId, limit)).map((r) => ({ ...r, tier: playerTier(r.elo, r.rankedMatches) })),
    );
    return { mapId, rows };
  }

  /**
   * Skills by ranked win rate over all their versions, only those with at least
   * DEFAULTS.ranked.skillMinMatches ranked matches; `mapId` narrows it to one map.
   */
  @Get('skills')
  async skills(@Query() query: unknown) {
    const { limit, mapId } = parse(skillsQuery, query);
    if (mapId !== undefined && !mapV2(mapId)) throw notFound('map');
    const minMatches = DEFAULTS.ranked.skillMinMatches;
    const { scope, ttl } = CACHE.leaderboards;
    const rows = await readCacheOf(this.deps).read(scope, `skills:${mapId ?? '*'}:${limit}`, ttl, () =>
      this.deps.repos.ranked.skillLadder({ minMatches, limit, ...(mapId !== undefined ? { mapId } : {}) }),
    );
    return { minMatches, ...(mapId !== undefined ? { mapId } : {}), rows };
  }
}
