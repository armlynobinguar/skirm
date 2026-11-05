import { describe, expect, it } from 'vitest';
import { setup, signUp } from './helpers';

const MAP = { schema: 'skirm.map/v2', rows: ['#####'] };

describe('community maps', () => {
  it('keeps drafts the author’s alone, publishes once, and lists published maps', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const cm = ctx.repos.communityMaps;

    const d = await cm.create(ana.id, { name: 'Ash Yard', theme: 'copper-hollow', map: MAP });
    expect(d).toMatchObject({ name: 'Ash Yard', status: 'draft', authorHandle: 'ana', plays: 0, likes: 0, publishedAt: null });
    expect(d.id).toMatch(/^cmp_/);
    expect(await cm.update(ben.id, d.id, { name: 'Mine' })).toBeUndefined();
    expect(await cm.delete(ben.id, d.id)).toBe(false);
    expect(await cm.publish(ben.id, d.id, { name: 'x', map: MAP, balance: null })).toBeUndefined();
    expect((await cm.update(ana.id, d.id, { name: 'Ash Yard 2' }))?.name).toBe('Ash Yard 2');
    expect(await cm.published(d.id)).toBeUndefined();
    expect(await cm.browse({ sort: 'new', limit: 10 })).toEqual([]);

    const p = await cm.publish(ana.id, d.id, { name: 'Ash Yard 2', map: { ...MAP, id: d.id }, balance: { ok: true } });
    expect(p).toMatchObject({ status: 'published', map: { id: d.id }, balance: { ok: true } });
    expect(p!.publishedAt).toBeInstanceOf(Date);
    await expect(cm.update(ana.id, d.id, { name: 'z' })).rejects.toMatchObject({ code: 'map_published' });
    await expect(cm.delete(ana.id, d.id)).rejects.toMatchObject({ code: 'map_published' });
    await expect(cm.publish(ana.id, d.id, { name: 'z', map: MAP, balance: null })).rejects.toMatchObject({ code: 'map_published' });
    expect(await cm.publishedSince(ana.id, new Date(Date.now() - 60_000))).toBe(1);

    // A second published map with the same name (any case) is refused.
    const twin = await cm.create(ben.id, { name: 'ash yard 2', theme: 'copper-hollow', map: MAP });
    await expect(cm.publish(ben.id, twin.id, { name: 'ash yard 2', map: MAP, balance: null })).rejects.toMatchObject({ code: 'name_taken' });
    const other = await cm.create(ben.id, { name: 'Salt Run', theme: 'saltmarsh-weir', map: MAP });
    await cm.publish(ben.id, other.id, { name: 'Salt Run', map: MAP, balance: null });

    // Plays and likes order the popular list; likes count once per player.
    await cm.played(d.id);
    expect(await cm.like(ben.id, other.id, true)).toEqual({ likes: 1, liked: true });
    expect(await cm.like(ben.id, other.id, true)).toEqual({ likes: 1, liked: true });
    expect(await cm.like(ben.id, twin.id, true)).toBeUndefined();
    expect((await cm.browse({ sort: 'new', limit: 10 })).map((m) => m.name)).toEqual(['Salt Run', 'Ash Yard 2']);
    expect((await cm.browse({ sort: 'popular', limit: 10 })).map((m) => m.name)).toEqual(['Salt Run', 'Ash Yard 2']);
    expect(await cm.likedBy(ben.id, [d.id, other.id])).toEqual([other.id]);
    expect(await cm.like(ben.id, other.id, false)).toEqual({ likes: 0, liked: false });
    expect((await cm.published(d.id))!.plays).toBe(1);

    expect((await cm.listMine(ben.id)).map((m) => m.status).sort()).toEqual(['draft', 'published']);
    expect(await cm.delete(ben.id, twin.id)).toBe(true);
  });

  it('caps the drafts a player keeps', async () => {
    const ctx = await setup();
    const cal = await signUp(ctx, 'cal');
    for (let i = 0; i < 2; i++) await ctx.repos.communityMaps.create(cal.id, { name: `M${i}`, theme: 'copper-hollow', map: MAP }, 2);
    await expect(ctx.repos.communityMaps.create(cal.id, { name: 'M3', theme: 'copper-hollow', map: MAP }, 2)).rejects.toMatchObject({ code: 'map_limit' });
  });
});
