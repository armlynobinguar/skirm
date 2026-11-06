// Agent accounts over the api (docs/agent-accounts.md): the off switch, ownership on every route,
// creation through the fake chain, the per-match spend cap (including concurrent spends), rentals
// paid by an agent's own account, withdrawals, and the custodial key never leaving the server.
import { agentAccounts, sealedKeyOf } from '@skirm/db';
import { MemoryAgentAccounts } from '@skirm/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentKeyLabel } from '../src/controllers/agent-accounts.controller';
import { bucketOf } from '../src/rate-limit';
import { setup, type Harness } from './helpers';

const ONE_NEAR = 10n ** 24n;
const near = (n: number) => (BigInt(Math.round(n * 1000)) * ONE_NEAR) / 1000n;

async function player(h: Harness, handle: string, nearId: string | null) {
  if (nearId) await h.http().post('/auth/session').set('x-dev-user', handle).send({ nearAccountId: nearId });
  const u = await h.as(handle);
  const [agent] = (await u.get('/agents')).body as { id: string }[];
  return { u, agent: agent! };
}

describe('agent accounts: off by default', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setup({ config: { NEAR_RENTALS_ONCHAIN: true } });
  });
  afterAll(() => h.close());

  it('reports disabled and refuses every change', async () => {
    const p = await player(h, 'offa', 'offa.testnet');
    expect((await p.u.get(`/agents/${p.agent.id}/account`)).body).toEqual({ enabled: false, account: null });
    for (const res of [
      await p.u.post(`/agents/${p.agent.id}/account`),
      await p.u.put(`/agents/${p.agent.id}/account/cap`, { capYocto: '1' }),
      await p.u.post(`/agents/${p.agent.id}/account/withdraw`),
      await p.u.post('/rentals/rof_01JB7Z3K9QX4M2T8V6N5R1C0DE', { agentAccount: p.agent.id }),
    ]) {
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('agent_accounts_disabled');
    }
    // The wallet and credit flows are untouched.
    const owner = await player(h, 'offo', 'offo.testnet');
    const offer = (await owner.u.put(`/agents/${owner.agent.id}/rental`, { priceYocto: ONE_NEAR.toString() })).body.offer;
    expect((await p.u.post(`/rentals/${offer.offerId}`, { txHash: `dev:${ONE_NEAR}:x` })).status).toBe(200);
  });
});

