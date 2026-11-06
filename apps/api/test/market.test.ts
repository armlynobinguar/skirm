// /market* and /credits*, plus a secrecy sweep over every route.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FakeOwnership,
  SAMPLE_SKILL,
  setup,
  type Harness,
  type UserClient,
} from './helpers';

let h: Harness;
let seller: UserClient;
let buyer: UserClient;
let skillId: string;
let tokenId: string;

beforeAll(async () => {
  h = await setup();
  seller = await h.as('seller');
  buyer = await h.as('buyer');
  skillId = (await seller.post('/skills', SAMPLE_SKILL)).body.id;
  tokenId = (await seller.post(`/skills/${skillId}/mint`)).body.tokenId;
});
afterAll(() => h.close());

describe('market', () => {
  it('lists minted skills with their v2 proof, filters by tag', async () => {
    const all = await buyer.get('/market');
    expect(all.status).toBe(200);
    expect(all.body).toHaveLength(1);
    expect(all.body[0]).toMatchObject({
      skill: { id: skillId, version: 1, status: 'Minted' },
      creator: { handle: 'seller' },
      priceYocto: null,
      rankedWinRate: null,
      rankedMatches: 0,
      benchmarkScore: null,
      owned: false,
    });
    expect((await buyer.get('/market?tag=liquid')).body).toHaveLength(1);
    expect((await buyer.get('/market?tag=flammable')).body).toHaveLength(0);
    for (const sort of ['winrate', 'benchmark', 'price', 'new'])
      expect((await buyer.get(`/market?sort=${sort}`)).body, sort).toHaveLength(1);
    expect((await buyer.get('/market?sort=nope')).status).toBe(400);
    expect((await buyer.get('/market?tag=nope')).status).toBe(400);
  });

  it('POST listing: owner only, minted only', async () => {
    expect((await buyer.post(`/market/${skillId}/listing`, { priceYocto: '1000' })).status).toBe(
      422,
    );
    const bad = await seller.post(`/market/${skillId}/listing`, { priceYocto: '-1' });
    expect(bad.status).toBe(400);
    const res = await seller.post(`/market/${skillId}/listing`, {
      priceYocto: '2000000000000000000000000',
      txHash: 'approve-tx',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ skillId, version: 1, tokenId, status: 'active' });
    const card = (await buyer.get('/market?sort=price')).body[0];
    expect(card).toMatchObject({
      priceYocto: '2000000000000000000000000',
      skill: { status: 'Listed' },
    });
  });

  it('GET /market/:skillId has the v2 proof, sales and listing', async () => {
    const res = await buyer.get(`/market/${skillId}`);
    expect(res.status).toBe(200);
    expect(res.body.skill).toMatchObject({ id: skillId, status: 'Listed' });
    expect(res.body.benchmark).toMatchObject({ status: 'queued' });
    expect(res.body.ranked).toMatchObject({ matches: 0 });
    expect(res.body.listing).toMatchObject({ priceYocto: '2000000000000000000000000' });
    expect(res.body.owned).toBe(false);
    expect(res.body.prompt).toBeUndefined();
    // The version shown, pinned by its prompt hash (the same hash as the public skill file).
    expect(res.body.pinned).toEqual({
      version: 1,
      promptSha256: res.body.skill.prompt_sha256,
      tokenId: res.body.skill.tokenId,
      mintedAt: expect.any(String),
    });
    expect(res.body.pinned.promptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await buyer.get('/market/skl_01JB7Z3K9QX4M2T8V6N5R1C0DF')).status).toBe(404);
  });

  it('POST purchase: dev hash below price is refused, at price it transfers ownership', async () => {
    const low = await buyer.post(`/market/${skillId}/purchase`, { txHash: 'dev:1' });
    expect(low.status).toBe(422);
    expect(low.body.error.code).toBe('underpaid');
    expect(
      (
        await seller.post(`/market/${skillId}/purchase`, {
          txHash: 'dev:2000000000000000000000000',
        })
      ).status,
    ).toBe(409);
    const ok = await buyer.post(`/market/${skillId}/purchase`, {
      txHash: 'dev:2000000000000000000000000:a',
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ owned: true, sale: { buyerId: buyer.accountId, version: 1 } });
    // Replaying the same hash is idempotent for the buyer.
    expect(
      (
        await buyer.post(`/market/${skillId}/purchase`, {
          txHash: 'dev:2000000000000000000000000:a',
        })
      ).status,
    ).toBe(200);
    const detail = await buyer.get(`/market/${skillId}`);
    expect(detail.body).toMatchObject({ owned: true, skill: { owner: 'buyer', status: 'Minted' } });
    expect(detail.body.sales).toHaveLength(1);
    expect(detail.body.listing).toBeUndefined();
    // The buyer holds the skill: it equips, but the text never comes back.
    const [rook] = (await buyer.get('/agents')).body;
    const eq = await buyer.patch(`/agents/${rook.id}`, { skills: [{ id: skillId, version: 1 }] });
    expect(eq.status).toBe(200);
    const read = await buyer.get(`/skills/${skillId}`);
    expect(read.body.prompt).toBeUndefined();
    expect(read.text).not.toContain('SECRET');
    expect(
      (await buyer.get('/skills?tab=owned')).body.some((s: { id: string }) => s.id === skillId),
    ).toBe(true);
    expect((await buyer.post(`/market/${skillId}/purchase`, { txHash: 'dev:5' })).status).toBe(409);
  });

  it('DELETE listing: the seller cancels their own listing, which unblocks account deletion', async () => {
    const n = await setup();
    try {
      const s = await n.as('cs');
      const other = await n.as('co');
      const id = (await s.post('/skills', SAMPLE_SKILL)).body.id;
      await s.post(`/skills/${id}/mint`);
      expect((await s.del(`/market/${id}/listing`)).body.error.code).toBe('not_listed');
      expect((await s.post(`/market/${id}/listing`, { priceYocto: '9' })).status).toBe(200);
      expect((await s.del('/me', { confirm: 'cs' })).body.error.code).toBe('listing_active');
      // Not the seller.
      const forbidden = await other.del(`/market/${id}/listing`);
      expect(forbidden.status).toBe(403);
      expect((await other.del('/market/skl_01JB7Z3K9QX4M2T8V6N5R1C0DF/listing')).status).toBe(404);
      const res = await s.del(`/market/${id}/listing`);
      expect(res.status).toBe(200);
      // Dev mode: nothing to undo onchain.
      expect(res.body).toMatchObject({ cancelled: true, listing: { status: 'cancelled', priceYocto: '9' }, onchain: null });
      const detail = await other.get(`/market/${id}`);
      expect(detail.body.listing).toBeUndefined();
      expect(detail.body.skill.status).toBe('Minted');
      expect((await s.del(`/market/${id}/listing`)).status).toBe(409);
      expect((await s.del('/me', { confirm: 'cs' })).status).toBe(200);
    } finally {
      await n.close();
    }
  });

  it('non-dev purchases are verified against the NEAR owner', async () => {
    const n = await setup({ nearOwnership: true });
    try {
      const s = await n.as('s2');
      const b = await n
        .http()
        .post('/auth/session')
        .set('x-dev-user', 'b2')
        .send({ nearAccountId: 'b2.testnet' });
      expect(b.status).toBe(200);
      const id = (await s.post('/skills', SAMPLE_SKILL)).body.id;
      await n.repos.skills.markMinted(id, 1, `${id}:1`);
      await s.post(`/market/${id}/listing`, { priceYocto: '5' });
      const tx = '4uJg1nZ1n1YQ1oYwJr3Tqf4m8Wk2H7zXcVbN5aSdFgHj';
      const send = () =>
        n.http().post(`/market/${id}/purchase`).set('x-dev-user', 'b2').send({ txHash: tx });
      // The tx itself is read first: unknown, it proves nothing (even with the token in hand).
      (n.ownership as FakeOwnership).owners.set(`${id}:1`, 'b2.testnet');
      const unknown = await send();
      expect(unknown.status).toBe(422);
      expect(unknown.body.error).toMatchObject({ code: 'purchase_unverified', details: { reason: 'not_found' } });
      // Another buyer's tx does not count either.
      n.rpcMarket.buys.set(tx, { buyer: 'c2.testnet', tokenId: `${id}:1`, priceYocto: 5n });
      expect((await send()).body.error.details).toEqual({ reason: 'wrong_sender' });
      // Paid below the listed price.
      n.rpcMarket.buys.set(tx, { buyer: 'b2.testnet', tokenId: `${id}:1`, priceYocto: 4n });
      expect((await send()).body.error.code).toBe('underpaid');
      n.rpcMarket.buys.set(tx, { buyer: 'b2.testnet', tokenId: `${id}:1`, priceYocto: 5n });
      (n.ownership as FakeOwnership).owners.delete(`${id}:1`);
      const before = await send();
      expect(before.status).toBe(422);
      expect(before.body.error.code).toBe('purchase_unverified');
      (n.ownership as FakeOwnership).owners.set(`${id}:1`, 'b2.testnet');
      const ok = await send();
      expect(ok.status).toBe(200);
      expect(ok.body.sale).toMatchObject({ priceYocto: '5' });
    } finally {
      await n.close();
    }
  });
});

