// /community-maps*: players' own v2 maps from the web map editor (/maps/editor).
//   GET    /community-maps?sort=new|popular&limit&offset   published maps, public
//   GET    /community-maps/mine                            the caller's drafts and published maps
//   GET    /community-maps/:id                             a published map, or the caller's own draft
//   POST   /community-maps          { name, theme, map }   save a new draft
//   PUT    /community-maps/:id      { name?, theme?, map? } edit an own draft (a published map never changes)
//   DELETE /community-maps/:id                             delete an own draft
//   POST   /community-maps/test-play { map }               validate and balance-check a map (nothing saved)
//   POST   /community-maps/:id/publish                     validate, balance-check and publish an own draft
//   POST   /community-maps/:id/like, DELETE ...:id/like     like or unlike a published map
// Drafts may hold anything the editor saves (within the size cap); publishing runs
// validateCommunityMap and the greedy balance check again on the server, screens every player-written
// text with the speech filter, and is capped per player per day (and in the strict rate-limit bucket).
// Published maps play in practice and casual (realtime reads them by id), never ranked.
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { COMMUNITY_DRAFTS_MAX, RepoError, type AccountRow, type CommunityMapView } from '@skirm/db';
import { balanceCheck, filterSpeech } from '@skirm/decision-engine/v2';
import { COMMUNITY_MAP_LIMITS, MAPS_V2, validateCommunityMap, type MapDefV2 } from '@skirm/engine/v2';
import { z } from 'zod';
import { CurrentAccount, Public, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError, notFound } from '../errors';
import { parse } from '../validation';
import { idOr404 } from './util';

/** Maps a player may publish per UTC day. */
export const COMMUNITY_PUBLISH_PER_DAY = 3;
/** Largest map JSON a draft may hold. */
export const COMMUNITY_MAP_MAX_BYTES = 32_768;
const PAGE_MAX = 48;

export const communityMapId = z.string().regex(/^cmp_[0-9A-HJKMNP-TV-Z]{26}$/);
const THEMES = MAPS_V2.map((m) => m.id) as [string, ...string[]];
const chars = (v: string) => [...v].length;
const name = z
  .string()
  .trim()
  .min(1, 'name: at least 1 character')
  .refine((v) => chars(v) <= COMMUNITY_MAP_LIMITS.text.name, `name: at most ${COMMUNITY_MAP_LIMITS.text.name} characters`);
const mapJson = z
  .record(z.string(), z.unknown())
  .refine((m) => JSON.stringify(m).length <= COMMUNITY_MAP_MAX_BYTES, `map: at most ${COMMUNITY_MAP_MAX_BYTES} bytes`);
const createBody = z.object({ name, theme: z.enum(THEMES).default('copper-hollow'), map: mapJson }).strict();
const updateBody = z
  .object({ name: name.optional(), theme: z.enum(THEMES).optional(), map: mapJson.optional() })
  .strict()
  .refine((b) => b.name !== undefined || b.theme !== undefined || b.map !== undefined, 'send a name, a theme or a map');
const testBody = z.object({ map: mapJson }).strict();
const browseQuery = z.object({
  sort: z.enum(['new', 'popular']).default('new'),
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(24),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

/** What every response shows of a map. */
export function communityMapPublic(m: CommunityMapView, liked?: boolean) {
  return {
    id: m.id,
    name: m.name,
    theme: m.theme,
    author: m.authorHandle,
    status: m.status,
    plays: m.plays,
    likes: m.likes,
    ...(liked !== undefined ? { liked } : {}),
    map: m.map,
    ...(m.balance ? { balance: m.balance } : {}),
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    publishedAt: m.publishedAt?.toISOString() ?? null,
  };
}

/** The map as it will be stored on publish: the server owns its id, code, label and name. */
export function publishable(id: string, nameText: string, raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  return { ...(raw as Record<string, unknown>), id, code: `CM-${id.slice(-4)}`, label: 'Community', name: nameText };
}

/** Every player-written text on a map: refused when the speech filter calls one abusive. */
function screen(def: MapDefV2): void {
  const texts = [def.name, def.region, def.blurb, def.item, def.deliverTo, ...def.verbs.map((v) => v.name), ...def.switches.map((s) => s.name)];
  for (const t of texts) {
    if (!t.trim()) continue;
    const f = filterSpeech(t, []);
    if (!f.ok && f.reason === 'abuse') throw new ApiError(422, 'map_refused', 'a name on this map was refused by the filter');
  }
}

const invalid = (issues: unknown) => new ApiError(422, 'map_invalid', 'the map does not pass validation', { issues });

/** Repo refusals with their HTTP status (map_published: 409). */
async function repo<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof RepoError && (err.code === 'map_published' || err.code === 'name_taken')) throw new ApiError(409, err.code, err.message);
    throw err;
  }
}

