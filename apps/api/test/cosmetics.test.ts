// Equippable cosmetics (skins, trails, nameplates): the shop, equipping per agent, and the NEP-245
// path that is off by default (NEAR_CONTRACT_COSMETICS unset → credits only).
import type { CosmeticMintInput, CosmeticsChain } from '@skirm/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type Harness, type UserClient } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await setup();
});
afterAll(async () => {
  await h.close();
});

async function funded(handle: string): Promise<UserClient> {
  const u = await h.as(handle);
  const dep = await u.post('/credits/deposits', { txHash: `dev:1000000000000000000000000:${handle}` });
  expect(dep.status).toBe(200);
  return u;
}

async function firstAgent(u: UserClient): Promise<string> {
  return ((await u.get('/agents')).body as { id: string }[])[0]!.id;
}

/** A cosmetics contract stand-in: records mints and answers balances from `held`. */
class FakeChain implements CosmeticsChain {
  readonly contractId = 'cosmetics.playskirm.testnet';
  mints: CosmeticMintInput[] = [];
  held: Record<string, Record<string, number>> = {};
  fail = false;
  rpcDown = false;
  async mint(input: CosmeticMintInput) {
    if (this.fail) throw new Error('rpc down');
    this.mints.push(input);
    const acct = (this.held[input.receiverId] ??= {});
    acct[input.itemId] = (acct[input.itemId] ?? 0) + 1;
    return { txHash: `MT${this.mints.length}`, minted: true };
  }
  async balances(near: string, ids: readonly string[]) {
    if (this.rpcDown) throw new Error('rpc down');
    return Object.fromEntries(ids.map((id) => [id, this.held[near]?.[id] ?? 0]));
  }
}

