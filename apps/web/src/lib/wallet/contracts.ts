// The skirm contract calls a player's wallet signs (contracts/README.md, "Interfaces"), and the
// NEP-413 proof that links a NEAR account (apps/api/src/near-link.ts).
//
//   top up   deposits.deposit()                        attached: the amount       30 Tgas
//   buy      market.buy({token_id})                    attached: the price        150 Tgas (≥ 120 needed)
//   rent     market.rent({rental_id, owner_id, price}) attached: the price         60 Tgas
//   list     skills.nft_approve({token_id,             attached: 0.01 NEAR        100 Tgas
//              account_id: market, msg: {"price"}})      (approval storage; the excess is refunded)
//   link     signMessage("skirm:link-near:<skirm account id>:<near account id>")  NEP-413
//
// Mint (S08) needs no wallet: the api mints with the ops key (Minter) to the linked account.
import type { NearProof } from '../api/types';
import type { NearConfig } from '../config';
import type { FunctionCallAction, NearTransaction, NearWallet, SignedMessage } from './types';

const TGAS = 10n ** 12n;
export const GAS = {
  deposit: (30n * TGAS).toString(),
  buy: (150n * TGAS).toString(),
  approve: (100n * TGAS).toString(),
  rent: (60n * TGAS).toString(),
} as const;

/** Attached to nft_approve for the approval's storage; the skills contract refunds the excess. */
export const APPROVAL_STORAGE_YOCTO = (10n ** 22n).toString(); // 0.01 NEAR

type Contracts = NearConfig['contracts'];

const call = (
  methodName: string,
  args: Record<string, unknown>,
  gas: string,
  deposit: string,
): FunctionCallAction => ({
  type: 'FunctionCall',
  params: { methodName, args, gas, deposit },
});

const yocto = (v: string) => {
  if (!/^[0-9]{1,40}$/.test(v)) throw new Error(`not a yoctoNEAR amount: ${v}`);
  return v;
};

/** Token id on the skills contract: `<skill id>:<version>`. */
export const tokenIdOf = (skillId: string, version: number) => `${skillId}:${version}`;

export function depositTx(c: Contracts, amountYocto: string): NearTransaction {
  return {
    receiverId: c.deposits,
    actions: [call('deposit', {}, GAS.deposit, yocto(amountYocto))],
  };
}

export function buyTx(c: Contracts, tokenId: string, priceYocto: string): NearTransaction {
  return {
    receiverId: c.market,
    actions: [call('buy', { token_id: tokenId }, GAS.buy, yocto(priceYocto))],
  };
}

/**
 * Pays for one match with another player's agent. `rental_id` is the offer id and a nonce, which the
 * api matches to the offer; the market takes the platform fee and pays `ownerId` the rest.
 */
export function rentTx(c: Contracts, offerId: string, nonce: string, ownerId: string, priceYocto: string): NearTransaction {
  return {
    receiverId: c.market,
    actions: [call('rent', { rental_id: `${offerId}:${nonce}`, owner_id: ownerId, price: yocto(priceYocto) }, GAS.rent, yocto(priceYocto))],
  };
}

/** Lists (or reprices: the market replaces the listing) through `nft_approve` on the skills contract. */
export function listTx(c: Contracts, tokenId: string, priceYocto: string): NearTransaction {
  return {
    receiverId: c.skills,
    actions: [
      call(
        'nft_approve',
        {
          token_id: tokenId,
          account_id: c.market,
          msg: JSON.stringify({ price: yocto(priceYocto) }),
        },
        GAS.approve,
        APPROVAL_STORAGE_YOCTO,
      ),
    ],
  };
}

/** The exact text the api verifies (apps/api/src/near-link.ts linkMessage). */
export const linkMessage = (accountId: string, nearAccountId: string) =>
  `skirm:link-near:${accountId}:${nearAccountId}`;

/** The link message signed during sign-in, before the NEAR account is known (api linkSignInMessage). */
export const linkSignInMessage = (accountId: string) => `skirm:link-near:${accountId}`;

/** 32 random bytes for a NEP-413 nonce. */
export function newNonce(): Uint8Array {
  const nonce = new Uint8Array(32);
  crypto.getRandomValues(nonce);
  return nonce;
}

/** The `nearProof` body for a NEP-413 signature. */
export function proofOf(signed: SignedMessage, nonce: Uint8Array, recipient: string): NearProof {
  return { publicKey: signed.publicKey, signature: normaliseSignature(signed.signature), nonce: base64(nonce), recipient };
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(s: string): Uint8Array | null {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const out: number[] = [];
  while (n > 0n) {
    out.unshift(Number(n & 255n));
    n >>= 8n;
  }
  for (const ch of s) {
    if (ch !== '1') break;
    out.unshift(0);
  }
  return new Uint8Array(out);
}

/**
 * NEP-413 says base64, but a few wallets hand back `ed25519:<base58>` or bare base58. The api wants
 * base64 of the 64 signature bytes.
 */
export function normaliseSignature(sig: string): string {
  const bare = sig.replace(/^ed25519:/, '');
  // Base64 of 64 bytes is 88 characters ending in "=="; base58 has no "=", "+" or "/".
  if (/[=+/]/.test(bare)) return bare;
  const b58 = base58Decode(bare);
  return b58 && b58.length === 64 ? base64(b58) : bare;
}

/** NEP-413 recipient: the site's host (the api only needs it to rebuild the signed envelope). */
export function linkRecipient(): string {
  return typeof window !== 'undefined' && window.location.host ? window.location.host : 'skirm';
}

/**
 * Signs the link message with the connected wallet and returns the `nearProof` for
 * POST /auth/session `{ nearAccountId, nearProof }`.
 */
export async function signLinkProof(
  wallet: Pick<NearWallet, 'signMessage'>,
  accountId: string,
  nearAccountId: string,
  recipient = linkRecipient(),
): Promise<NearProof> {
  const nonce = newNonce();
  const signed = await wallet.signMessage({
    message: linkMessage(accountId, nearAccountId),
    recipient,
    nonce,
  });
  return proofOf(signed, nonce, recipient);
}
