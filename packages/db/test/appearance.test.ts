import { defaultAppearance, type AgentAppearance } from '@skirm/shared';
import { describe, expect, it } from 'vitest';
import { setup, signUp } from './helpers';

const look: AgentAppearance = {
  skin: 2,
  hair: 'bun',
  hairColor: 6,
  outfit: 4,
  pants: 1,
  build: 'sturdy',
  headgear: 'cap',
};

describe('agent appearance', () => {
  it('starts on the per-agent default, saves a new look, and only for the owner', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'ana');
    const other = await signUp(ctx, 'ben');
    const [rook] = await ctx.repos.agents.listByOwner(acc.id);
    expect(rook!.appearance).toEqual(defaultAppearance(rook!.id));

    const v = await ctx.repos.agents.setAppearance(acc.id, rook!.id, look);
    expect(v.appearance).toEqual(look);
    expect((await ctx.repos.agents.view(rook!.id))!.appearance).toEqual(look);

    await expect(ctx.repos.agents.setAppearance(other.id, rook!.id, look)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      ctx.repos.agents.setAppearance(acc.id, rook!.id, { ...look, skin: 99 }),
    ).rejects.toMatchObject({ code: 'invalid_appearance' });
  });
});
