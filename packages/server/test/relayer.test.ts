// Gasless onboarding, server side (docs/gasless.md): the strict SignedDelegate decoder against
// delegates near-api-js builds and signs, the conversion the relayer sends (byte-identical), the
// relayer over a stubbed account and RPC (no network, no real key), and deposit verification of a
// relayed meta-transaction.
import { createHash } from 'node:crypto';
import {
  KeyPair,
  KeyType,
  PublicKey,
  Signature,
  actions,
  buildDelegateAction,
  encodeDelegateAction,
  encodeSignedDelegate,
} from 'near-api-js';
import { describe, expect, it, vi } from 'vitest';
import {
  DelegateActionNotAllowed,
  DelegateDecodeError,
  NearMetaTxRelayer,
  NearRpc,
  NearRpcError,
  RelayError,
  RpcDepositVerifier,
  createNearAdapters,
  decodeSignedDelegate,
  delegateId,
  effectiveCall,
  loadConfig,
  toNearApiSignedDelegate,
  verifyDelegateSignature,
  type FetchLike,
  type RelayerAccount,
  type TxStatus,
} from '../src/index';

const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;

/** A SignedDelegate the way a wallet makes one: near-api-js builds, a fresh test key signs. */
export function signDelegate(
  o: {
    sender?: string;
    receiver?: string;
    acts?: ReturnType<typeof actions.functionCall>[];
    nonce?: bigint;
    maxBlockHeight?: bigint;
    key?: KeyPair;
  } = {},
) {
  const key = o.key ?? KeyPair.fromRandom('ed25519');
  const da = buildDelegateAction({
    senderId: o.sender ?? 'ana.testnet',
    receiverId: o.receiver ?? 'market.playskirm.testnet',
    actions: o.acts ?? [actions.functionCall('buy', { token_id: 'skl_X:1' }, 150n * TGAS, 2n * NEAR)],
    nonce: o.nonce ?? 7n,
    maxBlockHeight: o.maxBlockHeight ?? 1_000n,
    publicKey: key.getPublicKey(),
  });
  const hash = createHash('sha256').update(encodeDelegateAction(da)).digest();
  const { signature } = key.sign(new Uint8Array(hash));
  // near-api-js exports SignedDelegate as a type only; borsh encodes the plain shape.
  const sd = { delegateAction: da, signature: new Signature({ keyType: KeyType.ED25519, data: signature }) };
  return { bytes: encodeSignedDelegate(sd as Parameters<typeof encodeSignedDelegate>[0]), key };
}

