// Gasless onboarding's quota (relayed_txs): slots are taken under the account lock, failed relays
// give theirs back, the NEAR account counts as well as the skirm account, and one delegate is
// relayed once.
import { describe, expect, it } from 'vitest';
import { RepoError } from '../src/index';
import { setup, signUp } from './helpers';

const input = (accountId: string, n: number, near = 'ana.testnet') => ({
  accountId,
  nearAccountId: near,
  receiverId: 'market.playskirm.testnet',
  methods: ['buy'],
  delegateHash: `hash-${accountId}-${n}`,
  quota: 2,
});

describe('relay quota', () => {
  it('takes slots up to the quota; a failed relay gives its slot back', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const r1 = await ctx.repos.relay.reserve(input(ana.id, 1));
    expect(r1).toMatchObject({ status: 'pending', methods: 'buy', nearAccountId: 'ana.testnet' });
    expect(r1.id).toMatch(/^rly_/);
    await ctx.repos.relay.markSent(r1.id, 'TXHASH');
    const r2 = await ctx.repos.relay.reserve(input(ana.id, 2));
    await expect(ctx.repos.relay.reserve(input(ana.id, 3))).rejects.toMatchObject({
      code: 'relay_quota',
      details: { quota: 2, used: 2 },
    });
    await ctx.repos.relay.markFailed(r2.id);
    expect(await ctx.repos.relay.used(ana.id, 'ana.testnet')).toBe(1);
    await ctx.repos.relay.reserve(input(ana.id, 3));
    expect(await ctx.repos.relay.used(ana.id, 'ana.testnet')).toBe(2);
  });

  it('counts the NEAR account across skirm accounts and refuses a delegate twice', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    await ctx.repos.relay.reserve(input(ana.id, 1));
    await ctx.repos.relay.reserve(input(ana.id, 2));
    // ben links the same NEAR account later: no fresh quota.
    await expect(ctx.repos.relay.reserve(input(ben.id, 1))).rejects.toMatchObject({ code: 'relay_quota' });
    expect(await ctx.repos.relay.used(ben.id, 'ben.testnet')).toBe(0);
    await ctx.repos.relay.reserve(input(ben.id, 1, 'ben.testnet'));
    const dup = await ctx.repos.relay.reserve(input(ben.id, 1, 'ben.testnet')).catch((e: unknown) => e);
    expect(dup).toBeInstanceOf(RepoError);
    expect((dup as RepoError).code).toBe('relay_duplicate');
  });

  it('serialises concurrent reservations for one account', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const results = await Promise.allSettled([1, 2, 3, 4].map((n) => ctx.repos.relay.reserve(input(ana.id, n))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
  });
});
