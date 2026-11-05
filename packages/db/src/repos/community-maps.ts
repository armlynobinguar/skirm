// Community maps: players' own v2 maps from the web map editor. A draft is its author's alone (every
// write is by author and refuses a published map); publishing fixes the map for good and lists it
// for everyone. The api validates and balance-checks a map before `publish`; realtime reads
// `published` to play one and counts the match with `played`.
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { newId } from '../ids';
import { accounts, communityMapLikes, communityMaps } from '../schema';
import { RepoError } from '../types';
import { isUniqueViolation, tx } from './util';

/** Drafts a player may keep at once. */
export const COMMUNITY_DRAFTS_MAX = 20;

export type CommunityMapStatus = 'draft' | 'published';

export interface CommunityMapView {
  id: string;
  authorId: string;
  authorHandle: string;
  name: string;
  theme: string;
  /** The skirm.map/v2 JSON (a draft's may not be valid yet). */
  map: unknown;
  status: CommunityMapStatus;
  plays: number;
  likes: number;
  balance: unknown;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}

const columns = {
  id: communityMaps.id,
  authorId: communityMaps.authorId,
  authorHandle: accounts.handle,
  name: communityMaps.name,
  theme: communityMaps.theme,
  map: communityMaps.map,
  status: communityMaps.status,
  plays: communityMaps.plays,
  likes: communityMaps.likes,
  balance: communityMaps.balance,
  createdAt: communityMaps.createdAt,
  updatedAt: communityMaps.updatedAt,
  publishedAt: communityMaps.publishedAt,
};

const view = (r: Omit<CommunityMapView, 'status'> & { status: string }): CommunityMapView => ({ ...r, status: r.status as CommunityMapStatus });

export class CommunityMapsRepo {
  constructor(private readonly db: Executor) {}

  private select() {
    return this.db.select(columns).from(communityMaps).innerJoin(accounts, eq(accounts.id, communityMaps.authorId));
  }

  /** Any map by id (drafts too: the caller checks who may see it). */
  async get(id: string): Promise<CommunityMapView | undefined> {
    const [row] = await this.select().where(eq(communityMaps.id, id));
    return row ? view(row) : undefined;
  }

  /** A published map, for play. */
  async published(id: string): Promise<CommunityMapView | undefined> {
    const [row] = await this.select().where(and(eq(communityMaps.id, id), eq(communityMaps.status, 'published')));
    return row ? view(row) : undefined;
  }

  /** The author's maps, drafts and published, newest edit first. */
  async listMine(authorId: string): Promise<CommunityMapView[]> {
    const rows = await this.select().where(eq(communityMaps.authorId, authorId)).orderBy(desc(communityMaps.updatedAt), desc(communityMaps.id));
    return rows.map(view);
  }

  /** Published maps: newest first, or most played (then most liked). */
  async browse(opts: { sort: 'new' | 'popular'; limit: number; offset?: number }): Promise<CommunityMapView[]> {
    const order =
      opts.sort === 'popular'
        ? [desc(sql`${communityMaps.plays} + 3 * ${communityMaps.likes}`), desc(communityMaps.publishedAt), desc(communityMaps.id)]
        : [desc(communityMaps.publishedAt), desc(communityMaps.id)];
    const rows = await this.select()
      .where(eq(communityMaps.status, 'published'))
      .orderBy(...order)
      .limit(opts.limit)
      .offset(opts.offset ?? 0);
    return rows.map(view);
  }

