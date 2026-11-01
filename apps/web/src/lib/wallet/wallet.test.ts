import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import {
  APPROVAL_STORAGE_YOCTO,
  GAS,
  buyTx,
  depositTx,
  linkMessage,
  listTx,
  normaliseSignature,
  signLinkProof,
  tokenIdOf,
} from './contracts';
import { createNearConnectWallet, txHashOf, type ConnectorFactory } from './nearConnect';
import { WalletError } from './types';

const c = config.near.contracts;

describe('contract calls', () => {
  it('defaults to the testnet deployment', () => {
    expect(config.near).toEqual({
      network: 'testnet',
      rpcUrl: 'https://test.rpc.fastnear.com',
      contracts: {
        skills: 'skills.playskirm.testnet',
        market: 'market.playskirm.testnet',
        deposits: 'deposits.playskirm.testnet',
        registry: 'registry.playskirm.testnet',
      },
    });
  });

  it('top up: deposits.deposit() with the amount attached', () => {
    expect(depositTx(c, '1000000000000000000000000')).toEqual({
      receiverId: 'deposits.playskirm.testnet',
      actions: [
        {
          type: 'FunctionCall',
          params: {
            methodName: 'deposit',
            args: {},
            gas: GAS.deposit,
            deposit: '1000000000000000000000000',
          },
        },
      ],
    });
  });

  it('buy: market.buy({token_id}) with the price attached and at least 120 Tgas (GAS_FOR_BUY)', () => {
    const tx = buyTx(c, tokenIdOf('skl_X', 2), '5000000000000000000000000');
    expect(tx.receiverId).toBe('market.playskirm.testnet');
    expect(tx.actions[0]!.params).toEqual({
      methodName: 'buy',
      args: { token_id: 'skl_X:2' },
      gas: '150000000000000',
      deposit: '5000000000000000000000000',
    });
    expect(BigInt(tx.actions[0]!.params.gas)).toBeGreaterThanOrEqual(120n * 10n ** 12n);
  });

  it('list: skills.nft_approve to the market with the price msg and approval storage', () => {
    const tx = listTx(c, 'skl_X:1', '5000000000000000000000000');
    expect(tx.receiverId).toBe('skills.playskirm.testnet');
    expect(tx.actions[0]!.params).toEqual({
      methodName: 'nft_approve',
      args: {
        token_id: 'skl_X:1',
        account_id: 'market.playskirm.testnet',
        msg: '{"price":"5000000000000000000000000"}',
      },
      gas: GAS.approve,
      deposit: APPROVAL_STORAGE_YOCTO,
    });
    expect(APPROVAL_STORAGE_YOCTO).toBe('10000000000000000000000');
  });

  it('refuses amounts that are not yocto integers', () => {
    expect(() => depositTx(c, '1.5')).toThrow('not a yoctoNEAR amount');
    expect(() => buyTx(c, 't', '-1')).toThrow();
  });
});

// The api's check (apps/api/src/near-link.ts): sha256(borsh(2^31+413) ‖ borsh(message) ‖ nonce[32]
// ‖ borsh(recipient) ‖ 0 (no callbackUrl)), ed25519 over that hash. Rebuilt here independently.
function nep413Hash(message: string, nonce: Uint8Array, recipient: string): Buffer {
  const str = (s: string) => {
    const b = Buffer.from(s, 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(b.length);
    return Buffer.concat([len, b]);
  };
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(2 ** 31 + 413);
  return createHash('sha256')
    .update(
      Buffer.concat([tag, str(message), Buffer.from(nonce), str(recipient), Buffer.from([0])]),
    )
    .digest();
}

describe('NEP-413 link proof', () => {
  it('signs skirm:link-near:<account>:<near id> and returns the fields the api verifies', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    let seenNonce: Uint8Array | null = null;
    const wallet = {
      signMessage: vi.fn(
        async (input: { message: string; recipient: string; nonce: Uint8Array }) => {
          seenNonce = input.nonce;
          const sig = sign(
            null,
            nep413Hash(input.message, input.nonce, input.recipient),
            privateKey,
          );
          return {
            accountId: 'ada.testnet',
            publicKey: 'ed25519:test',
            signature: sig.toString('base64'),
          };
        },
      ),
    };
    const proof = await signLinkProof(wallet, 'acc_1', 'ada.testnet', 'skirm.example');
    expect(wallet.signMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'skirm:link-near:acc_1:ada.testnet',
        recipient: 'skirm.example',
      }),
    );
    expect(linkMessage('acc_1', 'ada.testnet')).toBe('skirm:link-near:acc_1:ada.testnet');
    // 32 random bytes, base64 (44 characters: the api accepts 40-64).
    expect(proof.nonce).toHaveLength(44);
    expect(Buffer.from(proof.nonce!, 'base64')).toEqual(Buffer.from(seenNonce!));
    expect(proof.recipient).toBe('skirm.example');
    // The signature verifies against the envelope rebuilt from the proof's own fields.
    const { verify } = await import('node:crypto');
    const ok = verify(
      null,
      nep413Hash(
        'skirm:link-near:acc_1:ada.testnet',
        Buffer.from(proof.nonce!, 'base64'),
        proof.recipient!,
      ),
      publicKey,
      Buffer.from(proof.signature, 'base64'),
    );
    expect(ok).toBe(true);
  });

  it('normalises base58 signatures to base64 and leaves base64 alone', () => {
    const bytes = new Uint8Array(64).map((_, i) => i + 1);
    const b64 = Buffer.from(bytes).toString('base64');
    expect(normaliseSignature(b64)).toBe(b64);
    // base58 of the same bytes
    let n = BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
    const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let b58 = '';
    while (n > 0n) {
      b58 = A[Number(n % 58n)]! + b58;
      n /= 58n;
    }
    expect(normaliseSignature(b58)).toBe(b64);
    expect(normaliseSignature(`ed25519:${b58}`)).toBe(b64);
  });
});