describe('SignedDelegate decoding', () => {
  it('reads what near-api-js encodes and checks the signature', () => {
    const { bytes, key } = signDelegate();
    const d = decodeSignedDelegate(bytes);
    expect(d).toMatchObject({
      senderId: 'ana.testnet',
      receiverId: 'market.playskirm.testnet',
      nonce: 7n,
      maxBlockHeight: 1_000n,
      publicKey: key.getPublicKey().toString(),
    });
    expect(d.actions).toHaveLength(1);
    expect(d.actions[0]).toMatchObject({ kind: 'FunctionCall', methodName: 'buy', gas: 150n * TGAS, deposit: 2n * NEAR });
    expect(JSON.parse(Buffer.from(d.actions[0]!.args).toString('utf8'))).toEqual({ token_id: 'skl_X:1' });
    expect(verifyDelegateSignature(d)).toBe(true);
    expect(delegateId(bytes)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a tampered signature, trailing bytes, truncation and non-function-call actions', () => {
    const { bytes } = signDelegate();
    const tampered = new Uint8Array(bytes);
    tampered[tampered.length - 1]! ^= 1;
    expect(verifyDelegateSignature(decodeSignedDelegate(tampered))).toBe(false);
    expect(() => decodeSignedDelegate(new Uint8Array([...bytes, 0]))).toThrow(DelegateDecodeError);
    expect(() => decodeSignedDelegate(bytes.subarray(0, bytes.length - 3))).toThrow(DelegateDecodeError);
    expect(() => decodeSignedDelegate(new Uint8Array(0))).toThrow(DelegateDecodeError);
    const transfer = signDelegate({ acts: [actions.transfer(NEAR)] }).bytes;
    expect(() => decodeSignedDelegate(transfer)).toThrow(DelegateActionNotAllowed);
    const mixed = signDelegate({ acts: [actions.functionCall('buy', {}, TGAS, 0n), actions.deleteAccount('evil.testnet')] }).bytes;
    expect(() => decodeSignedDelegate(mixed)).toThrow(DelegateActionNotAllowed);
  });

  it('converts back to near-api-js objects byte for byte', () => {
    const { bytes } = signDelegate({
      acts: [
        actions.functionCall('nft_approve', { token_id: 't:1', account_id: 'market.playskirm.testnet' }, 100n * TGAS, 10n ** 22n),
        actions.functionCall('buy', {}, 30n * TGAS, 0n),
      ],
    });
    const back = toNearApiSignedDelegate(decodeSignedDelegate(bytes));
    expect(Buffer.from(encodeSignedDelegate(back as Parameters<typeof encodeSignedDelegate>[0]))).toEqual(Buffer.from(bytes));
    expect(back.delegateAction.publicKey).toBeInstanceOf(PublicKey);
  });
});

describe('NearMetaTxRelayer', () => {
  const fakeRpc = (handler: (method: string, params: any) => unknown) =>
    ({
      urls: ['https://rpc.example'],
      call: vi.fn(async (method: string, params: unknown) => handler(method, params)),
    }) as unknown as NearRpc;

  it('reads the final height and an access key nonce (null when the key is not the account’s)', async () => {
    const rpc = fakeRpc((method, params) => {
      if (method === 'block') return { header: { height: 12345 } };
      if (params.public_key === 'ed25519:known') return { nonce: 42, permission: 'FullAccess' };
      throw new NearRpcError('rpc_error', 'query: UNKNOWN_ACCESS_KEY');
    });
    const r = new NearMetaTxRelayer('relayer.testnet', { signAndSendTransaction: vi.fn() } as RelayerAccount, rpc);
    expect(await r.blockHeight()).toBe(12345n);
    expect(await r.accessKeyNonce('ana.testnet', 'ed25519:known')).toBe(42n);
    expect(await r.accessKeyNonce('ana.testnet', 'ed25519:other')).toBeNull();
    const down = new NearMetaTxRelayer('relayer.testnet', { signAndSendTransaction: vi.fn() } as RelayerAccount, fakeRpc(() => {
      throw new NearRpcError('unavailable', 'all RPC endpoints failed');
    }));
    await expect(down.blockHeight()).rejects.toMatchObject({ code: 'rpc_unavailable' });
    await expect(down.accessKeyNonce('ana.testnet', 'ed25519:x')).rejects.toMatchObject({ code: 'rpc_unavailable' });
  });

  it('wraps the delegate in a transaction to its sender and returns the hash; failures keep only the type', async () => {
    const send = vi.fn(async (_args: unknown) => ({ status: { SuccessValue: '' }, transaction: { hash: 'HASH1' } }));
    const r = new NearMetaTxRelayer('relayer.testnet', { signAndSendTransaction: send } as unknown as RelayerAccount, fakeRpc(() => null));
    const d = decodeSignedDelegate(signDelegate().bytes);
    expect(await r.relay(d)).toEqual({ txHash: 'HASH1' });
    const args = send.mock.calls[0]![0] as { receiverId: string; actions: Array<{ signedDelegate?: unknown }> };
    expect(args.receiverId).toBe('ana.testnet');
    expect(args.actions).toHaveLength(1);
    expect(args.actions[0]!.signedDelegate).toBeDefined();

    const nonce = Object.assign(new Error('Invalid nonce'), { name: 'InvalidNonceError' });
    const retry = vi.fn().mockRejectedValueOnce(nonce).mockResolvedValueOnce({ status: { SuccessValue: '' }, transaction: { hash: 'HASH2' } });
    expect(await new NearMetaTxRelayer('relayer.testnet', { signAndSendTransaction: retry } as unknown as RelayerAccount, fakeRpc(() => null)).relay(d)).toEqual({ txHash: 'HASH2' });

    const boom = vi.fn().mockRejectedValue(Object.assign(new Error('secret ed25519:abc in message'), { name: 'TypedError' }));
    const err = await new NearMetaTxRelayer('relayer.testnet', { signAndSendTransaction: boom } as unknown as RelayerAccount, fakeRpc(() => null))
      .relay(d)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RelayError);
    expect((err as Error).message).not.toContain('ed25519');
    const failed = vi.fn().mockResolvedValue({ status: { Failure: {} }, transaction: { hash: 'HASH3' } });
    await expect(
      new NearMetaTxRelayer('relayer.testnet', { signAndSendTransaction: failed } as unknown as RelayerAccount, fakeRpc(() => null)).relay(d),
    ).rejects.toMatchObject({ code: 'relay_failed', txHash: 'HASH3' });
  });

  it('exists only when both RELAYER_* variables are set', () => {
    expect(createNearAdapters(loadConfig({})).relayer).toBeUndefined();
    const key = KeyPair.fromRandom('ed25519').toString();
    const on = createNearAdapters(loadConfig({ RELAYER_ACCOUNT_ID: 'relayer.testnet', RELAYER_PRIVATE_KEY: key }));
    expect(on.relayer?.relayerId).toBe('relayer.testnet');
    expect(() => loadConfig({ RELAYER_ACCOUNT_ID: 'relayer.testnet' })).toThrow(/RELAYER_PRIVATE_KEY/);
    expect(() => loadConfig({ RELAYER_ACCOUNT_ID: 'r.testnet', RELAYER_PRIVATE_KEY: 'nope' })).toThrow(/RELAYER_PRIVATE_KEY/);
    // Error text names the variable, never the value.
    try {
      loadConfig({ RELAYER_ACCOUNT_ID: 'r.testnet', RELAYER_PRIVATE_KEY: 'ed25519:short' });
    } catch (e) {
      expect(String(e)).not.toContain('ed25519:short');
    }
    expect(loadConfig({}).RELAYER_FREE_TXS).toBe(3);
  });
});