describe('credits', () => {
  it('dev deposits credit once per receipt and show in the ledger', async () => {
    const u = await h.as('payer');
    const res = await u.post('/credits/deposits', { txHash: 'dev:500000000000000000000000' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ credited: 500, balance: 500 });
    const dup = await u.post('/credits/deposits', { txHash: 'dev:500000000000000000000000' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('duplicate_receipt');
    expect((await u.post('/credits/deposits', { txHash: 'dev:1' })).status).toBe(422);
    const credits = await u.get('/credits');
    expect(credits.body).toMatchObject({ balance: 500, held: 0, allowanceLeft: 60 });
    expect(credits.body.rows[0]).toMatchObject({
      type: 'topup',
      amount: 500,
      txHash: 'dev:500000000000000000000000',
    });
  });

  it('RPC deposits need a linked NEAR account and the right sender', async () => {
    const u = await h.as('rpcpayer');
    const tx = '9uJg1nZ1n1YQ1oYwJr3Tqf4m8Wk2H7zXcVbN5aSdFgHj';
    h.rpcDeposits.txs.set(tx, { sender: 'rpcpayer.testnet', credits: 250 });
    expect((await u.post('/credits/deposits', { txHash: tx })).status).toBe(422);
    await h
      .http()
      .post('/auth/session')
      .set('x-dev-user', 'rpcpayer')
      .send({ nearAccountId: 'rpcpayer.testnet' });
    const ok = await u.post('/credits/deposits', { txHash: tx });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ credited: 250, balance: 250 });
    expect((await u.post('/credits/deposits', { txHash: 'unknownTx' })).status).toBe(404);
  });

  it('a batched deposit credits every deposit() action once, and a replay credits only what is missing', async () => {
    const u = await h.as('batchpayer');
    await h.http().post('/auth/session').set('x-dev-user', 'batchpayer').send({ nearAccountId: 'batchpayer.testnet' });
    const tx = '7uJg1nZ1n1YQ1oYwJr3Tqf4m8Wk2H7zXcVbN5aSdFgHj';
    // An earlier server credited only the first action (receipt = the bare hash).
    await h.repos.ledger.topUp({ accountId: u.accountId, credits: 100, receipt: tx });
    h.rpcDeposits.txs.set(tx, { sender: 'batchpayer.testnet', credits: 350, parts: [100, 200, 50] });
    const res = await u.post('/credits/deposits', { txHash: tx });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ credited: 250, balance: 350 });
    const dup = await u.post('/credits/deposits', { txHash: tx });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('duplicate_receipt');
    expect((await u.get('/credits')).body.balance).toBe(350);
  });

  it('dev hashes are refused outside dev mode', async () => {
    const p = await setup({
      config: { AUTH_MODE: 'privy', PRIVY_APP_ID: 'a', PRIVY_VERIFICATION_KEY: 'k' },
    });
    try {
      // No dev verifier is wired: the composite answers dev_disabled (403).
      await expect(p.deps.near.deposits.verify('dev:1000000000000000000000')).rejects.toMatchObject(
        {
          code: 'dev_disabled',
        },
      );
    } finally {
      await p.close();
    }
  });
});

