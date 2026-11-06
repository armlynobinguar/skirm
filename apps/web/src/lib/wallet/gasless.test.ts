// Gasless onboarding in the browser (./gasless.ts): the delegate path when the wallet and the api
// both allow it, and the unchanged wallet transaction otherwise. Fallbacks only happen when the api
// says nothing was sent; anything ambiguous is thrown so a purchase is never paid twice.
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import type { RelayStatus } from '../api/types';
import { FakeWallet } from '@/test/fakeWallet';
import { config } from '../config';
import { buyTx, delistTx, depositTx, listTx } from './contracts';
import { relayable, sendTransaction, type RelayApi } from './gasless';
import { WalletError } from './types';

const tx = buyTx(config.near.contracts, 'skl_X:1', '2000000000000000000000000');
const on: RelayStatus = { enabled: true, freeTxs: 3, used: 0, remaining: 3 };

function relayApi(o: { status?: RelayStatus | Error; relay?: () => Promise<{ txHash: string; remaining: number }> } = {}) {
  const api = {
    relayStatus: vi.fn(async () => {
      if (o.status instanceof Error) throw o.status;
      return o.status ?? on;
    }),
    relay: vi.fn(o.relay ?? (async () => ({ txHash: 'RELAYHASH', remaining: 2 }))),
  } satisfies RelayApi;
  return api;
}

const wallet = (delegates = true) => new FakeWallet({ connected: true, delegates });

describe('gasless sending', () => {
  it('signs a delegate and relays it when the wallet and the api allow it', async () => {
    const w = wallet();
    const api = relayApi();
    expect(await sendTransaction(w, api, tx)).toEqual({ txHash: 'RELAYHASH', gasless: true });
    expect(w.delegated).toEqual([tx]);
    expect(api.relay).toHaveBeenCalledWith(btoa('signed_delegate_1'));
    expect(w.sent).toEqual([]);
  });

  it('sends calls the relayer does not pay for (delist, backing) straight to the wallet, one prompt', async () => {
    const c = config.near.contracts;
    expect([buyTx(c, 't', '1'), depositTx(c, '1'), listTx(c, 't', '1')].every((t) => relayable(t))).toBe(true);
    const delist = delistTx(c, 'skl_X:1');
    expect(relayable(delist)).toBe(false);
    expect(relayable({ receiverId: 'backing.playskirm.testnet', actions: [{ type: 'FunctionCall', params: { methodName: 'back', args: {}, gas: '1', deposit: '1' } }] })).toBe(false);
    const w = wallet();
    const api = relayApi();
    expect(await sendTransaction(w, api, delist)).toEqual({ txHash: 'tx_1', gasless: false });
    expect(w.delegated).toEqual([]);
    expect(api.relayStatus).not.toHaveBeenCalled();
  });

  it('a wallet that cannot sign delegates sends the usual transaction and never asks the api', async () => {
    const w = wallet(false);
    const api = relayApi();
    expect(await sendTransaction(w, api, tx)).toEqual({ txHash: 'tx_1', gasless: false });
    expect(api.relayStatus).not.toHaveBeenCalled();
    expect(w.sent).toEqual([tx]);
  });

  it('a wallet without the optional methods at all works as before', async () => {
    const w = wallet();
    // FakeWallet's methods are bound arrow functions, so a copy without the two keeps working.
    const { canSignDelegate: _c, signDelegateAction: _s, ...bare } = w;
    const api = relayApi();
    expect(await sendTransaction(bare, api, tx)).toEqual({ txHash: 'tx_1', gasless: false });
    expect(api.relayStatus).not.toHaveBeenCalled();
  });

  it('falls back when the relay is off, the quota is used up or the status call fails', async () => {
    for (const status of [
      { enabled: false, freeTxs: 0, used: 0, remaining: 0 },
      { ...on, used: 3, remaining: 0 },
      new ApiError(0, 'network', 'offline'),
    ]) {
      const w = wallet();
      const api = relayApi({ status });
      expect(await sendTransaction(w, api, tx)).toEqual({ txHash: 'tx_1', gasless: false });
      expect(w.delegated).toEqual([]);
      expect(api.relay).not.toHaveBeenCalled();
    }
  });

  it('falls back when the api refuses the delegate or says the relayer sent nothing', async () => {
    for (const err of [
      new ApiError(403, 'relay_quota', 'used up'),
      new ApiError(404, 'relay_disabled', 'off'),
      new ApiError(422, 'method_not_allowed', 'no'),
      new ApiError(400, 'invalid_delegate', 'bad'),
      new ApiError(502, 'relay_failed', 'try again'),
      new ApiError(503, 'rpc_unavailable', 'down'),
    ]) {
      const w = wallet();
      const api = relayApi({ relay: async () => Promise.reject(err) });
      expect(await sendTransaction(w, api, tx)).toEqual({ txHash: 'tx_1', gasless: false });
      expect(w.sent).toEqual([tx]);
    }
  });

  it('does not send a second transaction when the relay may have gone out', async () => {
    for (const err of [new ApiError(0, 'network', 'lost'), new ApiError(500, 'internal', 'boom')]) {
      const w = wallet();
      await expect(sendTransaction(w, relayApi({ relay: async () => Promise.reject(err) }), tx)).rejects.toBe(err);
      expect(w.sent).toEqual([]);
    }
    const w = wallet();
    const failed = new ApiError(422, 'relay_tx_failed', 'failed', { txHash: 'H' });
    await expect(sendTransaction(w, relayApi({ relay: async () => Promise.reject(failed) }), tx)).rejects.toMatchObject({
      code: 'wallet_tx_failed',
    });
    expect(w.sent).toEqual([]);
  });

  it('a cancelled delegate stays cancelled; a wallet error signing it falls back', async () => {
    const w = wallet();
    w.reject('signDelegateAction');
    await expect(sendTransaction(w, relayApi(), tx)).rejects.toMatchObject({ code: 'wallet_rejected' });
    expect(w.sent).toEqual([]);

    const broken = wallet();
    broken.signDelegateAction.mockRejectedValueOnce(new WalletError('wallet_unsupported', 'nope'));
    expect(await sendTransaction(broken, relayApi(), tx)).toEqual({ txHash: 'tx_1', gasless: false });
  });
});
