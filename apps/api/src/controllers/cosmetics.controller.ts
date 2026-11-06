// /cosmetics*: premium palette entries (@skirm/shared COSMETICS) and equippable skins, trails and
// nameplates (EQUIP_COSMETICS), all bought with paid credits only. Purely visual; PATCH
// /agents/:id refuses a premium look the owner has not bought, and PUT /agents/:id/cosmetics/:slot
// an equippable item they do not own.
//
// NEP-245 (contracts/cosmetics) is off by default. With NEAR_CONTRACT_COSMETICS set (and the ops
// signer), deps.near.cosmetics exists: a bought equippable item is minted to the buyer's linked
// NEAR account, and ownership of minted items is read from the chain (a copy moved away onchain
// can no longer be equipped; one received onchain can). Without it everything stays credits-only.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import type { AccountRow, OwnedCosmetic } from '@skirm/db';
import {
  COSMETICS,
  COSMETIC_SLOTS,
  EQUIP_COSMETICS,
  cosmeticColor,
  equipCosmeticById,
  type CosmeticSlot,
} from '@skirm/shared';
import { z } from 'zod';
import { CurrentAccount, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError, notFound } from '../errors';
import { agentId, parse } from '../validation';
import { idOr404 } from './util';

const ITEMS = COSMETICS.map((c) => ({ ...c, color: cosmeticColor(c) }));
const EQUIP_IDS = EQUIP_COSMETICS.map((c) => c.id);

const equipBody = z.object({ itemId: z.string().min(1).max(64).nullable() }).strict();

/** A mint as the api shows it (null: credits only, never minted). */
function mintView(r: OwnedCosmetic) {
  return r.mintStatus
    ? { status: r.mintStatus, txHash: r.mintTx, owner: r.mintedTo }
    : null;
}

