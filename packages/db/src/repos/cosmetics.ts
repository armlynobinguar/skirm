// Premium cosmetics an account owns (@skirm/shared COSMETICS). A purchase spends paid credits only
// (LedgerRepo.spend) and records ownership in the same transaction.
import { and, eq } from 'drizzle-orm';
import { cosmeticById } from '@skirm/shared';
import type { Executor } from '../client';
import { cosmeticsOwned } from '../schema';
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

  /**
   * Buys an item with paid credits. Already owned: ok, nothing charged. A concurrent buy of the same
   * item loses on the primary key, which rolls its spend back with it.
   */
  async buy(accountId: string, itemId: string): Promise<CosmeticBuyResult> {
    const item = cosmeticById(itemId);
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
    if (!cosmeticById(itemId)) throw new RepoError('not_found', `no cosmetic ${itemId}`);
    await this.db
      .insert(cosmeticsOwned)
      .values({ accountId, itemId, source })
      .onConflictDoNothing();
  }

  private async has(t: Executor, accountId: string, itemId: string): Promise<boolean> {
    const [row] = await t
      .select({ itemId: cosmeticsOwned.itemId })
      .from(cosmeticsOwned)
      .where(and(eq(cosmeticsOwned.accountId, accountId), eq(cosmeticsOwned.itemId, itemId)));
    return !!row;
  }
}
