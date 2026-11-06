// Gasless onboarding (docs/gasless.md): skirm's relayer pays the gas of a player's first few
// transactions to skirm's contracts. The wallet signs a NEP-366 delegate action instead of a
// transaction, the web posts it here, and the relayer wraps it in a transaction of its own.
//
//   GET  /relay                       { enabled, freeTxs, used, remaining, linked } for the caller
//   POST /relay { signedDelegate }    base64 borsh SignedDelegate → { txHash, remaining }
//
// Off unless RELAYER_ACCOUNT_ID and RELAYER_PRIVATE_KEY are set (deps.relay absent): GET answers
// `enabled: false` and POST 404 `relay_disabled`, and every other route behaves as before. The web
// then signs and sends transactions itself, as it always did. The rules a delegate must pass are in
// ../relay.ts. The returned hash is the relayer's transaction; the web posts it to the usual
// confirm routes (/credits/deposits, /rentals, /market), which read relayed transactions too.
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { RepoError, type AccountRow } from '@skirm/db';
import {
  DelegateActionNotAllowed,
  DelegateDecodeError,
  RelayError,
  decodeSignedDelegate,
  delegateId,
  verifyDelegateSignature,
  type DecodedSignedDelegate,
} from '@skirm/server';
import { z } from 'zod';
import { CurrentAccount, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError } from '../errors';
import { MAX_DELEGATE_BASE64, checkDelegate, checkOnChain, type RelayDeps } from '../relay';
import { parse } from '../validation';

const relayBody = z.object({
  signedDelegate: z
    .string()
    .min(1)
    .max(MAX_DELEGATE_BASE64)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'must be base64'),
});

@Controller('relay')
export class RelayController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  /**
   * The caller's quota. Without a linked NEAR account nothing can be relayed (`linked: false`), and
   * what the skirm account already used still counts (a player who unlinks gets no fresh quota).
   */
  private async remaining(
    relay: RelayDeps,
    account: AccountRow,
  ): Promise<{ used: number; remaining: number; linked: boolean }> {
    const used = await this.deps.repos.relay.used(account.id, account.nearAccountId ?? null);
    return { used, remaining: Math.max(0, relay.freeTxs - used), linked: !!account.nearAccountId };
  }

  @Get()
  async status(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const relay = this.deps.relay;
    if (!relay) return { enabled: false, freeTxs: 0, used: 0, remaining: 0, linked: !!account.nearAccountId };
    return { enabled: true, freeTxs: relay.freeTxs, ...(await this.remaining(relay, account)) };
  }

  @Post()
  @HttpCode(200)
  async relay(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const relay = this.deps.relay;
    if (!relay) throw new ApiError(404, 'relay_disabled', 'gasless transactions are not set up on this server');
    const { signedDelegate } = parse(relayBody, body);
    if (!account.nearAccountId)
      throw new ApiError(409, 'near_not_linked', 'link a NEAR account first');

    const bytes = new Uint8Array(Buffer.from(signedDelegate, 'base64'));
    let d: DecodedSignedDelegate;
    try {
      d = decodeSignedDelegate(bytes);
    } catch (err) {
      if (err instanceof DelegateActionNotAllowed)
        throw new ApiError(422, 'action_not_allowed', 'only function calls are paid for');
      if (err instanceof DelegateDecodeError) throw new ApiError(400, 'invalid_delegate', err.message);
      throw err;
    }
    checkDelegate(d, { linkedNearAccount: account.nearAccountId, contracts: relay.contracts, verifySignature: verifyDelegateSignature });

    // Relays a dead process left pending stop holding their slots (and their delegate) back.
    await this.deps.repos.relay.expireStale().catch(() => undefined);

    // Cheap refusal before any RPC; reserve() below re-checks under the account lock.
    const before = await this.remaining(relay, account);
    if (before.remaining <= 0) throw quotaError(relay.freeTxs, before.used);

    try {
      await checkOnChain(d, relay.relayer);
    } catch (err) {
      if (err instanceof RelayError) throw new ApiError(503, 'rpc_unavailable', 'NEAR RPC is unavailable, try again');
      throw err;
    }

    let row;
    try {
      row = await this.deps.repos.relay.reserve({
        accountId: account.id,
        nearAccountId: account.nearAccountId,
        receiverId: d.receiverId,
        methods: d.actions.map((a) => a.methodName),
        delegateHash: delegateId(bytes),
        quota: relay.freeTxs,
      });
    } catch (err) {
      if (err instanceof RepoError && err.code === 'relay_quota') throw quotaError(relay.freeTxs, relay.freeTxs);
      if (err instanceof RepoError && err.code === 'relay_duplicate')
        throw new ApiError(409, 'relay_duplicate', 'this transaction was already relayed');
      throw err;
    }

    try {
      const { txHash } = await relay.relayer.relay(d);
      await this.deps.repos.relay.markSent(row.id, txHash);
      const after = await this.remaining(relay, account);
      return { txHash, remaining: after.remaining };
    } catch (err) {
      if (err instanceof RelayError && err.txHash) {
        // It reached the chain and cost the relayer gas: the slot stays used.
        await this.deps.repos.relay.markSent(row.id, err.txHash);
        throw new ApiError(422, 'relay_tx_failed', 'the transaction failed on NEAR', { txHash: err.txHash });
      }
      await this.deps.repos.relay.markFailed(row.id);
      if (err instanceof RelayError) throw new ApiError(502, 'relay_failed', 'the relayer could not send the transaction, try again');
      throw err;
    }
  }
}

function quotaError(freeTxs: number, used: number): ApiError {
  return new ApiError(403, 'relay_quota', `the ${freeTxs} gas-free transactions are used up`, { freeTxs, used });
}