@Controller('community-maps')
export class CommunityMapsController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  /** Published maps, newest or most popular first. Signed in: which ones the caller liked. */
  @Public()
  @Get()
  async browse(@Query() query: unknown, @CurrentAccount() acc?: AccountRow) {
    const q = parse(browseQuery, query);
    const rows = await this.deps.repos.communityMaps.browse(q);
    const liked = acc ? new Set(await this.deps.repos.communityMaps.likedBy(acc.id, rows.map((r) => r.id))) : null;
    return { sort: q.sort, maps: rows.map((r) => communityMapPublic(r, liked ? liked.has(r.id) : undefined)) };
  }

  @Get('mine')
  async mine(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const rows = await this.deps.repos.communityMaps.listMine(account.id);
    return { maps: rows.map((r) => communityMapPublic(r)), maxDrafts: COMMUNITY_DRAFTS_MAX, publishPerDay: COMMUNITY_PUBLISH_PER_DAY };
  }

  /** A published map for anyone; a draft for its author only (404 otherwise). */
  @Public()
  @Get(':id')
  async get(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const mid = idOr404(communityMapId, id, 'map');
    const m = await this.deps.repos.communityMaps.get(mid);
    if (!m || (m.status !== 'published' && m.authorId !== acc?.id)) throw notFound('map');
    return communityMapPublic(m);
  }

  @Post()
  async create(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const b = parse(createBody, body);
    return communityMapPublic(await this.deps.repos.communityMaps.create(account.id, { name: b.name, theme: b.theme, map: b.map }));
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const mid = idOr404(communityMapId, id, 'map');
    const b = parse(updateBody, body);
    const m = await repo(this.deps.repos.communityMaps.update(account.id, mid, b));
    if (!m) throw notFound('map');
    return communityMapPublic(m);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const mid = idOr404(communityMapId, id, 'map');
    if (!(await repo(this.deps.repos.communityMaps.delete(account.id, mid)))) throw notFound('map');
    return { deleted: true };
  }

  /** Validation issues, or the balance report of a few greedy matches. Nothing is saved. */
  @Post('test-play')
  @HttpCode(200)
  async testPlay(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    mustAccount(acc);
    const b = parse(testBody, body);
    const check = validateCommunityMap(b.map);
    if (!check.ok) return { valid: false, issues: check.issues };
    return { valid: true, issues: [], balance: await balanceCheck(check.map.def) };
  }

  /**
   * Publishes an own draft: its stored map must pass validation and the balance check, its texts
   * the speech filter, and the player must be under the daily cap. A published map never changes.
   */
  @Post(':id/publish')
  @HttpCode(200)
  async publish(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const mid = idOr404(communityMapId, id, 'map');
    const { communityMaps } = this.deps.repos;
    const cur = await communityMaps.get(mid);
    if (!cur || cur.authorId !== account.id) throw notFound('map');
    if (cur.status !== 'draft') throw new ApiError(409, 'map_published', 'this map is already published');
    const since = new Date(Date.now() - 24 * 3600_000);
    if ((await communityMaps.publishedSince(account.id, since)) >= COMMUNITY_PUBLISH_PER_DAY)
      throw new ApiError(429, 'publish_limit', `at most ${COMMUNITY_PUBLISH_PER_DAY} maps a day`, { max: COMMUNITY_PUBLISH_PER_DAY });
    const check = validateCommunityMap(publishable(mid, cur.name, cur.map));
    if (!check.ok) throw invalid(check.issues);
    const def = check.map.def;
    screen(def);
    const balance = await balanceCheck(def);
    if (!balance.ok) throw new ApiError(422, 'map_unbalanced', 'the map failed the balance check', { problems: balance.problems, wins: balance.wins });
    const m = await repo(communityMaps.publish(account.id, mid, { name: cur.name, map: def, balance }));
    if (!m) throw notFound('map');
    return communityMapPublic(m);
  }

  @Post(':id/like')
  @HttpCode(200)
  async like(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    return this.setLike(id, true, acc);
  }

  @Delete(':id/like')
  async unlike(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    return this.setLike(id, false, acc);
  }

  private async setLike(id: string, on: boolean, acc?: AccountRow) {
    const account = mustAccount(acc);
    const mid = idOr404(communityMapId, id, 'map');
    const r = await this.deps.repos.communityMaps.like(account.id, mid, on);
    if (!r) throw notFound('map');
    return r;
  }
}
