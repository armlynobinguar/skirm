// Agent rentals over the api: offers, payments (dev hashes and verified NEAR transactions), passes
// and earn-back.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await setup();
});
afterAll(() => h.close());

const ONE_NEAR = '1000000000000000000000000';

async function player(handle: string, near: string | null) {
  if (near) await h.http().post('/auth/session').set('x-dev-user', handle).send({ nearAccountId: near });
  const u = await h.as(handle);
  const [agent] = (await u.get('/agents')).body as { id: string }[];
  return { u, agent: agent! };
}

describe('agent rentals', () => {
  it('lets an owner with a NEAR account offer, reprice and end an offer for their own agent only', async () => {
    const owner = await player('oona', 'oona.testnet');
    const other = await player('otto', null);
    const set = await owner.u.put(`/agents/${owner.agent.id}/rental`, { priceYocto: ONE_NEAR });
    expect(set.status).toBe(200);
    expect(set.body.offer).toMatchObject({ agentId: owner.agent.id, priceYocto: ONE_NEAR, active: true });
    // Payouts go to a NEAR account, so offering needs one.
    expect((await other.u.put(`/agents/${other.agent.id}/rental`, { priceYocto: '5' })).body.error.code).toBe('near_account_required');
    expect((await other.u.put(`/agents/${owner.agent.id}/rental`, { priceYocto: null })).status).toBe(404);
    expect((await owner.u.put(`/agents/${owner.agent.id}/rental`, { priceYocto: '0' })).status).toBe(400);
    expect((await owner.u.get('/rentals/mine')).body.offers).toHaveLength(1);
    expect((await owner.u.put(`/agents/${owner.agent.id}/rental`, { priceYocto: null })).body.offer).toBeNull();
    expect((await owner.u.get('/rentals/mine')).body.offers).toEqual([]);
  });

  it('rents with a dev hash at or above the price, once per transaction, and pays the owner in earn-back', async () => {
    const owner = await player('rhea', 'rhea.testnet');
    const renter = await player('remy', null);
    const offer = (await owner.u.put(`/agents/${owner.agent.id}/rental`, { priceYocto: ONE_NEAR })).body.offer;
    const listed = (await renter.u.get('/rentals')).body as { offerId: string; ownerHandle: string }[];
    expect(listed.find((o) => o.offerId === offer.offerId)).toMatchObject({ ownerHandle: 'rhea', ownerNearAccountId: 'rhea.testnet' });
    // The owner never sees their own offers in the list, and cannot rent them.
    expect(((await owner.u.get('/rentals')).body as { offerId: string }[]).some((o) => o.offerId === offer.offerId)).toBe(false);
    expect((await owner.u.post(`/rentals/${offer.offerId}`, { txHash: `dev:${ONE_NEAR}:a` })).body.error.code).toBe('own_agent');

    expect((await renter.u.post(`/rentals/${offer.offerId}`, { txHash: 'dev:5:low' })).body.error.code).toBe('underpaid');
    const ok = await renter.u.post(`/rentals/${offer.offerId}`, { txHash: `dev:${ONE_NEAR}:a` });
    expect(ok.status).toBe(200);
    expect(ok.body.pass).toMatchObject({ agentId: owner.agent.id, matchId: null, priceYocto: ONE_NEAR });
    // A replay gives the same pass; another player cannot reuse the transaction.
    expect((await renter.u.post(`/rentals/${offer.offerId}`, { txHash: `dev:${ONE_NEAR}:a` })).body.pass.rentalId).toBe(ok.body.pass.rentalId);
    const third = await player('rory', null);
    expect((await third.u.post(`/rentals/${offer.offerId}`, { txHash: `dev:${ONE_NEAR}:a` })).body.error.code).toBe('duplicate_tx');

    const passes = (await renter.u.get('/rentals/mine')).body.passes;
    expect(passes.map((p: { agentId: string }) => p.agentId)).toEqual([owner.agent.id]);
    expect(passes[0].agent).toMatchObject({ ownerHandle: 'rhea', name: expect.any(String), role: expect.any(String) });
    // 5% platform fee: 0.95 NEAR to the owner.
    expect((await owner.u.get('/me/earn-back')).body.rentalsYocto).toBe('950000000000000000000000');
    expect((await renter.u.get('/me/earn-back')).body.rentalsYocto).toBe('0');
  });

  it("checks a NEAR payment's rental id, owner, renter and amount against the offer", async () => {
    const owner = await player('nell', 'nell.testnet');
    const renter = await player('nico', 'nico.testnet');
    const offer = (await owner.u.put(`/agents/${owner.agent.id}/rental`, { priceYocto: ONE_NEAR })).body.offer;
    const tx = (hash: string, o: Partial<{ rentalId: string; owner: string; renter: string; price: bigint }> = {}) => {
      const price = o.price ?? BigInt(ONE_NEAR);
      h.rpcRentals.txs.set(hash, {
        rentalId: o.rentalId ?? `${offer.offerId}:n1`,
        owner: o.owner ?? 'nell.testnet',
        renter: o.renter ?? 'nico.testnet',
        priceYocto: price,
        feeYocto: price / 20n,
        ownerProceedsYocto: price - price / 20n,
      });
      return hash;
    };
    const rent = (hash: string) => renter.u.post(`/rentals/${offer.offerId}`, { txHash: hash });
    expect((await rent(tx('A'.repeat(44), { rentalId: 'rof_01JB7Z3K9QX4M2T8V6N5R1C0DE:n1' }))).body.error.code).toBe('wrong_rental');
    expect((await rent(tx('B'.repeat(44), { owner: 'mallory.testnet' }))).body.error.code).toBe('wrong_owner');
    expect((await rent(tx('C'.repeat(44), { price: 5n }))).body.error.code).toBe('underpaid');
    expect((await rent(tx('D'.repeat(44), { renter: 'eve.testnet' }))).body.error.code).toBe('wrong_sender');
    expect((await rent('E'.repeat(44))).status).toBe(404);
    const ok = await rent(tx('F'.repeat(44)));
    expect(ok.status).toBe(200);
    expect(ok.body.pass).toMatchObject({ agentId: owner.agent.id, offerId: offer.offerId });
  });

  it('needs a session', async () => {
    expect((await h.http().get('/rentals')).status).toBe(401);
    expect((await h.http().post('/rentals/rof_01JB7Z3K9QX4M2T8V6N5R1C0DE').send({ txHash: 'dev:1' })).status).toBe(401);
  });
});
