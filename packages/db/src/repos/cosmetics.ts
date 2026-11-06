// Premium cosmetics an account owns (@skirm/shared COSMETICS and EQUIP_COSMETICS). A purchase
// spends paid credits only (LedgerRepo.spend) and records ownership in the same transaction.
// Equippable items (skins, trails, nameplates) are worn per agent and slot (agent_cosmetics); with
// NEAR_CONTRACT_COSMETICS set the api also mints them as NEP-245 tokens and tracks the mint here.
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  cleanCosmetics,
  equipCosmeticById,
  shopItemById,
  type AgentCosmetics,
  type CosmeticSlot,
} from '@skirm/shared';
import type { Executor } from '../client';
import { agentCosmetics, agents, cosmeticsOwned } from '../schema';
import { RepoError } from '../types';
import { LedgerRepo, type LedgerRepoOptions } from './ledger';
import { isUniqueViolation, tx } from './util';

export type CosmeticBuyResult =
  | {
      ok: true;
      /** Item ids the account owns after the purchase. */
      owned: string[];
      /** Credits spent (0 when it was already owned). */
      charged: number;
    }
  | {
      ok: false;
      error: 'not_found' | 'insufficient_credits' | 'unknown_account' | 'invalid_amount';
      message: string;
      need?: number;
      have?: number;
    };

export type CosmeticMintStatus = 'pending' | 'minted' | 'failed';

/** One owned item with its NEP-245 mint state (`mintStatus` null: credits only, never minted). */
export interface OwnedCosmetic {
  itemId: string;
  source: string;
  mintStatus: CosmeticMintStatus | null;
  mintTx: string | null;
  mintedTo: string | null;
}

export type CosmeticEquipResult =
  | { ok: true; cosmetics: AgentCosmetics }
  | {
      ok: false;
      error: 'agent_not_found' | 'not_agent_owner' | 'not_found' | 'wrong_slot' | 'not_owned';
      message: string;
    };

export class CosmeticsRepo {
  constructor(
    private readonly db: Executor,
    private readonly ledgerOpts: LedgerRepoOptions = {},
  ) {}

  /** Item ids the account owns, sorted. */
  async owned(accountId: string): Promise<string[]> {
    const rows = await this.db
      .select({ itemId: cosmeticsOwned.itemId })
      .from(cosmeticsOwned)
      .where(eq(cosmeticsOwned.accountId, accountId))
      .orderBy(cosmeticsOwned.itemId);
    return rows.map((r) => r.itemId);
  }

  /** The account's items with their mint state, sorted by item id. */
  async ownedRows(accountId: string): Promise<OwnedCosmetic[]> {
    const rows = await this.db
      .select({
        itemId: cosmeticsOwned.itemId,
        source: cosmeticsOwned.source,
        mintStatus: cosmeticsOwned.mintStatus,
        mintTx: cosmeticsOwned.mintTx,
        mintedTo: cosmeticsOwned.mintedTo,
      })
      .from(cosmeticsOwned)
      .where(eq(cosmeticsOwned.accountId, accountId))
      .orderBy(cosmeticsOwned.itemId);
    return rows.map((r) => ({ ...r, mintStatus: r.mintStatus as CosmeticMintStatus | null }));
  }

  /**
   * Buys an item with paid credits. Already owned: ok, nothing charged. A concurrent buy of the same
   * item loses on the primary key, which rolls its spend back with it.
   */
  async buy(accountId: string, itemId: string): Promise<CosmeticBuyResult> {
    const item = shopItemById(itemId);
    if (!item) return { ok: false, error: 'not_found', message: `no cosmetic ${itemId}` };
    try {
      const charged = await tx(this.db, async (t) => {
        if (await this.has(t, accountId, itemId)) return 0;
        const spent = await new LedgerRepo(t, this.ledgerOpts).spend({
          accountId,
          amount: item.priceCredits,
          ref: `cosmetic:${itemId}`,
          kind: 'cosmetic',
        });
        if (!spent.ok) return spent;
        await t.insert(cosmeticsOwned).values({ accountId, itemId, source: 'purchase' });
        return item.priceCredits;
      });
      if (typeof charged !== 'number') {
        const { error, message, need, have } = charged;
        if (
          error !== 'insufficient_credits' &&
          error !== 'unknown_account' &&
          error !== 'invalid_amount'
        )
          throw new RepoError(error, message);
        return { ok: false, error, message, ...(need !== undefined ? { need, have } : {}) };
      }
      return { ok: true, owned: await this.owned(accountId), charged };
    } catch (err) {
      if (isUniqueViolation(err))
        return { ok: true, owned: await this.owned(accountId), charged: 0 };
      throw err;
    }
  }

  /** Gives an item without charging (promotions, support). Idempotent. */
  async grant(accountId: string, itemId: string, source = 'grant'): Promise<void> {
    if (!shopItemById(itemId)) throw new RepoError('not_found', `no cosmetic ${itemId}`);
    await this.db
      .insert(cosmeticsOwned)
      .values({ accountId, itemId, source })
      .onConflictDoNothing();
  }

