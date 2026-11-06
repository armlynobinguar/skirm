// Agent accounts: the stored (sealed) key, the owner-only cap, and the per-match cap enforced in
// one locked transaction, so concurrent reservations never add up past it.
import { describe, expect, it } from 'vitest';
import { setup, signUp, type Ctx } from './helpers';

const NEAR = 10n ** 24n;
const KEY = {
  ciphertext: new Uint8Array([1, 2, 3]),
  iv: new Uint8Array(12),
  authTag: new Uint8Array(16),
  wrappedKey: new Uint8Array(60),
  keyId: 'test',
};

async function world(ctx: Ctx) {
  const ana = await signUp(ctx, 'ana');
  const ben = await signUp(ctx, 'ben');
  const [anaAgent] = await ctx.repos.agents.listByOwner(ana.id);
  const [benAgent] = await ctx.repos.agents.listByOwner(ben.id);
  const offer = (await ctx.repos.rentals.setOffer(ben.id, benAgent!.id, NEAR.toString()))!;
  const acct = await ctx.repos.agentAccounts.create({
    agentId: anaAgent!.id,
    ownerId: ana.id,
    nearAccountId: 'agt-a.agents.t',
    publicKey: 'ed25519:pub',
    key: KEY,
  });
  return { ana, ben, anaAgent: anaAgent!, benAgent: benAgent!, offer, acct };
}

describe('agent accounts', () => {
  it('stores one account per agent for its owner only, and only the owner sets the cap', async () => {
    const ctx = await setup();
    const { ana, ben, anaAgent, benAgent, acct } = await world(ctx);
    expect(acct).toMatchObject({ agentId: anaAgent.id, capYocto: '0', keyKeyId: 'test' });
    const again = { agentId: anaAgent.id, ownerId: ana.id, nearAccountId: 'x.agents.t', publicKey: 'p', key: KEY };
    await expect(ctx.repos.agentAccounts.create(again)).rejects.toMatchObject({ code: 'exists' });
    await expect(ctx.repos.agentAccounts.create({ ...again, agentId: benAgent.id })).rejects.toMatchObject({ code: 'not_found' });
    await expect(ctx.repos.agentAccounts.setCap(ben.id, anaAgent.id, NEAR)).rejects.toMatchObject({ code: 'not_found' });
    expect((await ctx.repos.agentAccounts.setCap(ana.id, anaAgent.id, NEAR)).capYocto).toBe(NEAR.toString());
  });

  it('holds the per-match cap across concurrent reservations, and frees it when a match uses the pass', async () => {
    const ctx = await setup();
    const { ana, ben, anaAgent, offer } = await world(ctx);
    const aa = ctx.repos.agentAccounts;
    await aa.setCap(ana.id, anaAgent.id, 3n * NEAR);
    const reserve = (amount = NEAR) =>
      aa.reserveRent({ agentId: anaAgent.id, ownerId: ana.id, offerId: offer.id, amountYocto: amount, spendableYocto: 100n * NEAR });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => reserve()));
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof reserve>>> => r.status === 'fulfilled');
    expect(ok).toHaveLength(3);
    expect(results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.code)).toEqual(
      Array(5).fill('over_cap'),
    );
    expect(await aa.committed(anaAgent.id)).toBe(3n * NEAR);

    // A failed payment frees its share; a sent one holds it until its pass is used.
    await aa.settle(ok[0]!.value.id, { status: 'failed' });
    const pass = await ctx.repos.rentals.record({
      offerId: offer.id,
      renterId: ana.id,
      priceYocto: NEAR.toString(),
      feeYocto: '0',
      ownerProceedsYocto: NEAR.toString(),
      txHash: 'H1',
    });
    await aa.settle(ok[1]!.value.id, { status: 'sent', txHash: 'H1', rentalId: pass.id });
    expect(await aa.committed(anaAgent.id)).toBe(2n * NEAR);
    await ctx.repos.rentals.consume(ana.id, [offer.agentId], 'mat_1');
    expect(await aa.committed(anaAgent.id)).toBe(NEAR);
    // Settled rows cannot be settled again.
    await expect(aa.settle(ok[0]!.value.id, { status: 'sent' })).rejects.toMatchObject({ code: 'not_found' });
    // Not the owner: no account to reserve against.
    await expect(aa.reserveRent({ agentId: anaAgent.id, ownerId: ben.id, offerId: offer.id, amountYocto: 1n, spendableYocto: NEAR })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('counts payments in flight against the balance, and keeps withdrawals and spends apart', async () => {
    const ctx = await setup();
    const { ana, anaAgent, offer } = await world(ctx);
    const aa = ctx.repos.agentAccounts;
    await aa.setCap(ana.id, anaAgent.id, 10n * NEAR);
    const first = await aa.reserveRent({ agentId: anaAgent.id, ownerId: ana.id, offerId: offer.id, amountYocto: NEAR, spendableYocto: 3n * NEAR / 2n });
    await expect(
      aa.reserveRent({ agentId: anaAgent.id, ownerId: ana.id, offerId: offer.id, amountYocto: NEAR, spendableYocto: 3n * NEAR / 2n }),
    ).rejects.toMatchObject({ code: 'insufficient_balance' });
    await expect(aa.reserveWithdraw({ agentId: anaAgent.id, ownerId: ana.id, amountYocto: 1n })).rejects.toMatchObject({ code: 'busy' });
    await aa.settle(first.id, { status: 'failed' });
    const w = await aa.reserveWithdraw({ agentId: anaAgent.id, ownerId: ana.id, amountYocto: NEAR });
    await expect(
      aa.reserveRent({ agentId: anaAgent.id, ownerId: ana.id, offerId: offer.id, amountYocto: 1n, spendableYocto: NEAR }),
    ).rejects.toMatchObject({ code: 'busy' });
    await aa.settle(w.id, { status: 'sent', txHash: 'W1' });
    // A withdrawal never counts against the per-match cap.
    expect(await aa.committed(anaAgent.id)).toBe(0n);
  });
});