describe('market signed out', () => {
  it('GET /market and /market/:skillId are public, with no caller fields and no skill text', async () => {
    const list = await h.http().get('/market');
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThan(0);
    expect(list.body.every((c: { owned: boolean }) => c.owned === false)).toBe(true);
    expect(list.text.includes('SECRET')).toBe(false);
    expect((await h.http().get('/market?tag=liquid&sort=price')).status).toBe(200);
    expect((await h.http().get('/market?sort=nope')).status).toBe(400);

    const detail = await h.http().get(`/market/${skillId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.skill).toMatchObject({ id: skillId });
    expect(detail.body.owned).toBe(false);
    expect(detail.body.trials).toEqual({ used: 0, left: expect.any(Number) });
    expect(detail.body.prompt).toBeUndefined();
    expect(detail.body.reflexes).toBeUndefined();
    expect(detail.text.includes('SECRET')).toBe(false);
  });

  it('hides drafts and keeps every write and the trial routes behind a session', async () => {
    const draft = (await seller.post('/skills', { ...SAMPLE_SKILL, name: 'Anon Draft' })).body.id;
    expect((await seller.get(`/market/${draft}`)).status).toBe(200);
    expect((await h.http().get(`/market/${draft}`)).status).toBe(404);
    expect((await h.http().get(`/market/${draft}?version=1`)).status).toBe(404);
    const listed = (await h.http().get('/market')).body.map((c: { skill: { id: string } }) => c.skill.id);
    expect(listed).not.toContain(draft);

    expect((await h.http().get(`/market/${skillId}/trials`)).status).toBe(401);
    for (const p of ['trial', 'listing', 'purchase'])
      expect((await h.http().post(`/market/${skillId}/${p}`).send({})).status, p).toBe(401);
    expect((await h.http().get('/skills')).status).toBe(401);
    expect((await h.http().get(`/skills/${skillId}`)).status).toBe(401);
  });
});

describe('secrecy', () => {
  it('no route returns the skill text to anyone but the creator', async () => {
    const paths = [
      '/me',
      '/agents',
      '/skills?tab=written',
      '/skills?tab=owned',
      `/skills/${skillId}`,
      '/market',
      `/market/${skillId}`,
      '/me/matches',
      '/leaderboards/players',
      '/bench',
      '/bench/runs',
    ];
    for (const p of paths) {
      const res = await buyer.get(p);
      expect(res.status, p).toBe(200);
      expect(res.text.includes('SECRET'), p).toBe(false);
    }
    // The creator's own lists do not carry it either; only GET /skills/:id does.
    for (const p of ['/skills?tab=written', '/market', `/market/${skillId}`]) {
      expect((await seller.get(p)).text.includes('SECRET'), p).toBe(false);
    }
    expect((await seller.get(`/skills/${skillId}`)).text).toContain('SECRET-PROMPT');
  });
});
