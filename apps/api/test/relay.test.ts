// Gasless onboarding over the api (POST /relay, docs/gasless.md): the disabled default, the happy path
// with a fake relayer and chain, every refusal (signer, receiver, method, action, gas, signature,
// expiry, key, nonce, quota, duplicates) and what a failed relay does to the quota. Delegates are
// built and signed with near-api-js and a fresh random test key; nothing touches the network.
import { createHash } from 'node:crypto';
import { relayedTxs } from '@skirm/db';
import {
  RelayError,
  type DecodedSignedDelegate,
  type MetaTxRelayer,
} from '@skirm/server';
import { KeyPair, KeyType, Signature, actions, buildDelegateAction, encodeDelegateAction, encodeSignedDelegate } from 'near-api-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type Harness, type UserClient } from './helpers';

const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
const C = { deposits: 'deposits.playskirm.testnet', market: 'market.playskirm.testnet', skills: 'skills.playskirm.testnet' };
const HEIGHT = 5_000n;

/** The chain and relayer as the api sees them: a fixed height, known keys, recorded relays. */
class FakeRelayer implements MetaTxRelayer {
  readonly relayerId = 'relayer.testnet';
  height = HEIGHT;
  keys = new Map<string, bigint>();
  relayed: DecodedSignedDelegate[] = [];
  down = false;
  /** 'offchain': never reached the chain; 'onchain': reached it and failed. */
  fail: 'offchain' | 'onchain' | null = null;
  private n = 0;
  async blockHeight() {
    if (this.down) throw new RelayError('rpc_unavailable', 'down');
    return this.height;
  }
  async accessKeyNonce(accountId: string, publicKey: string) {
    if (this.down) throw new RelayError('rpc_unavailable', 'down');
    return this.keys.get(`${accountId}|${publicKey}`) ?? null;
  }
  async relay(d: DecodedSignedDelegate) {
    if (this.fail === 'offchain') throw new RelayError('relay_failed', 'nope');
    if (this.fail === 'onchain') throw new RelayError('relay_failed', 'failed onchain', `FAILEDHASH${++this.n}`);
    this.relayed.push(d);
    return { txHash: `RELAYHASH${++this.n}` };
  }
}

const relayer = new FakeRelayer();
const anaKey = KeyPair.fromRandom('ed25519');
let nonce = 10n;

function sign(
  o: {
    sender?: string;
    receiver?: string;
    acts?: ReturnType<typeof actions.functionCall>[];
    maxBlockHeight?: bigint;
    nonce?: bigint;
    key?: KeyPair;
    tamper?: boolean;
  } = {},
): string {
  const key = o.key ?? anaKey;
  const da = buildDelegateAction({
    senderId: o.sender ?? 'ana.testnet',
    receiverId: o.receiver ?? C.market,
    actions: o.acts ?? [actions.functionCall('buy', { token_id: 'skl_X:1' }, 150n * TGAS, 2n * NEAR)],
    nonce: o.nonce ?? ++nonce,
    maxBlockHeight: o.maxBlockHeight ?? HEIGHT + 100n,
    publicKey: key.getPublicKey(),
  });
  const hash = createHash('sha256').update(encodeDelegateAction(da)).digest();
  const sig = key.sign(new Uint8Array(hash)).signature;
  if (o.tamper) sig[0]! ^= 1;
  const sd = { delegateAction: da, signature: new Signature({ keyType: KeyType.ED25519, data: sig }) };
  return Buffer.from(encodeSignedDelegate(sd as Parameters<typeof encodeSignedDelegate>[0])).toString('base64');
}

async function linked(h: Harness, handle: string, near: string): Promise<UserClient> {
  const res = await h.http().post('/auth/session').set('x-dev-user', handle).send({ nearAccountId: near });
  expect(res.status).toBe(200);
  return h.as(handle);
}

