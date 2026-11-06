// Skill NFT market tx verification against a mocked NEAR RPC: market.buy with the market's `sale`
// event, and skills.nft_approve (to the market, at the price) with the market's `list` event.
import { describe, expect, it } from 'vitest';
import { NearRpc, RpcMarketTxVerifier, type FetchLike } from '../src/index';

const TX = '9ZsxQKpXvjhxLqC3HKbNkYfgZPhMgMHbHnfRL4y2rT5e';
const MARKET = 'market.playskirm.testnet';
const SKILLS = 'skills.playskirm.testnet';
const TOKEN = 'skl_01JB7Z3K9QX4M2T8V6N5R1C0DE:1';

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
const event = (name: string, data: unknown, standard = 'skirm_market') =>
  `EVENT_JSON:${JSON.stringify({ standard, version: '1.0.0', event: name, data: [data] })}`;

function verifier(tx: unknown, relayers: string[] = []) {
  const fetch: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ result: tx }) });
  return new RpcMarketTxVerifier(new NearRpc(['https://rpc.example'], { fetch }), MARKET, SKILLS, relayers);
}

function txOf(o: {
  signer?: string;
  receiver: string;
  method: string;
  args: unknown;
  deposit?: string;
  logs: string[];
  executor?: string;
  fail?: boolean;
}) {
  const status = o.fail ? { Failure: { ActionError: {} } } : { SuccessValue: '' };
  return {
    status,
    transaction: {
      hash: TX,
      signer_id: o.signer ?? 'bea.testnet',
      receiver_id: o.receiver,
      actions: [{ FunctionCall: { method_name: o.method, args: b64(o.args), gas: 150e12, deposit: o.deposit ?? '5' } }],
    },
    transaction_outcome: { id: TX, outcome: { logs: [], status: { SuccessReceiptId: 'r1' } } },
    receipts_outcome: [{ id: 'r1', outcome: { executor_id: o.executor ?? MARKET, status, logs: o.logs } }],
  };
}

const buyTx = (o: Partial<Parameters<typeof txOf>[0]> & { sale?: Record<string, unknown> | null } = {}) =>
  txOf({
    receiver: MARKET,
    method: 'buy',
    args: { token_id: TOKEN },
    logs:
      o.sale === null
        ? [event('purchase_failed', { token_id: TOKEN, buyer: 'bea.testnet' })]
        : [event('sale', { token_id: TOKEN, seller: 'sam.testnet', buyer: 'bea.testnet', price: '5', ...o.sale })],
    ...o,
  });

const approveTx = (o: Partial<Parameters<typeof txOf>[0]> & { list?: Record<string, unknown> | null; price?: string; to?: string } = {}) =>
  txOf({
    signer: 'sam.testnet',
    receiver: SKILLS,
    method: 'nft_approve',
    args: { token_id: TOKEN, account_id: o.to ?? MARKET, msg: JSON.stringify({ price: o.price ?? '7' }) },
    logs: o.list === null ? [] : [event('list', { token_id: TOKEN, seller: 'sam.testnet', approval_id: 1, price: '7', ...o.list })],
    ...o,
  });

describe('market purchases', () => {
  const opts = { buyerId: 'bea.testnet', tokenId: TOKEN };

  it('accepts a successful buy of the token with the market sale event', async () => {
    expect(await verifier(buyTx()).verifyPurchase(TX, opts)).toEqual({
      receipt: TX,
      tokenId: TOKEN,
      buyer: 'bea.testnet',
      seller: 'sam.testnet',
      priceYocto: 5n,
    });
  });

  it('refuses the wrong contract, signer, token, a failed transfer or a lookalike event', async () => {
    const no = async (tx: unknown, code: string, o: { buyerId?: string | null; tokenId?: string; sellerId?: string; priceYocto?: string } = {}) =>
      expect(verifier(tx).verifyPurchase(TX, { ...opts, ...o })).rejects.toMatchObject({ code });
    await no(buyTx({ receiver: 'evil.testnet' }), 'wrong_receiver');
    await no(buyTx({ signer: 'eve.testnet' }), 'wrong_sender');
    await no(buyTx({ fail: true }), 'failed');
    await no(buyTx({ args: { token_id: 'other:1' } }), 'wrong_call');
    await no(buyTx({ method: 'rent' }), 'wrong_call');
    await no(buyTx({ sale: null }), 'failed');
    await no(buyTx({ sale: { buyer: 'eve.testnet' } }), 'wrong_sender');
    await no(buyTx({ executor: 'evil.testnet' }), 'failed');
    await no(buyTx(), 'account_required', { buyerId: null });
    await expect(verifier(buyTx()).verifyPurchase('dev:5', opts)).rejects.toMatchObject({ code: 'invalid_hash' });
  });
});

describe('market listings', () => {
  const opts = { sellerId: 'sam.testnet', tokenId: TOKEN, priceYocto: '7' };

  it('accepts nft_approve of the token to the market at the price, with the list event', async () => {
    expect(await verifier(approveTx()).verifyListing(TX, opts)).toEqual({ receipt: TX });
  });

  it('refuses another approved account, price, signer, token or a missing list event', async () => {
    const no = async (tx: unknown, code: string, o: { buyerId?: string | null; tokenId?: string; sellerId?: string; priceYocto?: string } = {}) =>
      expect(verifier(tx).verifyListing(TX, { ...opts, ...o })).rejects.toMatchObject({ code });
    await no(approveTx({ receiver: MARKET }), 'wrong_receiver');
    await no(approveTx({ signer: 'eve.testnet' }), 'wrong_sender');
    await no(approveTx({ to: 'evil.testnet' }), 'wrong_call');
    await no(approveTx({ price: '8' }), 'wrong_price');
    await no(approveTx({ list: { price: '8' } }), 'wrong_price');
    await no(approveTx({ list: null }), 'failed');
    await no(approveTx(), 'wrong_call', { tokenId: 'other:1' });
    await no(approveTx({ fail: true }), 'failed');
  });
});