describe('equippable cosmetics, credits only (the default)', () => {
  it('lists the skins, trails and nameplates; nothing is onchain', async () => {
    const u = await h.as('coslist');
    const res = await u.get('/cosmetics');
    expect(res.status).toBe(200);
    expect(res.body.onchain).toBeNull();
    expect(res.body.equipped).toEqual({});
    expect(res.body.mints).toEqual({});
    const kinds = new Set((res.body.equip as { kind: string }[]).map((c) => c.kind));
    expect([...kinds].sort()).toEqual(['nameplate', 'skin', 'trail']);
    expect(res.body.equip).toContainEqual(
      expect.objectContaining({ id: 'skin_ember', kind: 'skin', priceCredits: 90, body: '#ff6a3d' }),
    );
    // The palette items are unchanged.
    expect(res.body.items.some((c: { id: string }) => c.id === 'outfit_gold')).toBe(true);
  });

  it('buys with paid credits, equips per slot, takes it off, and shows it on GET', async () => {
    const u = await funded('cosequip');
    const agent = await firstAgent(u);

    const early = await u.put(`/agents/${agent}/cosmetics/skin`, { itemId: 'skin_ember' });
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe('cosmetic_not_owned');

    const bought = await u.post('/cosmetics/skin_ember/buy');
    expect(bought.status).toBe(200);
    expect(bought.body).toEqual({ owned: ['skin_ember'] }); // no mint: the contract is off
    expect((await u.get('/me')).body.credits.balance).toBe(910);

    const put = await u.put(`/agents/${agent}/cosmetics/skin`, { itemId: 'skin_ember' });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ cosmetics: { skin: 'skin_ember' } });
    expect((await u.get(`/agents/${agent}/cosmetics`)).body).toEqual({
      cosmetics: { skin: 'skin_ember' },
    });
    expect((await u.get('/cosmetics')).body.equipped).toEqual({ [agent]: { skin: 'skin_ember' } });

    const wrong = await u.put(`/agents/${agent}/cosmetics/trail`, { itemId: 'skin_ember' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('wrong_slot');
    expect((await u.put(`/agents/${agent}/cosmetics/hat`, { itemId: 'skin_ember' })).status).toBe(404);
    expect((await u.put(`/agents/${agent}/cosmetics/skin`, { itemId: 'nope' })).status).toBe(404);
    expect((await u.put(`/agents/${agent}/cosmetics/skin`, { item: 'x' })).status).toBe(400);

    const off = await u.put(`/agents/${agent}/cosmetics/skin`, { itemId: null });
    expect(off.body).toEqual({ cosmetics: {} });
  });

  it('refuses dressing another player\'s agent, and minting while the contract is off', async () => {
    const ana = await funded('cosana');
    const ben = await h.as('cosben');
    await ana.post('/cosmetics/plate_gold/buy');
    const benAgent = await firstAgent(ben);
    const res = await ana.put(`/agents/${benAgent}/cosmetics/nameplate`, { itemId: 'plate_gold' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('not_agent_owner');
    const mint = await ana.post('/cosmetics/plate_gold/mint');
    expect(mint.status).toBe(503);
    expect(mint.body.error.code).toBe('cosmetics_offchain');
    expect((await h.http().get(`/agents/${benAgent}/cosmetics`)).status).toBe(401);
  });
});

describe('equippable cosmetics with the NEP-245 contract on', () => {
  it('mints a bought item to the linked NEAR account and reads ownership from the chain', async () => {
    const chain = new FakeChain();
    const saved = h.deps.near.cosmetics;
    h.deps.near.cosmetics = chain;
    try {
      // Without a linked NEAR account a purchase stays credits-only.
      const u = await funded('cosmint');
      const plain = await u.post('/cosmetics/trail_spark/buy');
      expect(plain.body).toEqual({ owned: ['trail_spark'] });
      expect((await u.post('/cosmetics/trail_spark/mint')).body.error.code).toBe('near_account_required');

      await h.http().post('/auth/session').set('x-dev-user', 'cosmint').send({ nearAccountId: 'cosmint.testnet' });
      const bought = await u.post('/cosmetics/skin_glacier/buy');
      expect(bought.status).toBe(200);
      expect(bought.body.mint).toEqual({ status: 'minted', txHash: 'MT1', owner: 'cosmint.testnet' });
      expect(chain.mints).toEqual([
        { accountId: u.accountId, itemId: 'skin_glacier', receiverId: 'cosmint.testnet' },
      ]);

      // The earlier credits-only item can be minted later, once.
      const later = await u.post('/cosmetics/trail_spark/mint');
      expect(later.body.mint).toMatchObject({ status: 'minted', txHash: 'MT2' });
      expect((await u.post('/cosmetics/trail_spark/mint')).body.mint.txHash).toBe('MT2');
      expect(chain.mints).toHaveLength(2);

      const list = (await u.get('/cosmetics')).body;
      expect(list.onchain).toEqual({ standard: 'nep245', contractId: 'cosmetics.playskirm.testnet' });
      expect(list.owned).toEqual(['skin_glacier', 'trail_spark']);
      expect(list.mints.skin_glacier).toMatchObject({ status: 'minted' });

      // Moved away onchain: no longer owned here, cannot be equipped.
      chain.held['cosmint.testnet']!.skin_glacier = 0;
      expect((await u.get('/cosmetics')).body.owned).toEqual(['trail_spark']);
      const agent = await firstAgent(u);
      expect((await u.put(`/agents/${agent}/cosmetics/skin`, { itemId: 'skin_glacier' })).status).toBe(403);
      // Received onchain without buying here: owned and wearable.
      chain.held['cosmint.testnet']!.plate_holo = 1;
      expect((await u.put(`/agents/${agent}/cosmetics/nameplate`, { itemId: 'plate_holo' })).status).toBe(200);
      // RPC down: the platform's own records decide.
      chain.rpcDown = true;
      expect((await u.get('/cosmetics')).body.owned).toEqual(['skin_glacier', 'trail_spark']);
    } finally {
      h.deps.near.cosmetics = saved;
    }
  });

  it('keeps the purchase when the mint fails, and the retry mints', async () => {
    const chain = new FakeChain();
    chain.fail = true;
    const saved = h.deps.near.cosmetics;
    h.deps.near.cosmetics = chain;
    try {
      const u = await funded('cosfail');
      await h.http().post('/auth/session').set('x-dev-user', 'cosfail').send({ nearAccountId: 'cosfail.testnet' });
      const bought = await u.post('/cosmetics/plate_gold/buy');
      expect(bought.status).toBe(200);
      expect(bought.body).toEqual({ owned: ['plate_gold'], mint: { status: 'failed', txHash: null, owner: 'cosfail.testnet' } });
      expect((await u.post('/cosmetics/plate_gold/mint')).status).toBe(502);
      chain.fail = false;
      const retry = await u.post('/cosmetics/plate_gold/mint');
      expect(retry.status).toBe(200);
      expect(retry.body.mint).toMatchObject({ status: 'minted' });
      expect((await u.post('/cosmetics/skin_toxic/mint')).body.error.code).toBe('not_owned');
    } finally {
      h.deps.near.cosmetics = saved;
    }
  });
});
