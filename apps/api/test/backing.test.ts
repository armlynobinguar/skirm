// Writer backing over the api: credits mode (the keyless local stack: stakes, raise, royalty
// shares from mirrored resales, the cap, claims and refunds on paid credits) and near mode (wallet
// calls and the mirror of the backing contract's events).
import { sales } from '@skirm/db';
import { BackingTxError, type BackingEvent, type BackingTxReader } from '@skirm/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SAMPLE_SKILL, setup, type Harness, type UserClient } from './helpers';

const NEAR = 10n ** 24n;
const y = (n: bigint) => n.toString();

let h: Harness;
beforeAll(async () => {
  h = await setup();
});
afterAll(() => h.close());

async function funded(handle: string, near: bigint): Promise<UserClient> {
  const u = await h.as(handle);
  const res = await u.post('/credits/deposits', { txHash: `dev:${y(near * NEAR)}:${handle}` });
  expect(res.status).toBe(200);
  return u;
}

const balance = async (u: UserClient) => (await u.get('/credits')).body.balance as number;

let saleN = 0;
/** A resale of the skill by someone other than its writer, `price` NEAR, after now. */
async function resale(skillId: string, sellerId: string, buyerId: string, price: bigint) {
  saleN++;
  await h.db.insert(sales).values({
    id: `sal_TEST${saleN}`,
    skillId,
    version: 1,
    sellerId,
    buyerId,
    priceYocto: y(price * NEAR),
    txHash: `resale-${saleN}`,
    createdAt: new Date(Date.now() + saleN * 1000),
  });
}

