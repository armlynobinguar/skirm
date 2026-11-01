import { describe, expect, it } from 'vitest';
import { STARTER_SKILL, SYSTEM_ACCOUNT_ID, SYSTEM_HANDLE } from '../src/index';
import { setup, signUp } from './helpers';

describe('accounts.getOrCreate', () => {
  it('creates the new-account defaults once', async () => {
    const ctx = await setup();
    const { account, created } = await ctx.repos.accounts.getOrCreate(
      { handle: 'ana' },
      ctx.sealer,
    );
    expect(created).toBe(true);
    expect(account.id).toMatch(/^acc_[0-9A-Z]{26}$/);

    const agents = await ctx.repos.agents.listByOwner(account.id);
    expect(agents.map((a) => a.name)).toEqual(['Rook', 'Wren', 'Moss']);
    expect(agents.every((a) => a.elo === 1200)).toBe(true);
    const rook = agents[0]!;
    expect(rook.skills).toEqual([{ id: STARTER_SKILL.id, version: 1, name: 'Flood Warden' }]);
    expect(rook.unlocks).toEqual(['builder']);
    expect(agents[1]!.skills).toEqual([]);
    expect(agents[1]!.unlocks).toEqual([]);

    const unlocks = await ctx.repos.agents.unlocksOf(account.id);
    expect(unlocks.map((u) => [u.kind, u.attachedAgentId])).toEqual([
      ['builder', rook.id],
      ['digger', null],
      ['firefighter', null],
    ]);

    const credits = await ctx.repos.ledger.balance(account.id);
    expect(credits).toMatchObject({ balance: 0, held: 0, allowanceLeft: 60, available: 60 });
    expect(credits.allowanceResetAt).toBe('2026-11-04T00:00:00.000Z');

    const skill = await ctx.repos.skills.get(STARTER_SKILL.id, 1);
    expect(skill).toMatchObject({
      name: 'Flood Warden',
      accountBound: true,
      creatorId: SYSTEM_ACCOUNT_ID,
      requiresActions: ['place_block'],
      handlesTags: ['spreads', 'liquid'],
      status: 'draft',
    });
    expect(skill).not.toHaveProperty('ciphertext');
    expect(await ctx.repos.skills.owns(account.id, STARTER_SKILL.id, 1)).toBe(true);

    const again = await ctx.repos.accounts.getOrCreate({ handle: 'ana' }, ctx.sealer);
    expect(again).toEqual({ account, created: false });
    expect((await ctx.repos.agents.listByOwner(account.id)).length).toBe(3);
  });

  it('seals the starter skill once and shares it', async () => {
    const ctx = await setup();
    await signUp(ctx, 'ana');
    await signUp(ctx, 'ben');
    expect(ctx.sealer.calls).toBe(1);
    const ben = await ctx.repos.accounts.byHandle('ben');
    expect(await ctx.repos.skills.owns(ben!.id, STARTER_SKILL.id, 1)).toBe(true);
  });

  it('finds privy users by DID', async () => {
    const ctx = await setup();
    const a = await ctx.repos.accounts.getOrCreate(
      { handle: 'p_abc', privyDid: 'did:privy:abc' },
      ctx.sealer,
    );
    const b = await ctx.repos.accounts.getOrCreate(
      { handle: 'p_abc', privyDid: 'did:privy:abc' },
      ctx.sealer,
    );
    expect(b.account.id).toBe(a.account.id);
    expect(b.created).toBe(false);
  });

  it('never signs anyone in as the system account (creator of the starter skill)', async () => {
    const ctx = await setup();
    await signUp(ctx, 'ana'); // creates the system account with Flood Warden
    await expect(
      ctx.repos.accounts.getOrCreate({ handle: SYSTEM_HANDLE }, ctx.sealer),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect((await ctx.repos.accounts.get(SYSTEM_ACCOUNT_ID))!.system).toBe(true);
  });

  it('handles concurrent first sign-ins of the same user', async () => {
    const ctx = await setup();
    const [a, b] = await Promise.all([
      ctx.repos.accounts.getOrCreate({ handle: 'cara' }, ctx.sealer),
      ctx.repos.accounts.getOrCreate({ handle: 'cara' }, ctx.sealer),
    ]);
    expect(a.account.id).toBe(b.account.id);
    expect([a.created, b.created].filter(Boolean).length).toBe(1);
  });
});
