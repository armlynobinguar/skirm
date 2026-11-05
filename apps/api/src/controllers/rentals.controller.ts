// Agent rentals (the prototype's "Agent rentals" earn-back line; 5% platform fee, as on skill
// sales). An owner offers an agent at a price per match; a renter pays through `market.rent` and
// gets a one-match pass, used up when that match starts. The agent plays with its owner's skills;
// the renter never reads them (realtime withholds plans of skills the player did not write).
//
//   PUT  /agents/:id/rental   { priceYocto | null }  the owner sets or ends the offer
//   GET  /rentals                                   active offers of other players, cheapest first
//   GET  /rentals/mine                              the caller's offers and unused passes
//   POST /rentals/:offerId    { txHash }            records a verified payment as a pass
//                             { credits: true, key } pays in credits (NEAR_RENTALS_ONCHAIN off)
//
// A payment counts when its `rental` event names this offer (`rental_id` = `<offerId>:<nonce>`),
// pays the agent's owner's linked NEAR account, comes from the caller's linked account and is at
// least the offer price. Dev mode trusts `dev:<yocto>[:<nonce>]` hashes at or above the price.
// NEAR_RENTALS_ONCHAIN (off by default) picks how the web pays: on, `market.rent` from the wallet
// (the deployed market needs the `rent` redeploy, contracts/market/README.md); off, the renter's
// paid credits at CREDITS_PER_NEAR, the owner credited the price minus the 5% fee. A verified
// onchain payment is honoured either way, so flipping the flag never strands a signed rental.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { RentalError, rentalCredits, RENTAL_DEV_FEE_BPS, type RentalErrorCode } from '@skirm/server';
import { RepoError, type AccountRow, type RentalOfferRow, type RentalRow } from '@skirm/db';
import { z } from 'zod';
import { CurrentAccount, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError, notFound } from '../errors';
import { agentId, parse } from '../validation';
import { idOr404 } from './util';

const offerId = z.string().regex(/^rof_[0-9A-HJKMNP-TV-Z]{26}$/);
const offerBody = z.object({ priceYocto: z.string().regex(/^[1-9][0-9]{0,39}$/).nullable() });
const rentBody = z.union([
  z.object({ txHash: z.string().min(1).max(128) }).strict(),
  z.object({ credits: z.literal(true), key: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }).strict(),
]);

/** HTTP status for each verifier refusal. */
const RENTAL_STATUS: Record<RentalErrorCode, number> = {
  invalid_hash: 422,
  dev_disabled: 403,
  renter_required: 422,
  not_found: 404,
  failed: 422,
  wrong_receiver: 422,
  wrong_sender: 422,
  no_rental: 422,
  rpc_unavailable: 503,
};

const offerView = (o: RentalOfferRow) => ({ offerId: o.id, agentId: o.agentId, priceYocto: String(o.priceYocto), active: o.active });
const passView = (r: RentalRow) => ({
  rentalId: r.id,
  offerId: r.offerId,
  agentId: r.agentId,
  priceYocto: String(r.priceYocto),
  matchId: r.matchId,
  createdAt: r.createdAt.toISOString(),
});