describe('writer backing (credits mode)', () => {
  it('reports the mode and limits', async () => {
    const c = (await h.http().get('/backing/config')).body;
    expect(c).toMatchObject({ mode: 'credits', contractId: null, maxShareBps: 5000, minCapMultipleBps: 10000 });
  });

  it('raises, pays the writer, shares royalties pro rata up to the cap, then stops', async () => {
    const writer = await h.as('wanda');
    const skillId = (await writer.post('/skills', SAMPLE_SKILL)).body.id as string;
    await writer.post(`/skills/${skillId}/mint`);
    const bea = await funded('bea', 5n);
    const bo = await funded('bo', 5n);
    const flip = await h.as('flip');

    // 20% of royalties to backers until they got 2× the 3 NEAR raise.
    const open = await writer.post('/backing/rounds', { skillId, shareBps: 2000, capMultipleBps: 20000, maxRaiseYocto: y(3n * NEAR) });
    expect(open.status).toBe(201);
    const round = open.body.round;
    expect(round).toMatchObject({ writerHandle: 'wanda', skillId, skillName: SAMPLE_SKILL.name, status: 'open', mode: 'credits', raisedYocto: '0' });
    expect((await writer.post('/backing/rounds', { shareBps: 1000, capMultipleBps: 15000, maxRaiseYocto: y(NEAR) })).body.error.code).toBe('round_open');
    expect((await bea.post('/backing/rounds', { skillId, shareBps: 1000, capMultipleBps: 15000, maxRaiseYocto: y(NEAR) })).status).toBe(403);
    expect((await writer.post('/backing/rounds', { shareBps: 6000, capMultipleBps: 15000, maxRaiseYocto: y(NEAR) })).status).toBe(400);

    expect((await writer.post(`/backing/rounds/${round.id}/back`, { amountYocto: y(NEAR) })).body.error.code).toBe('own_round');
    expect((await bea.post(`/backing/rounds/${round.id}/back`, { amountYocto: y(NEAR / 100n) })).body.error.code).toBe('stake_too_small');
    const b1 = await bea.post(`/backing/rounds/${round.id}/back`, { amountYocto: y(2n * NEAR) });
    expect(b1.status).toBe(200);
    expect(b1.body.stakedYocto).toBe(y(2n * NEAR));
    expect(await balance(bea)).toBe(3000);
    // Bo offers 2 NEAR; only 1 NEAR of the raise is left.
    const b2 = await bo.post(`/backing/rounds/${round.id}/back`, { amountYocto: y(2n * NEAR) });
    expect(b2.body.stakedYocto).toBe(y(NEAR));
    expect(await balance(bo)).toBe(4000);
    expect((await flip.post(`/backing/rounds/${round.id}/back`, { amountYocto: y(NEAR) })).body.error.code).toBe('round_full');

    expect((await bea.post(`/backing/rounds/${round.id}/close`)).status).toBe(403);
    expect((await bea.post(`/backing/rounds/${round.id}/claim`)).body.error.code).toBe('round_not_closed');
    const closed = await writer.post(`/backing/rounds/${round.id}/close`);
    expect(closed.body.round).toMatchObject({ status: 'closed', raisedYocto: y(3n * NEAR), backers: 2, capYocto: y(6n * NEAR) });
    expect(await balance(writer)).toBe(3000);

    // A 100 NEAR resale pays a 5 NEAR royalty: 1 NEAR to the backers, 2/3 of it Bea's.
    await resale(skillId, flip.accountId, bea.accountId, 100n);
    const mine = (await bea.get('/backing/mine')).body;
    expect(mine.mode).toBe('credits');
    expect(mine.positions).toHaveLength(1);
    expect(mine.positions[0]).toMatchObject({ stakeYocto: y(2n * NEAR), capYocto: y(4n * NEAR), claimedYocto: '0' });
    expect(BigInt(mine.positions[0].earnedYocto)).toBe((2n * NEAR) / 3n);
    const c1 = await bea.post(`/backing/rounds/${round.id}/claim`);
    expect(c1.body.claimedCredits).toBe(666);
    expect(await balance(bea)).toBe(3666);
    expect((await bea.post(`/backing/rounds/${round.id}/claim`)).body.error.code).toBe('nothing_to_claim');

    // A 1,000 NEAR resale: 20% of the 50 NEAR royalty is 10, but only 5 NEAR of room is left.
    await resale(skillId, flip.accountId, bo.accountId, 1000n);
    const view = (await bea.get(`/backing/rounds/${round.id}`)).body;
    expect(view.round).toMatchObject({ backersEarnedYocto: y(6n * NEAR), royaltiesInYocto: y(55n * NEAR) });
    expect(view.payouts.map((p: { toBackersYocto: string }) => p.toBackersYocto)).toEqual([y(5n * NEAR), y(NEAR)]);
    expect(view.position.claimableYocto).toBe(y(4n * NEAR - 666n * 10n ** 21n));
    expect((await bea.post(`/backing/rounds/${round.id}/claim`)).body.claimedCredits).toBe(3334);
    expect((await bo.post(`/backing/rounds/${round.id}/claim`)).body.claimedCredits).toBe(2000);
    // Capped: further resales are the writer's alone.
    await resale(skillId, flip.accountId, bo.accountId, 1000n);
    expect((await bea.get(`/backing/rounds/${round.id}`)).body.round.backersEarnedYocto).toBe(y(6n * NEAR));
    expect((await h.http().get('/backing/rounds?writer=wanda')).body.rounds).toHaveLength(1);
    expect((await h.http().get(`/backing/rounds?skill=${skillId}&status=closed`)).body.rounds).toHaveLength(1);
    expect((await h.http().get('/backing/rounds?status=open')).body.rounds).toHaveLength(0);
  });

  it('a cancelled round returns every stake', async () => {
    const writer = await h.as('cass');
    const ben = await funded('ben', 2n);
    const round = (await writer.post('/backing/rounds', { shareBps: 1000, capMultipleBps: 15000, maxRaiseYocto: y(5n * NEAR) })).body.round;
    expect(round.skillId).toBeNull();
    await ben.post(`/backing/rounds/${round.id}/back`, { amountYocto: y(NEAR) });
    expect(await balance(ben)).toBe(1000);
    const res = await writer.post(`/backing/rounds/${round.id}/cancel`);
    expect(res.body.round.status).toBe('cancelled');
    expect(await balance(ben)).toBe(2000);
    expect(await balance(writer)).toBe(0);
    expect((await ben.get('/backing/mine')).body.positions[0]).toMatchObject({ refunded: true, claimableYocto: '0' });
    expect((await ben.post(`/backing/rounds/${round.id}/back`, { amountYocto: y(NEAR) })).body.error.code).toBe('round_not_open');
  });

  it('needs paid credits and a session', async () => {
    const writer = await h.as('dana');
    const broke = await h.as('broke');
    const round = (await writer.post('/backing/rounds', { shareBps: 1000, capMultipleBps: 15000, maxRaiseYocto: y(NEAR) })).body.round;
    const r = await broke.post(`/backing/rounds/${round.id}/back`, { amountYocto: y(NEAR) });
    expect(r.status).toBe(402);
    expect((await h.http().get('/backing/mine')).status).toBe(401);
    expect((await h.http().post('/backing/rounds').send({})).status).toBe(401);
    expect((await h.http().get('/backing/rounds/brd_nope')).status).toBe(404);
    expect((await writer.post('/backing/sync', { txHash: 'x' })).body.error.code).toBe('not_onchain');
  });
});

class FakeBackingTxs implements BackingTxReader {
  readonly contractId = 'backing.playskirm.testnet';
  readonly txs = new Map<string, { signer: string; events: BackingEvent[] }>();
  async read(txHash: string, signerId: string | null | undefined) {
    const t = this.txs.get(txHash);
    if (!t) throw new BackingTxError('not_found', 'transaction not found');
    if (t.signer !== signerId) throw new BackingTxError('wrong_sender', 'signed by another account');
    return { hash: txHash, signer: t.signer, events: t.events };
  }
}