describe('relay disabled (RELAYER_* unset)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await setup();
  });
  afterAll(() => h.close());

  it('reports it off and refuses relays with 404; the rest works as before', async () => {
    const ana = await linked(h, 'ana', 'ana.testnet');
    expect((await ana.get('/relay')).body).toEqual({ enabled: false, freeTxs: 0, used: 0, remaining: 0, linked: true });
    const res = await ana.post('/relay', { signedDelegate: sign() });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('relay_disabled');
    expect((await ana.get('/credits')).status).toBe(200);
    expect((await h.http().get('/relay')).status).toBe(401);
  });
});

describe('relay enabled', () => {
  let h: Harness;
  let ana: UserClient;
  beforeAll(async () => {
    h = await setup({ deps: { relay: { relayer, contracts: C, freeTxs: 3 } } });
    relayer.keys.set(`ana.testnet|${anaKey.getPublicKey().toString()}`, 10n);
    ana = await linked(h, 'ana', 'ana.testnet');
  });
  afterAll(() => h.close());

  const refused = async (signedDelegate: string, status: number, code: string, who: UserClient = ana) => {
    const res = await who.post('/relay', { signedDelegate });
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(res.body.error.code).toBe(code);
  };

  it('relays a valid delegate from the relayer and counts it', async () => {
    expect((await ana.get('/relay')).body).toEqual({ enabled: true, freeTxs: 3, used: 0, remaining: 3, linked: true });
    const res = await ana.post('/relay', { signedDelegate: sign() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ txHash: expect.stringMatching(/^RELAYHASH/), remaining: 2 });
    expect(relayer.relayed).toHaveLength(1);
    expect(relayer.relayed[0]).toMatchObject({ senderId: 'ana.testnet', receiverId: C.market });
    const rows = (await h.db.select().from(relayedTxs)).filter((r) => r.accountId === ana.accountId);
    expect(rows).toMatchObject([{ status: 'sent', txHash: res.body.txHash, methods: 'buy', receiverId: C.market }]);
  });

  it('relays each allowlisted call: deposit, rent, and nft_approve to the market', async () => {
    const before = relayer.relayed.length;
    expect((await ana.post('/relay', { signedDelegate: sign({ receiver: C.deposits, acts: [actions.functionCall('deposit', {}, 30n * TGAS, NEAR)] }) })).status).toBe(200);
    expect(
      (
        await ana.post('/relay', {
          signedDelegate: sign({
            receiver: C.skills,
            acts: [actions.functionCall('nft_approve', { token_id: 't:1', account_id: C.market, msg: '{"price":"1"}' }, 100n * TGAS, 10n ** 22n)],
          }),
        })
      ).status,
    ).toBe(200);
    expect(relayer.relayed.length).toBe(before + 2);
    // Three used: the quota is gone (tested below with a fresh player).
    expect((await ana.get('/relay')).body.remaining).toBe(0);
  });

  describe('refusals', () => {
    let bo: UserClient;
    const boKey = KeyPair.fromRandom('ed25519');
    const boSign = (o: Parameters<typeof sign>[0] = {}) => sign({ sender: 'bo.testnet', key: boKey, ...o });
    beforeAll(async () => {
      relayer.keys.set(`bo.testnet|${boKey.getPublicKey().toString()}`, 10n);
      bo = await linked(h, 'bo', 'bo.testnet');
    });

    it('wrong signer, receiver, method, action kind and gas', async () => {
      await refused(sign(), 403, 'wrong_signer', bo);
      await refused(boSign({ receiver: 'evil.testnet' }), 422, 'receiver_not_allowed', bo);
      await refused(boSign({ receiver: 'registry.playskirm.testnet', acts: [actions.functionCall('record_match', {}, TGAS, 0n)] }), 422, 'receiver_not_allowed', bo);
      await refused(boSign({ acts: [actions.functionCall('delist', { token_id: 't' }, 30n * TGAS, 0n)] }), 422, 'method_not_allowed', bo);
      await refused(boSign({ receiver: C.deposits, acts: [actions.functionCall('withdraw', {}, 30n * TGAS, 0n)] }), 422, 'method_not_allowed', bo);
      await refused(
        boSign({ receiver: C.skills, acts: [actions.functionCall('nft_approve', { token_id: 't', account_id: 'evil.testnet' }, 100n * TGAS, 0n)] }),
        422,
        'method_not_allowed',
        bo,
      );
      await refused(boSign({ acts: [actions.transfer(NEAR)] }), 422, 'action_not_allowed', bo);
      await refused(boSign({ acts: [actions.functionCall('buy', {}, 151n * TGAS, 0n)] }), 422, 'gas_too_high', bo);
      await refused(
        boSign({ acts: [actions.functionCall('buy', {}, 100n * TGAS, 0n), actions.functionCall('buy', {}, 100n * TGAS, 0n), actions.functionCall('buy', {}, 100n * TGAS, 0n)] }),
        422,
        'too_many_actions',
        bo,
      );
    });

    it('bad signature, expiry, unknown key, stale nonce and malformed bodies', async () => {
      await refused(boSign({ tamper: true }), 422, 'bad_signature', bo);
      await refused(boSign({ maxBlockHeight: HEIGHT }), 422, 'delegate_expired', bo);
      await refused(boSign({ maxBlockHeight: HEIGHT + 1_001n }), 422, 'delegate_too_far_ahead', bo);
      await refused(boSign({ key: KeyPair.fromRandom('ed25519') }), 422, 'unknown_key', bo);
      await refused(boSign({ nonce: 10n }), 422, 'stale_nonce', bo);
      await refused(Buffer.from('not a delegate').toString('base64'), 400, 'invalid_delegate', bo);
      expect((await bo.post('/relay', { signedDelegate: '***' })).status).toBe(400);
      expect((await bo.post('/relay', {})).status).toBe(400);
      // None of these took a slot or reached the relayer.
      expect((await bo.get('/relay')).body.remaining).toBe(3);
    });

    it('a player without a linked NEAR account', async () => {
      const cy = await h.as('cy');
      await refused(sign({ sender: 'cy.testnet' }), 409, 'near_not_linked', cy);
      expect((await cy.get('/relay')).body).toMatchObject({ enabled: true, remaining: 3, linked: false });
    });

    it('RPC down: 503, nothing reserved', async () => {
      relayer.down = true;
      await refused(boSign(), 503, 'rpc_unavailable', bo);
      relayer.down = false;
      expect((await bo.get('/relay')).body.remaining).toBe(3);
    });

    it('a relay that never reached the chain gives the slot back; one that failed onchain keeps it', async () => {
      relayer.fail = 'offchain';
      const signed = boSign();
      await refused(signed, 502, 'relay_failed', bo);
      expect((await bo.get('/relay')).body.remaining).toBe(3);
      // "Try again" sends the same signed delegate: it is relayed again, not a duplicate.
      relayer.fail = 'onchain';
      const res = await bo.post('/relay', { signedDelegate: signed });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: 'relay_tx_failed', details: { txHash: expect.stringMatching(/^FAILEDHASH/) } });
      expect((await bo.get('/relay')).body.remaining).toBe(2);
      relayer.fail = null;
    });

    it('the same delegate twice, then the quota runs out', async () => {
      const once = boSign();
      expect((await bo.post('/relay', { signedDelegate: once })).status).toBe(200);
      await refused(once, 409, 'relay_duplicate', bo);
      expect((await bo.post('/relay', { signedDelegate: boSign() })).status).toBe(200);
      expect((await bo.get('/relay')).body).toMatchObject({ used: 3, remaining: 0 });
      const n = relayer.relayed.length;
      await refused(boSign(), 403, 'relay_quota', bo);
      expect(relayer.relayed.length).toBe(n);
    });
  });
});