describe('relayed deposits', () => {
  const TX = '9ZsxQKpXvjhxLqC3HKbNkYfgZPhMgMHbHnfRL4y2rT5e';
  const relayedDeposit = (o: { relayer?: string; innerFails?: boolean } = {}): TxStatus => ({
    status: { SuccessValue: '' },
    transaction: {
      hash: TX,
      signer_id: o.relayer ?? 'relayer.testnet',
      receiver_id: 'ana.testnet',
      actions: [
        {
          Delegate: {
            delegate_action: {
              sender_id: 'ana.testnet',
              receiver_id: 'deposits.playskirm.testnet',
              actions: [{ FunctionCall: { method_name: 'deposit', args: 'e30=', gas: 30e12, deposit: (2n * NEAR).toString() } }],
              nonce: 8,
              max_block_height: 1000,
              public_key: 'ed25519:x',
            },
            signature: 'ed25519:sig',
          },
        },
      ],
    },
    transaction_outcome: { id: TX, outcome: { logs: [], status: { SuccessReceiptId: 'r0' } } },
    receipts_outcome: [
      { id: 'r0', outcome: { executor_id: 'ana.testnet', logs: [], status: { SuccessValue: '' } } },
      {
        id: 'r1',
        outcome: {
          executor_id: 'deposits.playskirm.testnet',
          status: o.innerFails ? { Failure: { ActionError: {} } } : { SuccessValue: '' },
          logs: [
            `EVENT_JSON:${JSON.stringify({
              standard: 'skirm_deposits',
              version: '1.0.0',
              event: 'deposit',
              data: [{ receipt: '9', player: 'ana.testnet', amount: (2n * NEAR).toString() }],
            })}`,
          ],
        },
      },
    ],
  });

  /** RPC that only finds the tx when asked with the relayer as its sender (as real RPC may). */
  const rpcFor = (tx: TxStatus) => {
    const senders: string[] = [];
    const fetch: FetchLike = async (_url, init) => {
      const body = JSON.parse(init.body);
      senders.push(body.params.sender_account_id);
      const found = body.params.sender_account_id === tx.transaction.signer_id;
      return {
        ok: true,
        status: 200,
        json: async () => (found ? { result: tx } : { error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_TRANSACTION' } } }),
      };
    };
    return { rpc: new NearRpc(['https://rpc.example'], { fetch }), senders };
  };

  it('credits a deposit the configured relayer sent for the player', async () => {
    const { rpc, senders } = rpcFor(relayedDeposit());
    const v = new RpcDepositVerifier(rpc, 'deposits.playskirm.testnet', 1000, ['relayer.testnet']);
    expect(await v.verify(TX, { senderId: 'ana.testnet' })).toMatchObject({ credits: 2000, sender: 'ana.testnet', receipt: TX });
    expect(senders).toEqual(['ana.testnet', 'relayer.testnet']);
  });

  it('refuses it without the relayer configured, from another relayer, or when the inner call failed', async () => {
    const plain = new RpcDepositVerifier(rpcFor(relayedDeposit()).rpc, 'deposits.playskirm.testnet', 1000);
    await expect(plain.verify(TX, { senderId: 'ana.testnet' })).rejects.toMatchObject({ code: 'not_found' });
    const other = rpcFor(relayedDeposit({ relayer: 'evil.testnet' }));
    const v = new RpcDepositVerifier(other.rpc, 'deposits.playskirm.testnet', 1000, ['relayer.testnet']);
    await expect(v.verify(TX, { senderId: 'ana.testnet' })).rejects.toMatchObject({ code: 'not_found' });
    expect(effectiveCall(relayedDeposit({ relayer: 'evil.testnet' }), ['relayer.testnet']).relayed).toBe(false);
    const failed = new RpcDepositVerifier(rpcFor(relayedDeposit({ innerFails: true })).rpc, 'deposits.playskirm.testnet', 1000, ['relayer.testnet']);
    await expect(failed.verify(TX, { senderId: 'ana.testnet' })).rejects.toMatchObject({ code: 'failed' });
  });
});