describe('writer backing (near mode)', () => {
  let n: Harness;
  const txs = new FakeBackingTxs();
  beforeAll(async () => {
    n = await setup({ config: { BACKING_CONTRACT: 'backing.playskirm.testnet' } });
    n.deps.near.backing = txs;
  });
  afterAll(() => n.close());

  async function linked(handle: string): Promise<UserClient> {
    await n.http().post('/auth/session').set('x-dev-user', handle).send({ nearAccountId: `${handle}.testnet` });
    return n.as(handle);
  }

  it('answers wallet calls and mirrors the contract events', async () => {
    const writer = await linked('nora');
    const backer = await linked('nate');
    expect((await n.http().get('/backing/config')).body).toMatchObject({ mode: 'near', contractId: 'backing.playskirm.testnet' });

    const open = await writer.post('/backing/rounds', { shareBps: 2000, capMultipleBps: 20000, maxRaiseYocto: y(10n * NEAR) });
    expect(open.body.wallet).toMatchObject({
      contractId: 'backing.playskirm.testnet',
      methodName: 'open_round',
      args: { skill_id: null, share_bps: 2000, cap_multiple_bps: 20000, max_raise: y(10n * NEAR) },
    });
    txs.txs.set('T1', {
      signer: 'nora.testnet',
      events: [{ event: 'round_opened', data: { id: '1', writer: 'nora.testnet', skill_id: null, share_bps: 2000, cap_multiple_bps: 20000, max_raise: y(10n * NEAR) } }],
    });
    expect((await backer.post('/backing/sync', { txHash: 'T1' })).body.error.code).toBe('wrong_sender');
    const synced = await writer.post('/backing/sync', { txHash: 'T1' });
    expect(synced.status).toBe(200);
    const round = synced.body.rounds[0];
    expect(round).toMatchObject({ mode: 'near', chainRoundId: '1', status: 'open', writerHandle: 'nora' });
    // A replay mirrors nothing new.
    expect((await writer.post('/backing/sync', { txHash: 'T1' })).body.rounds[0].id).toBe(round.id);

    const back = await backer.post(`/backing/rounds/${round.id}/back`, { amountYocto: y(4n * NEAR) });
    expect(back.body.wallet).toMatchObject({ methodName: 'back', args: { round_id: '1' }, depositYocto: y(4n * NEAR) });
    txs.txs.set('T2', {
      signer: 'nate.testnet',
      events: [{ event: 'backed', data: { round_id: '1', backer: 'nate.testnet', amount: y(4n * NEAR), stake: y(4n * NEAR), raised: y(4n * NEAR) } }],
    });
    await backer.post('/backing/sync', { txHash: 'T2' });
    expect((await writer.post(`/backing/rounds/${round.id}/close`)).body.wallet.methodName).toBe('close_round');
    txs.txs.set('T3', { signer: 'nora.testnet', events: [{ event: 'round_closed', data: { round_id: '1', writer: 'nora.testnet', raised: y(4n * NEAR), backers: 1 } }] });
    await writer.post('/backing/sync', { txHash: 'T3' });
    txs.txs.set('T4', {
      signer: 'nora.testnet',
      events: [{ event: 'royalty_distributed', data: { round_id: '1', amount: y(5n * NEAR), to_backers: y(NEAR), to_writer: y(4n * NEAR), backers_earned: y(NEAR) } }],
    });
    await writer.post('/backing/sync', { txHash: 'T4' });
    await writer.post('/backing/sync', { txHash: 'T4' });
    const pos = (await backer.get('/backing/mine')).body.positions[0];
    expect(pos).toMatchObject({ stakeYocto: y(4n * NEAR), earnedYocto: y(NEAR), claimableYocto: y(NEAR), capYocto: y(8n * NEAR) });
    expect(pos.round).toMatchObject({ status: 'closed', royaltiesInYocto: y(5n * NEAR), backers: 1 });

    expect((await backer.post(`/backing/rounds/${round.id}/claim`)).body.wallet).toMatchObject({ methodName: 'claim', args: { round_id: '1' } });
    txs.txs.set('T5', { signer: 'nate.testnet', events: [{ event: 'claimed', data: { round_id: '1', backer: 'nate.testnet', amount: y(NEAR), claimed: y(NEAR) } }] });
    await backer.post('/backing/sync', { txHash: 'T5' });
    expect((await backer.get('/backing/mine')).body.positions[0]).toMatchObject({ claimedYocto: y(NEAR), claimableYocto: '0' });
  });
});
