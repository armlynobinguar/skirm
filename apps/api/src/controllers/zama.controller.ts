// Zama (FHEVM on Sepolia) routes for the Exchange's sealed-bid skill auctions (SkillAuction.sol).
// The bids, the ranking and the payments live on chain as ciphertexts; these routes only link a
// player's EVM address to the account and map an on-chain auction to the skill version it sells, so
// the worker can grant the winner the version once the chain finalizes the sale.
//
//   GET  /zama/evm-link                          { address | null }  the caller's linked address
//   PUT  /zama/evm-link    { address, signature } links it (personal_sign of evmLinkMessage)
//   GET  /zama/auctions    ?skillId=             registered auctions (public; open first)
//   POST /zama/auctions    { skillId, version, auctionId }  registers the caller's on-chain auction
//
// Auction routes answer 404 `auctions_disabled` unless ZAMA_ENABLED is on and SkillAuction is
// deployed (deps.auctions). The EVM link works either way.
import { Body, Controller, Get, HttpCode, Inject, Post, Put, Query } from '@nestjs/common';
import type { AccountRow, SkillAuctionRow } from '@skirm/db';
import { AuctionCheckError, auctionSkillRef, checkRegisteredAuction, verifyEvmLink, type AuctionReader } from '@skirm/server';
import { z } from 'zod';
import { CurrentAccount, Public, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError, notFound } from '../errors';
import { parse, skillId } from '../validation';

const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const linkBody = z.object({ address: evmAddress, signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict();
const registerBody = z
  .object({
    skillId,
    version: z.number().int().min(1),
    auctionId: z.string().regex(/^[1-9][0-9]{0,30}$/),
  })
  .strict();
const listQuery = z.object({ skillId: skillId.optional() });

const disabled = () => new ApiError(404, 'auctions_disabled', 'sealed auctions are not enabled on this server');

@Controller('zama')
export class ZamaController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  private reader(): AuctionReader {
    if (!this.deps.auctions) throw disabled();
    return this.deps.auctions;
  }

  @Get('evm-link')
  async evmLink(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    return { address: account.evmAddress ?? null };
  }

  @Put('evm-link')
  async linkEvm(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const b = parse(linkBody, body);
    if (!verifyEvmLink(account.id, b.address, b.signature))
      throw new ApiError(422, 'invalid_signature', 'the signature does not prove this address');
    const res = await this.deps.repos.accounts.linkEvmAddress(account.id, b.address);
    if (!res.ok) throw new ApiError(409, 'evm_address_taken', 'this address is linked to another account');
    return { address: b.address.toLowerCase() };
  }

  @Get('auctions')
  @Public()
  async list(@Query() query: unknown) {
    const reader = this.reader();
    const q = parse(listQuery, query);
    const { repos } = this.deps;
    const rows = (q.skillId ? await repos.auctions.ofSkill(q.skillId) : await repos.auctions.listRecent()).filter(
      (r) => r.contractAddress === reader.address,
    );
    return { contract: reader.address, auctions: await this.views(rows) };
  }

  @Post('auctions')
  @HttpCode(201)
  async register(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const reader = this.reader();
    const b = parse(registerBody, body);
    const { repos } = this.deps;
    if (!account.evmAddress) throw new ApiError(422, 'evm_link_required', 'link an EVM address first');
    const v = await repos.skills.get(b.skillId, b.version);
    if (!v) throw notFound('skill');
    if (!(await repos.skills.owns(account.id, b.skillId, b.version)))
      throw new ApiError(403, 'forbidden', 'only the owner can auction this skill');
    if (v.accountBound || v.status === 'draft' || !v.tokenId)
      throw new ApiError(422, 'not_minted', 'only minted skill versions can be auctioned');
    if (await repos.market.activeListing(b.skillId, b.version))
      throw new ApiError(409, 'listed', 'cancel the fixed-price listing before auctioning this version');
    if (await repos.auctions.openFor(b.skillId, b.version))
      throw new ApiError(409, 'auction_open', 'this version is already on auction');
    let chain;
    try {
      chain = await checkRegisteredAuction(reader, {
        auctionId: BigInt(b.auctionId),
        sellerAddress: account.evmAddress,
        skillId: b.skillId,
        version: b.version,
        nowMs: Date.now(),
      });
    } catch (err) {
      if (err instanceof AuctionCheckError) throw new ApiError(422, err.code, err.message);
      throw new ApiError(503, 'chain_unavailable', 'Sepolia RPC is unavailable, try again');
    }
    const row = await repos.auctions.register({
      contractAddress: reader.address,
      chainAuctionId: b.auctionId,
      skillId: b.skillId,
      version: b.version,
      sellerId: account.id,
      skillRef: auctionSkillRef(b.skillId, b.version),
      endsAt: new Date(chain.endTime * 1000),
    });
    const [view] = await this.views([row]);
    return view;
  }

  /** Public auction cards: the skill's public name, the seller's handle, the outcome once known. */
  private async views(rows: SkillAuctionRow[]) {
    const { repos } = this.deps;
    const versions = await repos.skills.getMany(rows.map((r) => ({ id: r.skillId, version: r.version })));
    const nameOf = new Map(versions.map((v) => [`${v.id}:${v.version}`, v.name]));
    const handles = new Map<string, string>();
    for (const id of new Set(rows.flatMap((r) => [r.sellerId, ...(r.buyerId ? [r.buyerId] : [])]))) {
      const a = await repos.accounts.get(id);
      if (a) handles.set(id, a.handle);
    }
    return rows.map((r) => ({
      id: r.id,
      auctionId: r.chainAuctionId,
      skill: { id: r.skillId, version: r.version, name: nameOf.get(`${r.skillId}:${r.version}`) ?? null },
      seller: { id: r.sellerId, handle: handles.get(r.sellerId) ?? null },
      endsAt: r.endsAt.toISOString(),
      status: r.status,
      /** Clearing price in cSKIRM base units (null until the chain finalized a sale). */
      price: r.price,
      winnerAddress: r.winnerAddress,
      buyer: r.buyerId ? { id: r.buyerId, handle: handles.get(r.buyerId) ?? null } : null,
    }));
  }
}