describe('NEAR Connect wallet', () => {
  function fakeConnector(over: Record<string, unknown> = {}) {
    const handlers: Record<string, (e: unknown) => void> = {};
    const w = {
      getAccounts: vi.fn(async () => [{ accountId: 'ada.testnet' }]),
      signMessage: vi.fn(async () => ({
        accountId: 'ada.testnet',
        publicKey: 'ed25519:k',
        signature: 'sig',
      })),
      signAndSendTransaction: vi.fn(async () => ({
        transaction: { hash: 'HASH1' },
        status: { SuccessValue: '' },
      })),
      signAndSendTransactions: vi.fn(async () => [
        { transaction_outcome: { id: 'H1' } },
        { transaction: { hash: 'H2' } },
      ]),
    };
    const conn = {
      connect: vi.fn(async () => {
        handlers['wallet:signIn']?.({ accounts: [{ accountId: 'ada.testnet' }] });
        return w;
      }),
      disconnect: vi.fn(async () => handlers['wallet:signOut']?.(undefined)),
      wallet: vi.fn(async () => w),
      getConnectedWallet: vi.fn(async () => ({
        wallet: w,
        accounts: [{ accountId: 'kept.testnet' }],
      })),
      on: (e: string, cb: (e: unknown) => void) => {
        handlers[e] = cb;
      },
      ...over,
    };
    return { conn, w };
  }

  it('does not load the library until it is used', async () => {
    const { conn } = fakeConnector();
    const factory = vi.fn<ConnectorFactory>(async () => conn as never);
    const wallet = createNearConnectWallet({ network: 'testnet', factory });
    expect(factory).not.toHaveBeenCalled();
    expect(wallet.accountId()).toBeNull();
    expect(await wallet.restore()).toBe('kept.testnet');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith('testnet');
  });

  it('connects, signs as the connected account on the configured network, and disconnects', async () => {
    const { conn, w } = fakeConnector();
    const wallet = createNearConnectWallet({
      network: 'testnet',
      factory: async () => conn as never,
    });
    const seen: Array<string | null> = [];
    wallet.subscribe((id) => seen.push(id));
    expect(await wallet.connect()).toBe('ada.testnet');
    expect(wallet.accountId()).toBe('ada.testnet');

    const tx = depositTx(c, '1');
    expect(await wallet.signAndSendTransaction(tx)).toEqual({ txHash: 'HASH1' });
    expect(w.signAndSendTransaction).toHaveBeenCalledWith({
      ...tx,
      network: 'testnet',
      signerId: 'ada.testnet',
    });
    expect(await wallet.signAndSendTransactions([tx, tx])).toEqual([
      { txHash: 'H1' },
      { txHash: 'H2' },
    ]);

    const nonce = new Uint8Array(32);
    await wallet.signMessage({ message: 'm', recipient: 'r', nonce });
    expect(w.signMessage).toHaveBeenCalledWith({
      message: 'm',
      recipient: 'r',
      nonce,
      network: 'testnet',
      signerId: 'ada.testnet',
    });

    await wallet.disconnect();
    expect(wallet.accountId()).toBeNull();
    expect(seen).toEqual(['ada.testnet', null]);
  });

  it('maps a closed picker or a refusal to wallet_rejected', async () => {
    const { conn } = fakeConnector({
      connect: vi.fn(async () => Promise.reject(new Error('User rejected'))),
    });
    const wallet = createNearConnectWallet({
      network: 'testnet',
      factory: async () => conn as never,
    });
    await expect(wallet.connect()).rejects.toMatchObject({ code: 'wallet_rejected' });
  });

  it('fails a transaction NEAR reports as failed', () => {
    expect(() =>
      txHashOf({ transaction: { hash: 'H' }, status: { Failure: { ActionError: {} } } }),
    ).toThrow(WalletError);
    expect(() => txHashOf({})).toThrow('did not return a transaction hash');
    expect(txHashOf({ transaction_outcome: { id: 'X' } })).toBe('X');
  });
});
