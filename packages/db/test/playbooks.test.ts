import { describe, expect, it } from 'vitest';
import { setup, signUp } from './helpers';

describe('playbooks', () => {
  it('saves, selects, edits and deletes a player’s own playbooks only', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const pb = ctx.repos.playbooks;

    const first = await pb.create(ana.id, 'Haul and scout', await ctx.sealer.encryptSkill('Rook hauls, Wren scouts'));
    expect(first).toMatchObject({ name: 'Haul and scout', selected: true });
    expect(first.id).toMatch(/^pbk_/);
    const second = await pb.create(ana.id, 'Deny', await ctx.sealer.encryptSkill('Moss blocks the rival lane'));
    expect(second.selected).toBe(false);
    expect((await pb.list(ana.id)).map((p) => p.name)).toEqual(['Haul and scout', 'Deny']);

    // Another player sees, loads and changes nothing of Ana's.
    expect(await pb.list(ben.id)).toEqual([]);
    expect(await pb.get(ben.id, first.id)).toBeUndefined();
    expect(await pb.loadSealed(ben.id, first.id)).toBeUndefined();
    expect(await pb.update(ben.id, first.id, { name: 'x' })).toBeUndefined();
    expect(await pb.select(ben.id, first.id)).toBe(false);
    expect(await pb.delete(ben.id, first.id)).toBe(false);

    // The view never carries ciphertext; loadSealed does, for the vault.
    expect(Object.keys(first).sort()).toEqual(['createdAt', 'id', 'name', 'selected', 'updatedAt']);
    const sealed = (await pb.loadSealed(ana.id, first.id))!;
    expect(sealed.keyId).toBe('test');
    expect(sealed.promptSha256).toMatch(/^[0-9a-f]{64}$/);

    // One selected at a time; null clears it.
    expect(await pb.select(ana.id, second.id)).toBe(true);
    expect((await pb.selected(ana.id))?.id).toBe(second.id);
    expect((await pb.list(ana.id)).filter((p) => p.selected)).toHaveLength(1);
    expect(await pb.select(ana.id, null)).toBe(true);
    expect(await pb.selected(ana.id)).toBeUndefined();

    const renamed = await pb.update(ana.id, second.id, { name: 'Deny hard', sealed: await ctx.sealer.encryptSkill('new text') });
    expect(renamed?.name).toBe('Deny hard');
    expect((await pb.loadSealed(ana.id, second.id))!.promptSha256).not.toBe(sealed.promptSha256);

    expect(await pb.delete(ana.id, second.id)).toBe(true);
    expect((await pb.list(ana.id)).map((p) => p.id)).toEqual([first.id]);
  });

  it('caps how many a player keeps', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const s = await ctx.sealer.encryptSkill('t');
    await ctx.repos.playbooks.create(ana.id, 'a', s, 2);
    await ctx.repos.playbooks.create(ana.id, 'b', s, 2);
    await expect(ctx.repos.playbooks.create(ana.id, 'c', s, 2)).rejects.toMatchObject({ code: 'playbook_limit' });
  });

  it('goes with account deletion and comes with the export', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    await ctx.repos.playbooks.create(ana.id, 'Mine', await ctx.sealer.encryptSkill('secret plan'));
    const data = await ctx.repos.accounts.exportFor(ana.id);
    expect(data.playbooks).toHaveLength(1);
    expect(data.playbooks![0]).toMatchObject({ name: 'Mine', ownerId: ana.id });
    await ctx.repos.accounts.deleteAccount(ana.id);
    expect(await ctx.repos.playbooks.list(ana.id)).toEqual([]);
  });
});
