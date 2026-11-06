// Agent accounts (docs/agent-accounts.md): an agent's own NEAR account that pays for things by
// itself, starting with agent rentals (`market.rent`). CUSTODIAL: `rent` is payable and a
// function-call key cannot attach a deposit, so the account needs a full-access key; the api
// creates the account under AGENT_ACCOUNTS_PARENT and keeps that key sealed with the vault's KEK.
// The key is opened only to sign, and never logged or returned. The owner funds the account with a
// plain wallet transfer and can withdraw what is left to their linked NEAR account.
//
//   GET  /agents/:id/account                     { enabled, account | null }
//   POST /agents/:id/account                     creates the account (owner, linked NEAR account)
//   PUT  /agents/:id/account/cap  { capYocto }   the per-match spend cap (0 = no spending)
//   POST /agents/:id/account/withdraw { amountYocto? }  sends the rest (or that much) to the owner
//
// Paying: POST /rentals/:offerId { agentAccount: <one of the caller's agents> } (rentals.controller)
// runs payRentFromAgentAccount below: the cap is checked and the payment reserved in one database
// transaction (AgentAccountsRepo.reserveRent), then the agent account signs `market.rent`.
// Off (AGENT_ACCOUNTS_PARENT unset): GET answers { enabled: false }, everything else 503.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { RepoError, sealedKeyOf, type AccountRow, type AgentAccountRow, type RentalRow } from '@skirm/db';
import {
  AgentAccountError,
  agentAccountIdFor,
  newAgentKeyPair,
  spendableOf,
  type AgentAccountsChain,
  type AgentSigner,
} from '@skirm/server';
import { z } from 'zod';
import { CurrentAccount, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError, notFound } from '../errors';
import { agentId, parse } from '../validation';
import { idOr404 } from './util';

const yoctoAmount = z.string().regex(/^[0-9]{1,40}$/);
const capBody = z.object({ capYocto: yoctoAmount }).strict();
const withdrawBody = z.object({ amountYocto: z.string().regex(/^[1-9][0-9]{0,39}$/).optional() }).strict();

/** The vault label binding a sealed key to the account it controls. */
export const agentKeyLabel = (nearAccountId: string) => `agent-key:${nearAccountId}`;

const DEFAULT_MARKET = 'market.playskirm.testnet';

export const disabled = () =>
  new ApiError(503, 'agent_accounts_disabled', 'agent accounts are not enabled on this server');

function chainOf(deps: ApiDeps): AgentAccountsChain {
  const chain = deps.near.agentAccounts;
  if (!chain) throw disabled();
  return chain;
}

/**
 * Opens the sealed key just long enough to sign. A key that does not open fails the reserved
 * payment (nothing was sent) and answers 503, never with the vault's details.
 */
async function signerOf(deps: ApiDeps, row: AgentAccountRow, spendId: string): Promise<AgentSigner> {
  try {
    const secretKey = await deps.vault.decryptSecret(agentKeyLabel(row.nearAccountId), sealedKeyOf(row));
    return { accountId: row.nearAccountId, secretKey };
  } catch {
    await deps.repos.agentAccounts.settle(spendId, { status: 'failed' });
    throw new ApiError(503, 'key_unavailable', "the agent account's key could not be opened");
  }
}

/** How a failed signer call settles the payment and answers the client. */
async function settleFailure(deps: ApiDeps, spendId: string, err: unknown): Promise<never> {
  // The chain answered with a failure (or never got the transaction): nothing was paid.
  if (err instanceof AgentAccountError && (err.code === 'failed' || err.code === 'not_found' || err.code === 'exists')) {
    await deps.repos.agentAccounts.settle(spendId, { status: 'failed', txHash: err.txHash ?? null });
    throw new ApiError(422, 'payment_failed', 'the agent account could not make this payment');
  }
  // No answer: it may have gone through. It keeps counting against the cap until it is settled.
  await deps.repos.agentAccounts.settle(spendId, { status: 'unknown' });
  throw new ApiError(503, 'payment_unknown', 'NEAR did not answer; the payment is held until it is checked');
}

/**
 * Pays a rental offer from one of the renter's own agents' accounts (server-signed `market.rent`),
 * under that account's per-match cap, and records the pass like a wallet rental.
 */