  /** Saves a new draft. Refused with `map_limit` once the player holds `max` drafts. */
  async create(authorId: string, d: { name: string; theme: string; map: unknown }, max = COMMUNITY_DRAFTS_MAX): Promise<CommunityMapView> {
    const id = newId('cmp');
    await tx(this.db, async (t) => {
      // One writer per player at a time (the account row), so two saves cannot both pass the cap.
      await t.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, authorId)).for('update');
      const [{ n } = { n: 0 }] = await t
        .select({ n: count() })
        .from(communityMaps)
        .where(and(eq(communityMaps.authorId, authorId), eq(communityMaps.status, 'draft')));
      if (n >= max) throw new RepoError('map_limit', `at most ${max} map drafts`, { max });
      await t.insert(communityMaps).values({ id, authorId, name: d.name, theme: d.theme, map: d.map });
    });
    return (await this.get(id))!;
  }

  /**
   * Changes one of the author's drafts. Undefined when it is not theirs; `map_published` when it is
   * published (a published map never changes).
   */
  async update(authorId: string, id: string, patch: { name?: string; theme?: string; map?: unknown }): Promise<CommunityMapView | undefined> {
    const cur = await this.get(id);
    if (!cur || cur.authorId !== authorId) return undefined;
    if (cur.status !== 'draft') throw new RepoError('map_published', 'a published map cannot change');
    await this.db
      .update(communityMaps)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
        ...(patch.map !== undefined ? { map: patch.map } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(communityMaps.id, id), eq(communityMaps.status, 'draft')));
    return this.get(id);
  }

  /** Deletes one of the author's drafts: false when it is not theirs, `map_published` when published. */
  async delete(authorId: string, id: string): Promise<boolean> {
    const cur = await this.get(id);
    if (!cur || cur.authorId !== authorId) return false;
    if (cur.status !== 'draft') throw new RepoError('map_published', 'a published map cannot be deleted');
    await this.db.delete(communityMaps).where(and(eq(communityMaps.id, id), eq(communityMaps.status, 'draft')));
    return true;
  }

  /** Maps the author published since `since` (the daily publish cap). */
  async publishedSince(authorId: string, since: Date): Promise<number> {
    const [{ n } = { n: 0 }] = await this.db
      .select({ n: count() })
      .from(communityMaps)
      .where(and(eq(communityMaps.authorId, authorId), eq(communityMaps.status, 'published'), gte(communityMaps.publishedAt, since)));
    return n;
  }

  /**
   * Publishes one of the author's drafts with its final (validated) map and its balance report.
   * `name_taken` when another published map has the name (any case).
   */
  async publish(authorId: string, id: string, d: { name: string; map: unknown; balance: unknown }, now = new Date()): Promise<CommunityMapView | undefined> {
    const cur = await this.get(id);
    if (!cur || cur.authorId !== authorId) return undefined;
    if (cur.status !== 'draft') throw new RepoError('map_published', 'this map is already published');
    try {
      await this.db
        .update(communityMaps)
        .set({ name: d.name, map: d.map, balance: d.balance, status: 'published', publishedAt: now, updatedAt: now })
        .where(and(eq(communityMaps.id, id), eq(communityMaps.status, 'draft')));
    } catch (err) {
      if (isUniqueViolation(err)) throw new RepoError('name_taken', 'a published map already has this name');
      throw err;
    }
    return this.get(id);
  }

  /** One more match started on a published map. */
  async played(id: string): Promise<void> {
    await this.db
      .update(communityMaps)
      .set({ plays: sql`${communityMaps.plays} + 1` })
      .where(and(eq(communityMaps.id, id), eq(communityMaps.status, 'published')));
  }

  /** Likes (true) or unlikes a published map, once per player. Undefined when no such published map. */
  async like(accountId: string, id: string, on: boolean): Promise<{ likes: number; liked: boolean } | undefined> {
    return tx(this.db, async (t) => {
      const [row] = await t
        .select({ id: communityMaps.id })
        .from(communityMaps)
        .where(and(eq(communityMaps.id, id), eq(communityMaps.status, 'published')))
        .for('update');
      if (!row) return undefined;
      const changed = on
        ? await t.insert(communityMapLikes).values({ mapId: id, accountId }).onConflictDoNothing().returning({ mapId: communityMapLikes.mapId })
        : await t
            .delete(communityMapLikes)
            .where(and(eq(communityMapLikes.mapId, id), eq(communityMapLikes.accountId, accountId)))
            .returning({ mapId: communityMapLikes.mapId });
      if (changed.length) await t.update(communityMaps).set({ likes: sql`${communityMaps.likes} + ${on ? 1 : -1}` }).where(eq(communityMaps.id, id));
      const [m] = await t.select({ likes: communityMaps.likes }).from(communityMaps).where(eq(communityMaps.id, id));
      return { likes: m!.likes, liked: on };
    });
  }

  /** Which of `ids` the player liked. */
  async likedBy(accountId: string, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select({ mapId: communityMapLikes.mapId })
      .from(communityMapLikes)
      .where(and(eq(communityMapLikes.accountId, accountId), inArray(communityMapLikes.mapId, ids)));
    return rows.map((r) => r.mapId);
  }
}
