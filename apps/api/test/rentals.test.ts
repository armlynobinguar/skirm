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

  it('pays in credits while rentals are offchain: spend, owner share, idempotent key, refusals', async () => {
    const owner = await player('cora', 'cora.testnet');
    const renter = await player('cyd', null);
    const offer = (await owner.u.put(`/agents/${owner.agent.id}/rental`, { priceYocto: ONE_NEAR })).body.offer;
    const listed = ((await renter.u.get('/rentals')).body as { offerId: string }[]).find((o) => o.offerId === offer.offerId);
    expect(listed).toMatchObject({ payWith: 'credits', priceCredits: 1000 });
    const rent = (key: string, who = renter) => who.u.post(`/rentals/${offer.offerId}`, { credits: true, key });

    // Paid credits only: the free allowance never pays a rental.
    const broke = await rent('k1');
    expect(broke.status).toBe(402);
    expect(broke.body.error).toMatchObject({ code: 'insufficient_credits', need: 1000, have: 0 });
    expect((await renter.u.post('/credits/deposits', { txHash: `dev:${2n * BigInt(ONE_NEAR)}` })).status).toBe(200);

    const ok = await rent('k1');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ credits: 1000, pass: { agentId: owner.agent.id, offerId: offer.offerId, priceYocto: ONE_NEAR, matchId: null } });
    // A retry of the same click returns the same pass and charges nothing.
    const again = await rent('k1');
    expect(again.body).toMatchObject({ credits: 0, pass: { rentalId: ok.body.pass.rentalId } });
    expect((await renter.u.get('/credits')).body.balance).toBe(1000);
    // The owner gets the price minus the 5% fee, as credits.
    const ownerCredits = (await owner.u.get('/credits')).body;
    expect(ownerCredits.balance).toBe(950);
    expect(ownerCredits.rows).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'topup', amount: 950, note: 'rental' })]));
    expect((await renter.u.get('/credits')).body.rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'spend', amount: 1000, note: 'rental' })]),
    );
    expect((await renter.u.get('/rentals/mine')).body.passes).toHaveLength(1);
    // Earn-back's NEAR line counts NEAR only; this share arrived as credits.
    expect((await owner.u.get('/me/earn-back')).body.rentalsYocto).toBe('0');

    // Another renter cannot claim the key; the owner cannot rent; a malformed body is a 400.
    const other = await player('cato', null);
    expect((await rent('k1', other)).body.error.code).toBe('duplicate_tx');
    expect((await rent('k2', owner)).body.error.code).toBe('own_agent');
    expect((await renter.u.post(`/rentals/${offer.offerId}`, { credits: true, key: 'bad key!' })).status).toBe(400);
    // An ended offer takes no new credit rentals but still answers a retry.
    await owner.u.put(`/agents/${owner.agent.id}/rental`, { priceYocto: null });
    expect((await rent('k3')).body.error.code).toBe('not_offered');
    expect((await rent('k1')).body.pass.rentalId).toBe(ok.body.pass.rentalId);
    expect((await renter.u.get('/credits')).body.balance).toBe(1000);
  });

  it('needs a session', async () => {
    expect((await h.http().get('/rentals')).status).toBe(401);
    expect((await h.http().post('/rentals/rof_01JB7Z3K9QX4M2T8V6N5R1C0DE').send({ txHash: 'dev:1' })).status).toBe(401);
  });
});

describe('agent rentals with NEAR_RENTALS_ONCHAIN', () => {
  let on: Harness;
  beforeAll(async () => {
    on = await setup({ config: { NEAR_RENTALS_ONCHAIN: true } });
  });
  afterAll(() => on.close());

  it('lists offers as paid with NEAR, refuses credits and grants a verified market.rent payment', async () => {
    await on.http().post('/auth/session').set('x-dev-user', 'olga').send({ nearAccountId: 'olga.testnet' });
    await on.http().post('/auth/session').set('x-dev-user', 'ivo').send({ nearAccountId: 'ivo.testnet' });
    const owner = await on.as('olga');
    const renter = await on.as('ivo');
    const [agent] = (await owner.get('/agents')).body as { id: string }[];
    const offer = (await owner.put(`/agents/${agent!.id}/rental`, { priceYocto: ONE_NEAR })).body.offer;
    expect(((await renter.get('/rentals')).body as { payWith: string }[])[0]).toMatchObject({ offerId: offer.offerId, payWith: 'near' });
    const credits = await renter.post(`/rentals/${offer.offerId}`, { credits: true, key: 'k1' });
    expect(credits.status).toBe(409);
    expect(credits.body.error.code).toBe('rentals_onchain');

    const hash = 'G'.repeat(44);
    on.rpcRentals.txs.set(hash, {
      rentalId: `${offer.offerId}:n1`,
      owner: 'olga.testnet',
      renter: 'ivo.testnet',
      priceYocto: BigInt(ONE_NEAR),
      feeYocto: BigInt(ONE_NEAR) / 20n,
      ownerProceedsYocto: BigInt(ONE_NEAR) - BigInt(ONE_NEAR) / 20n,
    });
    const ok = await renter.post(`/rentals/${offer.offerId}`, { txHash: hash });
    expect(ok.status).toBe(200);
    // Retries of the same tx are answered with the same pass.
    expect((await renter.post(`/rentals/${offer.offerId}`, { txHash: hash })).body.pass.rentalId).toBe(ok.body.pass.rentalId);
    expect((await renter.get('/rentals/mine')).body.passes).toHaveLength(1);
  });
});