export async function payRentFromAgentAccount(
  deps: ApiDeps,
  account: AccountRow,
  offerId: string,
  payerAgentId: string,
): Promise<{ pass: RentalRow; txHash: string; paidFrom: string }> {
  const chain = chainOf(deps);
  // The deployed market needs `rent` (the same switch as wallet rentals, contracts/market/README.md).
  if (!deps.config.NEAR_RENTALS_ONCHAIN)
    throw new ApiError(409, 'rentals_offchain', 'rentals are paid in credits until the market takes NEAR rentals');
  const { repos } = deps;
  const offer = await repos.rentals.getOffer(offerId);
  if (!offer) throw notFound('rental offer');
  if (offer.ownerId === account.id) throw new ApiError(409, 'own_agent', 'you own this agent');
  if (!offer.active) throw new ApiError(409, 'not_offered', 'this agent is no longer offered for rent');
  const payer = await repos.agentAccounts.get(payerAgentId);
  if (!payer || payer.ownerId !== account.id) throw notFound('agent account');
  const owner = await repos.accounts.get(offer.ownerId);
  if (!owner?.nearAccountId) throw new ApiError(422, 'owner_not_linked', "the agent's owner has no NEAR account to be paid");

  const price = BigInt(offer.priceYocto);
  const balance = await readBalance(chain, payer.nearAccountId);
  if (!balance) throw new ApiError(409, 'account_missing', 'the agent account does not exist on NEAR');

  let spend;
  try {
    spend = await repos.agentAccounts.reserveRent({
      agentId: payer.agentId,
      ownerId: account.id,
      offerId: offer.id,
      amountYocto: price,
      spendableYocto: spendableOf(balance),
    });
  } catch (err) {
    if (err instanceof RepoError) {
      if (err.code === 'over_cap') throw new ApiError(409, 'over_cap', err.message, err.details);
      if (err.code === 'insufficient_balance') throw new ApiError(402, 'insufficient_balance', err.message, err.details);
      if (err.code === 'busy') throw new ApiError(409, 'busy', err.message);
      if (err.code === 'not_found') throw notFound('agent account');
    }
    throw err;
  }

  const signer = await signerOf(deps, payer, spend.id);
  let paid;
  try {
    paid = await chain.rent(signer, {
      marketContract: deps.config.NEAR_CONTRACT_MARKET ?? DEFAULT_MARKET,
      rentalId: `${offer.id}:${spend.id}`,
      ownerId: owner.nearAccountId,
      priceYocto: price,
    });
  } catch (err) {
    return settleFailure(deps, spend.id, err);
  }
  const pass = await repos.transaction(async (r) => {
    const row = await r.rentals.record({
      offerId: offer.id,
      renterId: account.id,
      priceYocto: price.toString(),
      feeYocto: paid.feeYocto.toString(),
      ownerProceedsYocto: paid.ownerProceedsYocto.toString(),
      txHash: paid.txHash,
    });
    await r.agentAccounts.settle(spend.id, { status: 'sent', txHash: paid.txHash, rentalId: row.id });
    return row;
  });
  return { pass, txHash: paid.txHash, paidFrom: payer.nearAccountId };
}

async function readBalance(chain: AgentAccountsChain, nearAccountId: string) {
  try {
    return await chain.balance(nearAccountId);
  } catch {
    throw new ApiError(503, 'rpc_unavailable', 'NEAR RPC is unavailable, try again');
  }
}

