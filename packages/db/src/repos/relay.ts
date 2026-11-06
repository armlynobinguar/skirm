// Gasless onboarding's quota (docs/gasless.md): every meta-transaction the api relays for a player
// is a `relayed_txs` row. reserve() takes a slot under a lock on the account row, so two requests at
// once cannot both take the last free slot; the api then relays and marks the row sent or failed.
// A failed row can be reserved again (the same signed delegate, retried); a row left `pending` (the
// process died mid-relay) stops counting after RELAY_PENDING_STALE_MS and is swept to `failed`.
import { and, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { newId } from '../ids';
import { accounts, relayedTxs } from '../schema';
import { RepoError } from '../types';
import { isUniqueViolation, tx } from './util';

export type RelayedTxRow = typeof relayedTxs.$inferSelect;

/** A `pending` row older than this never finished relaying: it stops counting and is swept to failed. */
export const RELAY_PENDING_STALE_MS = 10 * 60_000;

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

  /**
   * Relayed transactions that count against the player (by skirm account or NEAR account): every
   * `sent` row and the `pending` rows still in flight (`failed` never reached the chain).
   */
  async used(
    accountId: string,
    nearAccountId: string | null,
    db: Executor = this.db,
    now: Date = new Date(),
  ): Promise<number> {
    const who = nearAccountId
      ? or(eq(relayedTxs.accountId, accountId), eq(relayedTxs.nearAccountId, nearAccountId))
      : eq(relayedTxs.accountId, accountId);
    const fresh = new Date(now.getTime() - RELAY_PENDING_STALE_MS);
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(relayedTxs)
      .where(
        and(
          who,
          or(
            eq(relayedTxs.status, 'sent'),
            and(eq(relayedTxs.status, 'pending'), gte(relayedTxs.updatedAt, fresh)),
          ),
        ),
      );
    return r?.n ?? 0;
  }

  /** Marks `pending` rows older than RELAY_PENDING_STALE_MS failed; returns how many. */
  async expireStale(now: Date = new Date()): Promise<number> {
    const rows = await this.db
      .update(relayedTxs)
      .set({ status: 'failed', updatedAt: now })
      .where(
        and(
          eq(relayedTxs.status, 'pending'),
          lt(relayedTxs.updatedAt, new Date(now.getTime() - RELAY_PENDING_STALE_MS)),
        ),
      )
      .returning({ id: relayedTxs.id });
    return rows.length;
  }

  /**
   * Takes one free slot as a `pending` row. RepoError `relay_quota` (with `quota`, `used`) when none
   * is left, `relay_duplicate` when this delegate is in flight or was sent. A delegate whose earlier
   * relay failed takes its old row back (the unique delegate hash keeps one row per delegate).
   */
  async reserve(input: ReserveRelayInput): Promise<RelayedTxRow> {
    const now = input.now ?? new Date();
    try {
      return await tx(this.db, async (t) => {
        const [acc] = await t.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, input.accountId)).for('update');
        if (!acc) throw new RepoError('not_found', 'account not found');
        const [prev] = await t
          .select()
          .from(relayedTxs)
          .where(eq(relayedTxs.delegateHash, input.delegateHash))
          .for('update');
        const stalePending =
          prev?.status === 'pending' && prev.updatedAt.getTime() < now.getTime() - RELAY_PENDING_STALE_MS;
        if (prev && prev.status !== 'failed' && !stalePending)
          throw new RepoError('relay_duplicate', 'this transaction was already relayed');
        const used = await this.used(input.accountId, input.nearAccountId, t, now);
        if (used >= input.quota)
          throw new RepoError('relay_quota', `the ${input.quota} free transactions are used up`, { quota: input.quota, used });
        if (prev) {
          const [row] = await t
            .update(relayedTxs)
            .set({
              accountId: input.accountId,
              nearAccountId: input.nearAccountId,
              receiverId: input.receiverId,
              methods: input.methods.join(','),
              status: 'pending',
              txHash: null,
              updatedAt: now,
            })
            .where(and(eq(relayedTxs.id, prev.id), inArray(relayedTxs.status, ['failed', 'pending'])))
            .returning();
          if (!row) throw new RepoError('relay_duplicate', 'this transaction was already relayed');
          return row;
        }
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
