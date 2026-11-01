// Linking a NEAR account to a player (POST /auth/session `nearAccountId`). Deposits trust the
// linked account as the signer, so outside dev mode the player proves control: an ed25519
// signature over linkMessage() with a full-access key of that account, checked via RPC. Wallets
// sign through NEP-413 `signMessage` (send its nonce and recipient with the proof); a raw ed25519
// signature over the message text is accepted too.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { NearRpcError, type NearRpc } from '@skirm/server';

export interface NearKeyChecker {
  /** Is `publicKey` (`ed25519:<base58>`) a full-access key of `accountId`? */
  isFullAccessKey(accountId: string, publicKey: string): Promise<boolean>;
}

export class RpcNearKeyChecker implements NearKeyChecker {
  constructor(private readonly rpc: NearRpc) {}
  async isFullAccessKey(accountId: string, publicKey: string): Promise<boolean> {
    try {
      const key = await this.rpc.call<{ permission?: unknown }>('query', {
        request_type: 'view_access_key',
        finality: 'final',
        account_id: accountId,
        public_key: publicKey,
      });
      return key.permission === 'FullAccess';
    } catch (err) {
      if (err instanceof NearRpcError && err.code !== 'unavailable') return false;
      throw err;
    }
  }
}

/** The exact UTF-8 text the wallet signs. Bound to both ids, so a proof links one pair only. */
export const linkMessage = (accountId: string, nearAccountId: string) =>
  `skirm:link-near:${accountId}:${nearAccountId}`;

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Decode(s: string): Uint8Array | undefined {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) return undefined;
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 255n));
    n >>= 8n;
  }
  for (const ch of s) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}

/** NEP-413 `signMessage` fields: wallets sign a hashed envelope, not the raw message. */
export interface Nep413Fields {
  /** base64 of the 32-byte nonce the client passed to `signMessage`. */
  nonce: string;
  recipient: string;
  callbackUrl?: string;
}

const NEP413_TAG = 2 ** 31 + 413;

const borshString = (s: string) => {
  const b = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length);
  return Buffer.concat([len, b]);
};

/** sha256(borsh(tag: u32) ‖ borsh({message, nonce: [u8; 32], recipient, callbackUrl?})). */
export function nep413Hash(message: string, f: Nep413Fields): Buffer | undefined {
  const nonce = Buffer.from(f.nonce, 'base64');
  if (nonce.length !== 32) return undefined;
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(NEP413_TAG);
  const cb =
    f.callbackUrl === undefined
      ? Buffer.from([0])
      : Buffer.concat([Buffer.from([1]), borshString(f.callbackUrl)]);
  return createHash('sha256')
    .update(Buffer.concat([tag, borshString(message), nonce, borshString(f.recipient), cb]))
    .digest();
}

/**
 * ed25519 check of a base64 signature by `ed25519:<base58>` over `message`: the raw UTF-8 bytes,
 * or, when `nep413` is given, the NEP-413 envelope a NEAR wallet's `signMessage` signs.
 */
export function verifyNearSignature(
  publicKey: string,
  message: string,
  signatureB64: string,
  nep413?: Nep413Fields,
): boolean {
  const m = /^ed25519:([1-9A-HJ-NP-Za-km-z]{32,50})$/.exec(publicKey);
  const raw = m ? base58Decode(m[1]!) : undefined;
  const sig = Buffer.from(signatureB64, 'base64');
  if (!raw || raw.length !== 32 || sig.length !== 64) return false;
  const data = nep413 ? nep413Hash(message, nep413) : Buffer.from(message, 'utf8');
  if (!data) return false;
  try {
    const key = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(raw).toString('base64url') },
      format: 'jwk',
    });
    return verify(null, data, key, sig);
  } catch {
    return false;
  }
}
