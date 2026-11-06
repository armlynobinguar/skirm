// Gasless onboarding's quota (docs/gasless.md): every meta-transaction the api relays for a player
// is a `relayed_txs` row. reserve() takes a slot under a lock on the account row, so two requests at
// once cannot both take the last free slot; the api then relays and marks the row sent or failed.
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { newId } from '../ids';
import { accounts, relayedTxs } from '../schema';
import { RepoError } from '../types';
import { isUniqueViolation, tx } from './util';

export type RelayedTxRow = typeof relayedTxs.$inferSelect;

/** Statuses that use up a free relayed transaction (`failed` never reached the chain). */
const COUNTED = ['pending', 'sent'] as const;

export interface ReserveRelayInput {
  accountId: string;
  nearAccountId: string;
  receiverId: string;
  methods: string[];
  /** sha256 hex of the SignedDelegate. */
  delegateHash: string;
  /** Free relayed transactions per player. */
  quota: number;
  now?: Date;
}

export class RelayRepo {
  constructor(private readonly db: Executor) {}

  /** Relayed transactions that count against the player (by skirm account or NEAR account). */
  async used(accountId: string, nearAccountId: string | null, db: Executor = this.db): Promise<number> {
    const who = nearAccountId
      ? or(eq(relayedTxs.accountId, accountId), eq(relayedTxs.nearAccountId, nearAccountId))
      : eq(relayedTxs.accountId, accountId);
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(relayedTxs)
      .where(and(who, inArray(relayedTxs.status, [...COUNTED])));
    return r?.n ?? 0;
  }

  /**
   * Takes one free slot as a `pending` row. RepoError `relay_quota` (with `quota`, `used`) when none
   * is left, `relay_duplicate` when this delegate was relayed before.
   */
  async reserve(input: ReserveRelayInput): Promise<RelayedTxRow> {
    const now = input.now ?? new Date();
    try {
      return await tx(this.db, async (t) => {
        const [acc] = await t.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, input.accountId)).for('update');
        if (!acc) throw new RepoError('not_found', 'account not found');
        const used = await this.used(input.accountId, input.nearAccountId, t);
        if (used >= input.quota)
          throw new RepoError('relay_quota', `the ${input.quota} free transactions are used up`, { quota: input.quota, used });
        const [row] = await t
          .insert(relayedTxs)
          .values({
            id: newId('rly'),
            accountId: input.accountId,
            nearAccountId: input.nearAccountId,
            receiverId: input.receiverId,
            methods: input.methods.join(','),
            delegateHash: input.delegateHash,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        return row!;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new RepoError('relay_duplicate', 'this transaction was already relayed');
      throw err;
    }
  }

  /** The relayer's transaction reached the chain (it counts, whatever the contract did with it). */
  async markSent(id: string, txHash: string, now = new Date()): Promise<void> {
    await this.db.update(relayedTxs).set({ status: 'sent', txHash, updatedAt: now }).where(eq(relayedTxs.id, id));
  }

  /** Nothing reached the chain: the slot is given back. */
  async markFailed(id: string, now = new Date()): Promise<void> {
    await this.db.update(relayedTxs).set({ status: 'failed', updatedAt: now }).where(eq(relayedTxs.id, id));
  }
}
