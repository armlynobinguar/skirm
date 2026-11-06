// NEP-245 cosmetic items (contract `cosmetics`, contracts/cosmetics; not deployed yet). Only built
// when NEAR_CONTRACT_COSMETICS is set and the ops signer is configured; without it cosmetics stay
// credits-only and nothing here runs. Token id = the @skirm/shared EQUIP_COSMETICS item id.
import { cosmeticExtra, type EquipCosmetic } from '@skirm/shared';
import type { NearRpc } from './rpc';
import type { FunctionCaller } from './signer';

export interface CosmeticMintInput {
  /** Platform account id: with the item it is the contract's `mint_id`, so a resend mints nothing. */
  accountId: string;
  itemId: string;
  /** NEAR account that receives the copy. */
  receiverId: string;
}

export interface CosmeticMintResult {
  txHash: string;
  /** False when the contract had already minted this `mint_id` (a resend). */
  minted: boolean;
}

export interface CosmeticsChain {
  readonly contractId: string;
  /** `mt_mint` one copy (ops key). Throws on failure. */
  mint(input: CosmeticMintInput): Promise<CosmeticMintResult>;
  /** Copies `nearAccount` holds of each item (`mt_batch_balance_of`). */
  balances(nearAccount: string, itemIds: readonly string[]): Promise<Record<string, number>>;
}

/** The contract's idempotency key for one platform purchase. */
export function cosmeticMintId(accountId: string, itemId: string): string {
  return `${accountId}:${itemId}`;
}

/** The `mt_mint` args for one purchased copy. */
export function cosmeticMintArgs(i: CosmeticMintInput): Record<string, unknown> {
  return {
    receiver_id: i.receiverId,
    token_ids: [i.itemId],
    amounts: ['1'],
    memo: 'skirm purchase',
    mint_id: cosmeticMintId(i.accountId, i.itemId),
  };
}

/** The `mt_create` args that register an item type from the catalog (run once per item by the operator). */
export function cosmeticCreateArgs(item: Readonly<EquipCosmetic>): Record<string, unknown> {
  return {
    token_id: item.id,
    metadata: {
      title: item.name,
      description: item.blurb,
      extra: JSON.stringify(cosmeticExtra(item)),
    },
  };
}

export class NearCosmetics implements CosmeticsChain {
  constructor(
    private readonly caller: FunctionCaller,
    private readonly rpc: Pick<NearRpc, 'view'>,
    readonly contractId: string,
  ) {}

  async mint(input: CosmeticMintInput): Promise<CosmeticMintResult> {
    const { txHash, value } = await this.caller.call(
      this.contractId,
      'mt_mint',
      cosmeticMintArgs(input),
    );
    return { txHash, minted: value !== false };
  }

  async balances(nearAccount: string, itemIds: readonly string[]): Promise<Record<string, number>> {
    if (!itemIds.length) return {};
    const res =
      (await this.rpc.view<string[]>(this.contractId, 'mt_batch_balance_of', {
        account_id: nearAccount,
        token_ids: itemIds,
      })) ?? [];
    const out: Record<string, number> = {};
    itemIds.forEach((id, i) => {
      const n = Number(res[i] ?? 0);
      out[id] = Number.isFinite(n) ? n : 0;
    });
    return out;
  }
}