@Controller('agents/:id/account')
export class AgentAccountsController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  /** The caller's own agent, or 404 (another player's agent looks the same as a missing one). */
  private async ownAgent(id: string, account: AccountRow): Promise<string> {
    const aid = idOr404(agentId, id, 'agent');
    const agent = await this.deps.repos.agents.get(aid);
    if (!agent || agent.ownerId !== account.id) throw notFound('agent');
    return aid;
  }

  private async ownRow(aid: string, account: AccountRow): Promise<AgentAccountRow> {
    const row = await this.deps.repos.agentAccounts.get(aid);
    if (!row || row.ownerId !== account.id) throw notFound('agent account');
    return row;
  }

  /** What the owner sees. Explicit fields only: the sealed key never leaves the repo row. */
  private async view(row: AgentAccountRow) {
    const chain = chainOf(this.deps);
    let balance = null;
    try {
      balance = await chain.balance(row.nearAccountId);
    } catch {
      balance = null;
    }
    return {
      agentId: row.agentId,
      nearAccountId: row.nearAccountId,
      /** null when NEAR RPC did not answer. */
      balanceYocto: balance ? balance.totalYocto.toString() : null,
      spendableYocto: balance ? spendableOf(balance).toString() : null,
      capYocto: String(row.capYocto),
      committedYocto: (await this.deps.repos.agentAccounts.committed(row.agentId)).toString(),
      custodial: true as const,
    };
  }

  @Get()
  async get(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const aid = await this.ownAgent(id, account);
    if (!this.deps.near.agentAccounts) return { enabled: false, account: null };
    const row = await this.deps.repos.agentAccounts.get(aid);
    return { enabled: true, account: row ? await this.view(row) : null };
  }

  @Post()
  @HttpCode(201)
  async create(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const aid = await this.ownAgent(id, account);
    const chain = chainOf(this.deps);
    if (!account.nearAccountId)
      throw new ApiError(422, 'near_account_required', 'link a NEAR account to fund and withdraw from an agent account');
    const { repos, vault } = this.deps;
    if (await repos.agentAccounts.get(aid)) throw new ApiError(409, 'exists', 'this agent already has an account');
    const nearAccountId = agentAccountIdFor(aid, chain.parent);
    // Seal and store first, create onchain second: an account is never created with a key the
    // database does not hold. A failed creation removes the row again.
    const keys = newAgentKeyPair();
    const sealed = await vault.encryptSecret(agentKeyLabel(nearAccountId), keys.secretKey);
    keys.secretKey = '';
    let row;
    try {
      row = await repos.agentAccounts.create({ agentId: aid, ownerId: account.id, nearAccountId, publicKey: keys.publicKey, key: sealed });
    } catch (err) {
      if (err instanceof RepoError && err.code === 'exists') throw new ApiError(409, 'exists', 'this agent already has an account');
      throw err;
    }
    try {
      await chain.create(nearAccountId, keys.publicKey);
    } catch (err) {
      await repos.agentAccounts.remove(aid);
      if (err instanceof AgentAccountError && err.code === 'exists')
        throw new ApiError(409, 'account_taken', 'that NEAR account already exists');
      throw new ApiError(503, 'create_failed', 'the agent account could not be created, try again');
    }
    return { account: await this.view(row) };
  }

  @Put('cap')
  async setCap(@Param('id') id: string, @Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const aid = await this.ownAgent(id, account);
    chainOf(this.deps);
    const { capYocto } = parse(capBody, body);
    await this.ownRow(aid, account);
    const row = await this.deps.repos.agentAccounts.setCap(account.id, aid, BigInt(capYocto));
    return { account: await this.view(row) };
  }

  @Post('withdraw')
  @HttpCode(200)
  async withdraw(@Param('id') id: string, @Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const aid = await this.ownAgent(id, account);
    const chain = chainOf(this.deps);
    const { amountYocto } = parse(withdrawBody, body ?? {});
    const row = await this.ownRow(aid, account);
    // Only ever to the owner's own linked account.
    const to = account.nearAccountId;
    if (!to) throw new ApiError(422, 'near_account_required', 'link a NEAR account to withdraw to');
    const balance = await readBalance(chain, row.nearAccountId);
    if (!balance) throw new ApiError(409, 'account_missing', 'the agent account does not exist on NEAR');
    const spendable = spendableOf(balance);
    const amount = amountYocto ? BigInt(amountYocto) : spendable;
    if (amount <= 0n) throw new ApiError(422, 'nothing_to_withdraw', 'the agent account has nothing to withdraw');
    if (amount > spendable)
      throw new ApiError(402, 'insufficient_balance', 'the agent account cannot cover this', { spendableYocto: spendable.toString() });
    let spend;
    try {
      spend = await this.deps.repos.agentAccounts.reserveWithdraw({ agentId: aid, ownerId: account.id, amountYocto: amount });
    } catch (err) {
      if (err instanceof RepoError && err.code === 'busy') throw new ApiError(409, 'busy', err.message);
      throw err;
    }
    const signer = await signerOf(this.deps, row, spend.id);
    let sent;
    try {
      sent = await chain.transfer(signer, to, amount);
    } catch (err) {
      return settleFailure(this.deps, spend.id, err);
    }
    await this.deps.repos.agentAccounts.settle(spend.id, { status: 'sent', txHash: sent.txHash });
    return { txHash: sent.txHash, amountYocto: amount.toString(), to, account: await this.view(row) };
  }
}