  // ---------- equipping (skins, trails, nameplates) ----------

  /** What one agent wears (unknown or mismatched stored ids are dropped). */
  async equipped(agentId: string): Promise<AgentCosmetics> {
    return (await this.equippedMany([agentId]))[agentId] ?? {};
  }

  /** What each agent wears, by agent id; agents wearing nothing are absent. */
  async equippedMany(agentIds: readonly string[]): Promise<Record<string, AgentCosmetics>> {
    if (!agentIds.length) return {};
    const rows = await this.db
      .select()
      .from(agentCosmetics)
      .where(inArray(agentCosmetics.agentId, [...agentIds]));
    const raw: Record<string, Record<string, string>> = {};
    for (const r of rows) (raw[r.agentId] ??= {})[r.slot] = r.itemId;
    const out: Record<string, AgentCosmetics> = {};
    for (const [id, slots] of Object.entries(raw)) {
      const clean = cleanCosmetics(slots);
      if (Object.keys(clean).length) out[id] = clean;
    }
    return out;
  }

  /**
   * Puts an item on (or, with `itemId` null, takes the slot off) one of the account's own agents.
   * The item must be for that slot and owned: by default the account's cosmetics_owned rows; the
   * api passes `owned` when ownership is read from the cosmetics contract.
   */
  async equip(
    accountId: string,
    agentId: string,
    slot: CosmeticSlot,
    itemId: string | null,
    owned?: readonly string[],
  ): Promise<CosmeticEquipResult> {
    const [agent] = await this.db
      .select({ ownerId: agents.ownerId })
      .from(agents)
      .where(eq(agents.id, agentId));
    if (!agent) return { ok: false, error: 'agent_not_found', message: 'agent not found' };
    if (agent.ownerId !== accountId)
      return { ok: false, error: 'not_agent_owner', message: 'only the agent owner can dress it' };
    if (itemId === null) {
      await this.db
        .delete(agentCosmetics)
        .where(and(eq(agentCosmetics.agentId, agentId), eq(agentCosmetics.slot, slot)));
      return { ok: true, cosmetics: await this.equipped(agentId) };
    }
    const item = equipCosmeticById(itemId);
    if (!item) return { ok: false, error: 'not_found', message: `no cosmetic ${itemId}` };
    if (item.kind !== slot)
      return { ok: false, error: 'wrong_slot', message: `${itemId} is a ${item.kind}, not a ${slot}` };
    const has = owned ? owned.includes(itemId) : await this.has(this.db, accountId, itemId);
    if (!has) return { ok: false, error: 'not_owned', message: 'buy the item before equipping it' };
    await this.db
      .insert(agentCosmetics)
      .values({ agentId, slot, itemId })
      .onConflictDoUpdate({
        target: [agentCosmetics.agentId, agentCosmetics.slot],
        set: { itemId, updatedAt: new Date() },
      });
    return { ok: true, cosmetics: await this.equipped(agentId) };
  }

  // ---------- NEP-245 mints (NEAR_CONTRACT_COSMETICS) ----------

  /**
   * Claims an owned item's mint: true when it was never minted (or the last try failed) and is now
   * `pending` for `nearAccount`; false when it is not owned, already minted or in flight.
   */
  async startMint(accountId: string, itemId: string, nearAccount: string): Promise<boolean> {
    const rows = await this.db
      .update(cosmeticsOwned)
      .set({ mintStatus: 'pending', mintedTo: nearAccount, mintTx: null })
      .where(
        and(
          eq(cosmeticsOwned.accountId, accountId),
          eq(cosmeticsOwned.itemId, itemId),
          or(isNull(cosmeticsOwned.mintStatus), eq(cosmeticsOwned.mintStatus, 'failed')),
        ),
      )
      .returning({ itemId: cosmeticsOwned.itemId });
    return rows.length > 0;
  }

  /** Records how a mint ended. */
  async finishMint(
    accountId: string,
    itemId: string,
    status: 'minted' | 'failed',
    txHash: string | null = null,
  ): Promise<OwnedCosmetic | undefined> {
    await this.db
      .update(cosmeticsOwned)
      .set({ mintStatus: status, mintTx: txHash })
      .where(and(eq(cosmeticsOwned.accountId, accountId), eq(cosmeticsOwned.itemId, itemId)));
    return (await this.ownedRows(accountId)).find((r) => r.itemId === itemId);
  }

  private async has(t: Executor, accountId: string, itemId: string): Promise<boolean> {
    const [row] = await t
      .select({ itemId: cosmeticsOwned.itemId })
      .from(cosmeticsOwned)
      .where(and(eq(cosmeticsOwned.accountId, accountId), eq(cosmeticsOwned.itemId, itemId)));
    return !!row;
  }
}