@Controller()
export class RentalsController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  @Put('agents/:id/rental')
  async setOffer(@Param('id') id: string, @Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const agent = idOr404(agentId, id, 'agent');
    const { priceYocto } = parse(offerBody, body);
    if (priceYocto !== null && !account.nearAccountId)
      throw new ApiError(422, 'near_account_required', 'link a NEAR account to be paid for rentals');
    try {
      const offer = await this.deps.repos.rentals.setOffer(account.id, agent, priceYocto);
      return { offer: offer ? offerView(offer) : null };
    } catch (err) {
      if (err instanceof RepoError && err.code === 'not_found') throw notFound('agent');
      throw err;
    }
  }

  /** How renters pay right now: the market contract, or paid credits until it is redeployed. */
  private payWith(): 'near' | 'credits' {
    return this.deps.config.NEAR_RENTALS_ONCHAIN ? 'near' : 'credits';
  }

  @Get('rentals')
  async offers(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const payWith = this.payWith();
    const perNear = this.deps.config.CREDITS_PER_NEAR;
    return (await this.deps.repos.rentals.offers({ excludeOwner: account.id })).map((o) => ({
      ...o,
      payWith,
      priceCredits: rentalCredits(BigInt(o.priceYocto), perNear).priceCredits,
    }));
  }

  @Get('rentals/mine')
  async mine(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { rentals, agents } = this.deps.repos;
    const own = await agents.listByOwner(account.id);
    const offers = (await Promise.all(own.map((a) => rentals.offerFor(a.id)))).filter((o): o is RentalOfferRow => !!o);
    // Each pass with the rented agent's public stats and owner, for the crew picker.
    const passes = await Promise.all(
      (await rentals.unusedPasses(account.id)).map(async (r) => {
        const [v, owner] = await Promise.all([agents.view(r.agentId), this.deps.repos.accounts.get(r.ownerId)]);
        const agent = v ? { name: v.name, role: v.role, vision: v.vision, comms: v.comms, tier: v.tier, ownerHandle: owner?.handle ?? '' } : null;
        return { ...passView(r), agent };
      }),
    );
    return { offers: offers.map(offerView), passes };
  }

  @Post('rentals/:offerId')
  @HttpCode(200)
  async rent(@Param('offerId') id: string, @Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const oid = idOr404(offerId, id, 'rental offer');
    const parsed = parse(rentBody, body);
    if ('credits' in parsed) return this.rentWithCredits(account, oid, parsed.key);
    const { txHash } = parsed;
    const { repos, near, config } = this.deps;
    // A replayed payment is answered with the pass it already bought.
    const done = await repos.rentals.byTx(txHash);
    if (done) {
      if (done.renterId !== account.id || done.offerId !== oid) throw new ApiError(409, 'duplicate_tx', 'this transaction was already used');
      return { pass: passView(done) };
    }
    const offer = await repos.rentals.getOffer(oid);
    if (!offer) throw notFound('rental offer');
    if (offer.ownerId === account.id) throw new ApiError(409, 'own_agent', 'you own this agent');

    const dev = txHash.startsWith('dev:');
    if (dev && config.AUTH_MODE !== 'dev') throw new ApiError(403, 'dev_disabled', 'dev rentals are disabled');
    let payment;
    try {
      payment = await near.rentals.verify(txHash, { renterId: account.nearAccountId });
    } catch (err) {
      if (err instanceof RentalError) throw new ApiError(RENTAL_STATUS[err.code], err.code, err.message);
      throw err;
    }
    if (payment.priceYocto < BigInt(offer.priceYocto)) throw new ApiError(422, 'underpaid', 'the payment is below the rental price');
    if (!payment.dev) {
      // The payment must be for this offer, to this agent's owner. A retired offer still honours a
      // payment made for it (the price was agreed when it was signed).
      const owner = await repos.accounts.get(offer.ownerId);
      if (!payment.rentalId.startsWith(`${offer.id}:`)) throw new ApiError(422, 'wrong_rental', 'the payment is for another rental');
      if (!owner?.nearAccountId || payment.owner !== owner.nearAccountId)
        throw new ApiError(422, 'wrong_owner', "the payment did not go to the agent's owner");
    } else if (!offer.active) {
      throw new ApiError(409, 'not_offered', 'this agent is no longer offered for rent');
    }
    try {
      const pass = await repos.rentals.record({
        offerId: offer.id,
        renterId: account.id,
        priceYocto: payment.priceYocto.toString(),
        feeYocto: payment.feeYocto.toString(),
        ownerProceedsYocto: payment.ownerProceedsYocto.toString(),
        txHash: payment.receipt,
      });
      return { pass: passView(pass) };
    } catch (err) {
      if (err instanceof RepoError && (err.code === 'duplicate_tx' || err.code === 'own_agent')) throw new ApiError(409, err.code, err.message);
      throw err;
    }
  }

  /**
   * Pays the offer in paid credits: only while rentals are not onchain. The pass records the offer's
   * yocto price and split; the ledger moves the credits. `key` makes a retry return the same pass.
   */
  private async rentWithCredits(account: AccountRow, oid: string, key: string) {
    const { repos, config } = this.deps;
    const offer = await repos.rentals.getOffer(oid);
    if (!offer) throw notFound('rental offer');
    if (offer.ownerId === account.id) throw new ApiError(409, 'own_agent', 'you own this agent');
    if (this.payWith() === 'near')
      throw new ApiError(409, 'rentals_onchain', 'rentals are paid with NEAR through the market contract');
    const priceYocto = BigInt(offer.priceYocto);
    const feeYocto = (priceYocto * RENTAL_DEV_FEE_BPS) / 10_000n;
    const { priceCredits, ownerCredits } = rentalCredits(priceYocto, config.CREDITS_PER_NEAR);
    try {
      const { pass, charged } = await repos.rentals.payWithCredits({
        offerId: offer.id,
        renterId: account.id,
        key,
        priceCredits,
        ownerCredits,
        priceYocto: priceYocto.toString(),
        feeYocto: feeYocto.toString(),
        ownerProceedsYocto: (priceYocto - feeYocto).toString(),
      });
      // A retry of a paid key returns its pass (even if the offer has ended since), charging nothing.
      return { pass: passView(pass), credits: charged ? priceCredits : 0 };
    } catch (err) {
      if (err instanceof RepoError) {
        if (err.code === 'insufficient_credits')
          throw new ApiError(402, 'insufficient_credits', 'rentals are paid with paid credits; top up first', undefined, {
            need: err.details?.need,
            have: err.details?.have,
          });
        if (err.code === 'duplicate_tx' || err.code === 'own_agent' || err.code === 'not_offered') throw new ApiError(409, err.code, err.message);
        if (err.code === 'not_found') throw notFound('rental offer');
      }
      throw err;
    }
  }
}