describe('agent accounts: on, with the in-memory chain', () => {
  let h: Harness;
  const chain = new MemoryAgentAccounts('agents.skirm.testnet');
  /** Every response body this suite sees, to check no key ever leaks. */
  const bodies: string[] = [];
  const seen = <T extends { body: unknown }>(res: T): T => {
    bodies.push(JSON.stringify(res.body));
    return res;
  };
  beforeAll(async () => {
    h = await setup({ config: { NEAR_RENTALS_ONCHAIN: true }, agentAccounts: chain });
  });
  afterAll(() => h.close());

  it('creates an account for the owner only, once, and needs a linked NEAR account', async () => {
    const own = await player(h, 'ada', 'ada.testnet');
    const other = await player(h, 'bob', 'bob.testnet');
    const unlinked = await player(h, 'cy', null);
    const path = `/agents/${own.agent.id}/account`;
    expect(seen(await own.u.get(path)).body).toEqual({ enabled: true, account: null });

    expect((await other.u.get(path)).status).toBe(404);
    expect((await other.u.post(path)).status).toBe(404);
    expect((await other.u.put(`${path}/cap`, { capYocto: '5' })).status).toBe(404);
    expect((await other.u.post(`${path}/withdraw`)).status).toBe(404);
    expect((await h.http().get(path)).status).toBe(401);
    expect((await h.http().post(path)).status).toBe(401);
    expect(seen(await unlinked.u.post(`/agents/${unlinked.agent.id}/account`)).body.error.code).toBe('near_account_required');

    const made = seen(await own.u.post(path));
    expect(made.status).toBe(201);
    const id = `${own.agent.id.toLowerCase().replace('_', '-')}.agents.skirm.testnet`;
    expect(made.body.account).toMatchObject({ agentId: own.agent.id, nearAccountId: id, capYocto: '0', committedYocto: '0', custodial: true });
    expect(BigInt(made.body.account.balanceYocto)).toBe(ONE_NEAR / 100n);
    // The chain got the public key the database holds; the sealed key opens to a key for it.
    const row = (await h.repos.agentAccounts.get(own.agent.id))!;
    expect(chain.accounts.get(id)?.publicKey).toBe(row.publicKey);
    expect((await own.u.post(path)).body.error.code).toBe('exists');
    // A failed onchain creation leaves no row behind.
    const late = await player(h, 'dee', 'dee.testnet');
    chain.failNext = 'create';
    expect((await late.u.post(`/agents/${late.agent.id}/account`)).status).toBe(503);
    expect(await h.repos.agentAccounts.get(late.agent.id)).toBeUndefined();
  });

  it('pays a rental from the renter agent account under its per-match cap', async () => {
    const owner = await player(h, 'olga', 'olga.testnet');
    const renter = await player(h, 'rafe', 'rafe.testnet');
    const offer = (await owner.u.put(`/agents/${owner.agent.id}/rental`, { priceYocto: ONE_NEAR.toString() })).body.offer;
    const acct = seen(await renter.u.post(`/agents/${renter.agent.id}/account`)).body.account;
    chain.fund(acct.nearAccountId, near(3));
    const rent = async () => seen(await renter.u.post(`/rentals/${offer.offerId}`, { agentAccount: renter.agent.id }));

    // The cap starts at 0: spending is off until the owner sets one.
    expect((await rent()).body.error).toMatchObject({ code: 'over_cap', details: { capYocto: '0', committedYocto: '0' } });
    expect(seen(await renter.u.put(`/agents/${renter.agent.id}/account/cap`, { capYocto: near(1.5).toString() })).body.account.capYocto).toBe(
      near(1.5).toString(),
    );
    expect((await renter.u.put(`/agents/${renter.agent.id}/account/cap`, { capYocto: '-1' })).status).toBe(400);

    const ok = await rent();
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ paidFrom: acct.nearAccountId, pass: { agentId: owner.agent.id, offerId: offer.offerId, priceYocto: ONE_NEAR.toString() } });
    expect(chain.sent.at(-1)).toMatchObject({ from: acct.nearAccountId, to: 'olga.testnet', amountYocto: ONE_NEAR, method: 'rent' });
    expect(chain.sent.at(-1)!.rentalId).toMatch(new RegExp(`^${offer.offerId}:aas_`));
    // Recorded like any rental: the tx hash on the pass, the owner's earn-back after the 5% fee.
    expect((await h.repos.rentals.byTx(ok.body.txHash))?.id).toBe(ok.body.pass.rentalId);
    expect((await owner.u.get('/me/earn-back')).body.rentalsYocto).toBe('950000000000000000000000');
    expect((await renter.u.get(`/agents/${renter.agent.id}/account`)).body.account.committedYocto).toBe(ONE_NEAR.toString());

    // A second pass for the same coming match would pass the cap.
    expect((await rent()).body.error.code).toBe('over_cap');
    // Once the match uses the pass, the next match has the whole cap again. A failed payment
    // costs nothing and holds nothing.
    await h.repos.rentals.consume(renter.u.accountId, [owner.agent.id], 'mat_01JB7Z3K9QX4M2T8V6N5R1C0DE');
    chain.failNext = 'rent';
    expect((await rent()).body.error.code).toBe('payment_failed');
    expect((await renter.u.get(`/agents/${renter.agent.id}/account`)).body.account.committedYocto).toBe('0');
    expect((await rent()).status).toBe(200);

    // Only the renter's own agents pay; never the owner's own offer.
    const mallory = await player(h, 'mal', 'mal.testnet');
    expect((await mallory.u.post(`/rentals/${offer.offerId}`, { agentAccount: renter.agent.id })).status).toBe(404);
    expect((await owner.u.post(`/rentals/${offer.offerId}`, { agentAccount: owner.agent.id })).body.error.code).toBe('own_agent');
    await h.repos.rentals.consume(renter.u.accountId, [owner.agent.id], 'mat_01JB7Z3K9QX4M2T8V6N5R1C0DF');
    // Not enough balance (3 - 2 paid leaves less than 1 spendable after the reserve).
    expect((await rent()).body.error.code).toBe('insufficient_balance');
  });

  it('holds the cap under concurrent spends', async () => {
    const owner = await player(h, 'opal', 'opal.testnet');
    const renter = await player(h, 'rhys', 'rhys.testnet');
    const offer = (await owner.u.put(`/agents/${owner.agent.id}/rental`, { priceYocto: ONE_NEAR.toString() })).body.offer;
    const acct = (await renter.u.post(`/agents/${renter.agent.id}/account`)).body.account;
    chain.fund(acct.nearAccountId, near(20));
    await renter.u.put(`/agents/${renter.agent.id}/account/cap`, { capYocto: near(2.5).toString() });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => renter.u.post(`/rentals/${offer.offerId}`, { agentAccount: renter.agent.id })),
    );
    for (const r of results) seen(r);
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect(results.filter((r) => r.body.error?.code === 'over_cap')).toHaveLength(4);
    expect(chain.sent.filter((s) => s.from === acct.nearAccountId && s.method === 'rent')).toHaveLength(2);
    expect((await renter.u.get('/rentals/mine')).body.passes).toHaveLength(2);
    // Straight at the repo too: many reservations at once, one locked row, never over the cap.
    const spends = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        h.repos.agentAccounts.reserveRent({
          agentId: renter.agent.id,
          ownerId: renter.u.accountId,
          offerId: offer.offerId,
          amountYocto: near(0.2),
          spendableYocto: near(100),
        }),
      ),
    );
    // 2 committed already: 0.5 NEAR left under the cap, so two 0.2 reservations fit.
    expect(spends.filter((s) => s.status === 'fulfilled')).toHaveLength(2);
  });

  it('withdraws to the owner linked account only', async () => {
    const own = await player(h, 'wren', 'wren.testnet');
    const acct = (await own.u.post(`/agents/${own.agent.id}/account`)).body.account;
    chain.fund(acct.nearAccountId, near(2));
    const other = await player(h, 'wade', 'wade.testnet');
    expect((await other.u.post(`/agents/${own.agent.id}/account/withdraw`)).status).toBe(404);
    expect((await own.u.post(`/agents/${own.agent.id}/account/withdraw`, { amountYocto: near(50).toString() })).body.error.code).toBe(
      'insufficient_balance',
    );
    expect((await own.u.post(`/agents/${own.agent.id}/account/withdraw`, { to: 'wade.testnet' })).status).toBe(400);
    const res = seen(await own.u.post(`/agents/${own.agent.id}/account/withdraw`));
    expect(res.status).toBe(200);
    // Everything above the storage and gas reserve.
    expect(res.body).toMatchObject({ to: 'wren.testnet', amountYocto: (near(2.01) - 182n * 10n ** 19n - near(0.01)).toString() });
    expect(chain.sent.at(-1)).toMatchObject({ from: acct.nearAccountId, to: 'wren.testnet', method: 'transfer', amountYocto: BigInt(res.body.amountYocto) });
    expect(res.body.account.spendableYocto).toBe('0');
    expect((await own.u.post(`/agents/${own.agent.id}/account/withdraw`)).body.error.code).toBe('nothing_to_withdraw');
  });

  it('never returns or exposes the custodial key', async () => {
    const all = await h.repos.db.select().from(agentAccounts);
    expect(all.length).toBe(4);
    const text = bodies.join('\n');
    for (const row of all) {
      const secret = await h.deps.vault.decryptSecret(agentKeyLabel(row.nearAccountId), sealedKeyOf(row));
      expect(secret).toMatch(/^ed25519:/);
      expect(text).not.toContain(secret);
      expect(text).not.toContain(secret.slice('ed25519:'.length, 40));
      // The sealed parts never go out either.
      expect(text).not.toContain(Buffer.from(row.keyCiphertext).toString('base64'));
      // A row moved to another account does not open.
      await expect(h.deps.vault.decryptSecret(agentKeyLabel('someone-else.testnet'), sealedKeyOf(row))).rejects.toThrow();
    }
    expect(text).not.toMatch(/secret|keyCiphertext|wrapped/i);
  });

  it('puts the mutating routes in the strict rate-limit bucket', () => {
    expect(bucketOf('POST', '/agents/agt_x/account')).toBe('strict');
    expect(bucketOf('POST', '/agents/agt_x/account/withdraw')).toBe('strict');
    expect(bucketOf('PUT', '/agents/agt_x/account/cap')).toBe('strict');
    expect(bucketOf('GET', '/agents/agt_x/account')).toBe('general');
  });
});
