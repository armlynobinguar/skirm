// What gasless onboarding (docs/gasless.md) may relay. The relayer pays gas for a player's first few
// transactions to skirm's own contracts, so every SignedDelegate is checked here before the relayer
// signs anything:
//
//   signer      the delegate's sender is the caller's linked NEAR account
//   receiver    one of skirm's contracts (deposits, market, skills)
//   actions     1 to MAX_ACTIONS, all FunctionCall, each to a method allowlisted for that receiver
//               (nft_approve only with the market as the approved account)
//   gas         at most MAX_GAS_PER_ACTION per action and MAX_GAS_TOTAL in all
//   signature   valid ed25519 over the NEP-461-prefixed delegate action
//   expiry      max_block_height above the final height and at most MAX_BLOCKS_AHEAD past it
//   key, nonce  the key is one of the sender's access keys and the nonce is above the key's
//   quota       the player still has free relayed transactions (relayed_txs)
//
// Attached deposits are not limited: they come from the player's own account inside the delegate
// (the price of a skill, a top-up), never from the relayer. checkDelegate() is the pure part (no
// RPC, no DB); the controller adds the chain and quota checks.
import type { DecodedSignedDelegate, MetaTxRelayer } from '@skirm/server';
import { ApiError } from './errors';

const TGAS = 10n ** 12n;
export const MAX_ACTIONS = 2;
/** market.buy needs at least 120 Tgas; the web attaches 150 (apps/web/src/lib/wallet/contracts.ts). */
export const MAX_GAS_PER_ACTION = 150n * TGAS;
export const MAX_GAS_TOTAL = 300n * TGAS;
/** About 15 minutes of blocks; wallets usually sign for ~120 blocks. */
export const MAX_BLOCKS_AHEAD = 1_000n;
/** Base64 of a SignedDelegate; skirm's own calls are far below this. */
export const MAX_DELEGATE_BASE64 = 8_192;

export interface RelayContracts {
  deposits: string;
  market: string;
  skills: string;
}

export interface RelayDeps {
  relayer: MetaTxRelayer;
  contracts: RelayContracts;
  /** Free relayed transactions per player (RELAYER_FREE_TXS). */
  freeTxs: number;
}

/** Methods the relayer pays for, per contract (the calls apps/web/src/lib/wallet/contracts.ts makes). */
export function allowedMethods(c: RelayContracts): Map<string, ReadonlySet<string>> {
  return new Map<string, ReadonlySet<string>>([
    [c.deposits, new Set(['deposit'])],
    [c.market, new Set(['buy', 'rent'])],
    [c.skills, new Set(['nft_approve'])],
  ]);
}

const refuse = (code: string, message: string, details?: Record<string, unknown>) => new ApiError(422, code, message, details);

function jsonArgs(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The checks that need neither RPC nor the database. Throws ApiError (403 `wrong_signer`, 422 for
 * the rest); `verifySignature` is passed in so tests can count calls.
 */
export function checkDelegate(
  d: DecodedSignedDelegate,
  ctx: { linkedNearAccount: string; contracts: RelayContracts; verifySignature: (d: DecodedSignedDelegate) => boolean },
): void {
  if (d.senderId !== ctx.linkedNearAccount)
    throw new ApiError(403, 'wrong_signer', 'the transaction is signed by another NEAR account than the linked one', {
      linked: ctx.linkedNearAccount,
    });
  const methods = allowedMethods(ctx.contracts).get(d.receiverId);
  if (!methods) throw refuse('receiver_not_allowed', `skirm only pays gas for calls to its own contracts`, { receiverId: d.receiverId });
  if (d.actions.length > MAX_ACTIONS) throw refuse('too_many_actions', `at most ${MAX_ACTIONS} actions`);
  let total = 0n;
  for (const a of d.actions) {
    if (!methods.has(a.methodName))
      throw refuse('method_not_allowed', `${a.methodName} on ${d.receiverId} is not paid for`, { method: a.methodName });
    if (a.gas > MAX_GAS_PER_ACTION)
      throw refuse('gas_too_high', `at most ${MAX_GAS_PER_ACTION / TGAS} Tgas per call`, { maxTgas: Number(MAX_GAS_PER_ACTION / TGAS) });
    total += a.gas;
    if (a.methodName === 'nft_approve') {
      // Approving the market lists a skill; approving anyone else is not skirm's business to pay for.
      const args = jsonArgs(a.args);
      if (!args || args.account_id !== ctx.contracts.market)
        throw refuse('method_not_allowed', 'nft_approve is only paid for when it approves the market');
    }
  }
  if (total > MAX_GAS_TOTAL)
    throw refuse('gas_too_high', `at most ${MAX_GAS_TOTAL / TGAS} Tgas in all`, { maxTgas: Number(MAX_GAS_TOTAL / TGAS) });
  if (!ctx.verifySignature(d)) throw refuse('bad_signature', 'the signature does not match the transaction');
}

/** The checks against the chain: expiry and the signing key's nonce. */
export async function checkOnChain(d: DecodedSignedDelegate, relayer: MetaTxRelayer): Promise<void> {
  const height = await relayer.blockHeight();
  if (d.maxBlockHeight <= height) throw refuse('delegate_expired', 'the signed transaction has expired, sign it again');
  if (d.maxBlockHeight > height + MAX_BLOCKS_AHEAD)
    throw refuse('delegate_too_far_ahead', `the signed transaction must expire within ${MAX_BLOCKS_AHEAD} blocks`);
  const nonce = await relayer.accessKeyNonce(d.senderId, d.publicKey);
  if (nonce === null) throw refuse('unknown_key', 'the signing key is not a key of the NEAR account');
  if (d.nonce <= nonce) throw refuse('stale_nonce', 'the signed transaction was already used, sign it again');
}