@Controller()
export class CosmeticsController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  @Get('cosmetics')
  async list(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { rows, owned } = await this.ownership(account);
    const agents = await this.deps.repos.agents.listByOwner(account.id);
    const chain = this.deps.near.cosmetics;
    return {
      items: ITEMS,
      equip: EQUIP_COSMETICS,
      owned,
      /** What each of the caller's agents wears, by agent id. */
      equipped: await this.deps.repos.cosmetics.equippedMany(agents.map((a) => a.id)),
      /** NEP-245 mint state per owned equippable item. */
      mints: Object.fromEntries(
        rows.filter((r) => r.mintStatus).map((r) => [r.itemId, mintView(r)]),
      ),
      onchain: chain ? { standard: 'nep245', contractId: chain.contractId } : null,
    };
  }

  /**
   * Buying an item the player already owns is a no-op `200` (nothing is charged twice). With the
   * cosmetics contract on and a linked NEAR account, a newly bought equippable item is minted
   * right away (`mint` in the answer; a failed mint keeps the purchase and can be retried).
   */
  @Post('cosmetics/:id/buy')
  @HttpCode(200)
  async buy(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const res = await this.deps.repos.cosmetics.buy(account.id, id);
    if (res.ok) {
      const chain = this.deps.near.cosmetics;
      const mint = chain && res.charged > 0 && equipCosmeticById(id) && account.nearAccountId ? await this.mint(account, id) : undefined;
      // What the player can wear now, as GET /cosmetics and the equip check see it: a minted token
      // held by another NEAR account does not count, so the shop never shows it owned when equip
      // would refuse it.
      const { owned } = await this.ownership(account);
      return mint !== undefined ? { owned, mint } : { owned };
    }
    if (res.error === 'not_found') throw notFound('cosmetic');
    if (res.error === 'insufficient_credits')
      throw new ApiError(
        402,
        'insufficient_credits',
        'cosmetics are bought with paid credits; top up first',
        undefined,
        { need: res.need, have: res.have },
      );
    throw new ApiError(422, res.error, res.message);
  }

  /**
   * Mints an owned equippable item as a NEP-245 token to the caller's linked NEAR account (once;
   * a failed mint can be retried). 503 `cosmetics_offchain` while the contract is off.
   */
  @Post('cosmetics/:id/mint')
  @HttpCode(200)
  async mintItem(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    if (!this.deps.near.cosmetics)
      throw new ApiError(503, 'cosmetics_offchain', 'cosmetics are credits-only here');
    if (!equipCosmeticById(id)) throw notFound('cosmetic');
    if (!account.nearAccountId)
      throw new ApiError(422, 'near_account_required', 'link a NEAR account to mint a cosmetic');
    const row = (await this.deps.repos.cosmetics.ownedRows(account.id)).find((r) => r.itemId === id);
    if (!row) throw new ApiError(409, 'not_owned', 'buy the item first');
    if (row.mintStatus === 'minted') return { mint: mintView(row) };
    const mint = await this.mint(account, id);
    if (mint?.status === 'failed')
      throw new ApiError(502, 'mint_failed', 'minting the cosmetic on NEAR failed, try again');
    return { mint };
  }

  /** What an agent wears: `{ cosmetics: { skin?, trail?, nameplate? } }` (item ids). */
  @Get('agents/:id/cosmetics')
  async equipped(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    mustAccount(acc);
    const agent = idOr404(agentId, id, 'agent');
    if (!(await this.deps.repos.agents.get(agent))) throw notFound('agent');
    return { cosmetics: await this.deps.repos.cosmetics.equipped(agent) };
  }

  /**
   * Puts an owned item on one of the caller's agents (`{ itemId }`), or takes the slot off
   * (`{ itemId: null }`). Visual only: allowed any time, also mid-match (it shows from the next
   * match). 403 `not_agent_owner`, 403 `cosmetic_not_owned`, 422 `wrong_slot`, 404 unknown item.
   */
  @Put('agents/:id/cosmetics/:slot')
  async equip(
    @Param('id') id: string,
    @Param('slot') slot: string,
    @Body() body: unknown,
    @CurrentAccount() acc?: AccountRow,
  ) {
    const account = mustAccount(acc);
    const agent = idOr404(agentId, id, 'agent');
    if (!(COSMETIC_SLOTS as readonly string[]).includes(slot))
      throw new ApiError(404, 'not_found', `no cosmetic slot ${slot}`);
    const { itemId } = parse(equipBody, body);
    const owned = itemId && this.deps.near.cosmetics ? (await this.ownership(account)).owned : undefined;
    const res = await this.deps.repos.cosmetics.equip(
      account.id,
      agent,
      slot as CosmeticSlot,
      itemId,
      owned,
    );
    if (res.ok) return { cosmetics: res.cosmetics };
    if (res.error === 'agent_not_found') throw notFound('agent');
    if (res.error === 'not_found') throw notFound('cosmetic');
    if (res.error === 'not_agent_owner') throw new ApiError(403, 'not_agent_owner', res.message);
    if (res.error === 'not_owned') throw new ApiError(403, 'cosmetic_not_owned', res.message);
    throw new ApiError(422, res.error, res.message);
  }

  /**
   * The account's cosmetics rows and the item ids it owns now. Credits-only: the rows. With the
   * contract on and a linked NEAR account: rows never minted, plus every equippable item the
   * account holds onchain (so minted copies follow the token). RPC down: the rows.
   */
  private async ownership(account: AccountRow): Promise<{ rows: OwnedCosmetic[]; owned: string[] }> {
    const rows = await this.deps.repos.cosmetics.ownedRows(account.id);
    const ids = rows.map((r) => r.itemId);
    const chain = this.deps.near.cosmetics;
    if (!chain || !account.nearAccountId) return { rows, owned: ids };
    const balances = await chain.balances(account.nearAccountId, EQUIP_IDS).catch(() => null);
    if (!balances) return { rows, owned: ids };
    const offchain = rows
      .filter((r) => !(r.mintStatus === 'minted' && equipCosmeticById(r.itemId)))
      .map((r) => r.itemId);
    const onchain = EQUIP_IDS.filter((id) => (balances[id] ?? 0) > 0);
    return { rows, owned: [...new Set([...offchain, ...onchain])].sort() };
  }

  /** Mints one copy (claims the row first, so two clicks never mint twice). */
  private async mint(account: AccountRow, itemId: string) {
    const chain = this.deps.near.cosmetics!;
    const near = account.nearAccountId!;
    const { cosmetics } = this.deps.repos;
    if (!(await cosmetics.startMint(account.id, itemId, near)))
      throw new ApiError(409, 'mint_in_progress', 'this cosmetic is being minted, try again shortly');
    try {
      const res = await chain.mint({ accountId: account.id, itemId, receiverId: near });
      const done = await cosmetics.finishMint(account.id, itemId, 'minted', res.txHash);
      return done ? mintView(done) : null;
    } catch {
      const done = await cosmetics.finishMint(account.id, itemId, 'failed');
      return done ? mintView(done) : null;
    }
  }
}
