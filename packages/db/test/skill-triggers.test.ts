import { describe, expect, it } from 'vitest';
import { setup, signUp } from './helpers';

const meta = {
  name: 'Late Push',
  summary: null,
  requiresActions: [] as [],
  handlesTags: ['collectible' as const],
  royaltyBps: 500,
};

describe('skill version triggers', () => {
  it('stores a trigger per version; always and none store as null', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'ana');
    const v1 = await ctx.repos.skills.create(acc.id, { ...meta, trigger: { kind: 'time_left_under', seconds: 60 } }, await ctx.sealer.encryptSkill('p'));
    expect(v1.trigger).toEqual({ kind: 'time_left_under', seconds: 60 });
    const v2 = await ctx.repos.skills.createVersion(v1.id, acc.id, { ...meta, trigger: { kind: 'always' } }, await ctx.sealer.encryptSkill('p2'));
    expect(v2.trigger).toBeNull();
    const v3 = await ctx.repos.skills.createVersion(v1.id, acc.id, meta, await ctx.sealer.encryptSkill('p3'));
    expect(v3.trigger).toBeNull();
    // Versions keep their own trigger.
    expect((await ctx.repos.skills.get(v1.id, 1))!.trigger).toEqual({ kind: 'time_left_under', seconds: 60 });
    const many = await ctx.repos.skills.getMany([
      { id: v1.id, version: 1 },
      { id: v1.id, version: 2 },
    ]);
    expect(many.map((v) => [v.version, v.trigger])).toEqual(
      expect.arrayContaining([
        [1, { kind: 'time_left_under', seconds: 60 }],
        [2, null],
      ]),
    );
  });
});
