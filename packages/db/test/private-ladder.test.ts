// Private MMR: the public PrivateLadder tier cached on the account.
import { describe, expect, it } from 'vitest';
import { setup, signUp } from './helpers';

describe('accounts ladder tier', () => {
  it('starts empty, caches a revealed tier and clears it, refusing an out-of-range tier', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    expect((await ctx.repos.accounts.get(ana.id))!.ladderTier).toBeNull();
    await ctx.repos.accounts.setLadderTier(ana.id, 3);
    const row = (await ctx.repos.accounts.get(ana.id))!;
    expect(row.ladderTier).toBe(3);
    expect(row.elo).toBe(1200); // the off-chain Elo is untouched
    await ctx.repos.accounts.setLadderTier(ana.id, null);
    expect((await ctx.repos.accounts.get(ana.id))!.ladderTier).toBeNull();
    await expect(ctx.repos.accounts.setLadderTier(ana.id, 6)).rejects.toThrow(RangeError);
  });
});
