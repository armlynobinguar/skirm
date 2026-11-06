// Agent accounts (docs/agent-accounts.md): an agent's own custodial NEAR account, its sealed key and
// the owner's per-match spend cap, plus every payment the account makes.
//
// The cap is enforced here, atomically: reserveRent locks the account's row (SELECT … FOR UPDATE),
// sums what the account has already committed to the coming match and inserts the new payment as
// `pending` in the same transaction, so two concurrent spends cannot both slip under the cap.
// "Committed" is every rent payment still pending or unknown, plus every sent one whose pass has
// not been used by a match yet (a pass is good for one match, so those are what the next match
// costs). The api signs only after the reservation commits, and settles the row afterwards.
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { newId } from '../ids';
import { agentAccounts, agentAccountSpends, agents, rentals } from '../schema';
import { RepoError } from '../types';
import { isUniqueViolation, tx } from './util';

export type AgentAccountRow = typeof agentAccounts.$inferSelect;
export type AgentAccountSpendRow = typeof agentAccountSpends.$inferSelect;

/** The sealed full-access key (SealedSecret in @skirm/server). */
export interface SealedAgentKey {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
  wrappedKey: Uint8Array;
  keyId: string;
}

export interface CreateAgentAccountInput {
  agentId: string;
  ownerId: string;
  nearAccountId: string;
  publicKey: string;
  key: SealedAgentKey;
}

export interface ReserveRentInput {
  agentId: string;
  /** The agent's owner (the renter paying from their agent's account). */
  ownerId: string;
  offerId: string;
  amountYocto: bigint;
  /** What the account can spend right now (balance minus storage and the gas reserve). */
  spendableYocto: bigint;
}

const OPEN = ['pending', 'unknown'] as const;

export const sealedKeyOf = (r: AgentAccountRow): SealedAgentKey => ({
  ciphertext: r.keyCiphertext,
  iv: r.keyIv,
  authTag: r.keyAuthTag,
  wrappedKey: r.keyWrapped,
  keyId: r.keyKeyId,
});

export class AgentAccountsRepo {
  constructor(private readonly db: Executor) {}

  async get(agentId: string): Promise<AgentAccountRow | undefined> {
    const [row] = await this.db.select().from(agentAccounts).where(eq(agentAccounts.agentId, agentId));
    return row;
  }

  /** Stores a freshly created account. Refused with `exists` when the agent already has one. */
  async create(input: CreateAgentAccountInput): Promise<AgentAccountRow> {
    const [agent] = await this.db.select({ ownerId: agents.ownerId }).from(agents).where(eq(agents.id, input.agentId));
    if (!agent || agent.ownerId !== input.ownerId) throw new RepoError('not_found', 'agent not found');
    try {
      const [row] = await this.db
        .insert(agentAccounts)
        .values({
          agentId: input.agentId,
          ownerId: input.ownerId,
          nearAccountId: input.nearAccountId,
          publicKey: input.publicKey,
          keyCiphertext: input.key.ciphertext,
          keyIv: input.key.iv,
          keyAuthTag: input.key.authTag,
          keyWrapped: input.key.wrappedKey,
          keyKeyId: input.key.keyId,
        })
        .returning();
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) throw new RepoError('exists', 'this agent already has an account');
      throw err;
    }
  }

  /** Drops a row whose onchain creation failed (only while it has made no payment). */
  async remove(agentId: string): Promise<void> {
    const [spent] = await this.db
      .select({ id: agentAccountSpends.id })
      .from(agentAccountSpends)
      .where(eq(agentAccountSpends.agentId, agentId))
      .limit(1);
    if (spent) throw new RepoError('conflict', 'this agent account has payments');
    await this.db.delete(agentAccounts).where(eq(agentAccounts.agentId, agentId));
  }

  /** Sets the per-match spend cap on the owner's own agent account. */
  async setCap(ownerId: string, agentId: string, capYocto: bigint): Promise<AgentAccountRow> {
    if (capYocto < 0n) throw new RepoError('invalid_cap', 'the cap cannot be negative');
    const [row] = await this.db
      .update(agentAccounts)
      .set({ capYocto: capYocto.toString(), updatedAt: new Date() })
      .where(and(eq(agentAccounts.agentId, agentId), eq(agentAccounts.ownerId, ownerId)))
      .returning();
    if (!row) throw new RepoError('not_found', 'agent account not found');
    return row;
  }

  /** What the account has committed to the coming match (see the file comment). */
  async committed(agentId: string, db: Executor = this.db): Promise<bigint> {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${agentAccountSpends.amountYocto}), 0)::text` })
      .from(agentAccountSpends)
      .leftJoin(rentals, eq(rentals.id, agentAccountSpends.rentalId))
      .where(
        and(
          eq(agentAccountSpends.agentId, agentId),
          eq(agentAccountSpends.kind, 'rent'),
          or(
            inArray(agentAccountSpends.status, [...OPEN]),
            and(eq(agentAccountSpends.status, 'sent'), isNull(rentals.matchId)),
          ),
        ),
      );
    return BigInt(row?.total ?? '0');
  }

  /** Sum of payments not settled yet (signing now, or without an answer). */
  private async inFlight(agentId: string, db: Executor): Promise<{ total: bigint; withdraws: number }> {
    const [row] = await db
      .select({
        total: sql<string>`coalesce(sum(${agentAccountSpends.amountYocto}), 0)::text`,
        withdraws: sql<number>`count(*) filter (where ${agentAccountSpends.kind} = 'withdraw')::int`,
      })
      .from(agentAccountSpends)
      .where(and(eq(agentAccountSpends.agentId, agentId), inArray(agentAccountSpends.status, [...OPEN])));
    return { total: BigInt(row?.total ?? '0'), withdraws: Number(row?.withdraws ?? 0) };
  }

  /** Locks the owner's account row for the rest of the transaction. */
  private async lock(t: Executor, agentId: string, ownerId: string): Promise<AgentAccountRow> {
    const [row] = await t
      .select()
      .from(agentAccounts)
      .where(and(eq(agentAccounts.agentId, agentId), eq(agentAccounts.ownerId, ownerId)))
      .for('update');
    if (!row) throw new RepoError('not_found', 'agent account not found');
    return row;
  }

  /**
   * Reserves a rent payment under the cap, atomically. Refused with `over_cap` { capYocto,
   * committedYocto } when it would take the coming match's spend over the cap, `insufficient_balance`
   * when the account cannot cover it next to the payments in flight, and `busy` during a withdrawal.
   */
  async reserveRent(input: ReserveRentInput): Promise<AgentAccountSpendRow> {
    if (input.amountYocto <= 0n) throw new RepoError('invalid_amount', 'a payment must be above 0');
    return tx(this.db, async (t) => {
      const acc = await this.lock(t, input.agentId, input.ownerId);
      const flight = await this.inFlight(input.agentId, t);
      if (flight.withdraws > 0) throw new RepoError('busy', 'a withdrawal is in progress');
      const cap = BigInt(acc.capYocto);
      const committed = await this.committed(input.agentId, t);
      if (committed + input.amountYocto > cap)
        throw new RepoError('over_cap', "this would take the agent's spend for the match over its cap", {
          capYocto: cap.toString(),
          committedYocto: committed.toString(),
        });
      if (flight.total + input.amountYocto > input.spendableYocto)
        throw new RepoError('insufficient_balance', 'the agent account cannot cover this', {
          spendableYocto: input.spendableYocto.toString(),
        });
      const [row] = await t
        .insert(agentAccountSpends)
        .values({
          id: newId('aas'),
          agentId: input.agentId,
          kind: 'rent',
          amountYocto: input.amountYocto.toString(),
          offerId: input.offerId,
        })
        .returning();
      return row!;
    });
  }

  /** Reserves a withdrawal; refused with `busy` while any payment is in flight. */
  async reserveWithdraw(input: { agentId: string; ownerId: string; amountYocto: bigint }): Promise<AgentAccountSpendRow> {
    if (input.amountYocto <= 0n) throw new RepoError('invalid_amount', 'nothing to withdraw');
    return tx(this.db, async (t) => {
      await this.lock(t, input.agentId, input.ownerId);
      const flight = await this.inFlight(input.agentId, t);
      if (flight.total > 0n) throw new RepoError('busy', 'a payment from this account is in progress');
      const [row] = await t
        .insert(agentAccountSpends)
        .values({ id: newId('aas'), agentId: input.agentId, kind: 'withdraw', amountYocto: input.amountYocto.toString() })
        .returning();
      return row!;
    });
  }

  /** Settles a reserved payment once the chain has answered (or failed to). */
  async settle(
    spendId: string,
    out: { status: 'sent' | 'failed' | 'unknown'; txHash?: string | null; rentalId?: string | null },
    now = new Date(),
  ): Promise<AgentAccountSpendRow> {
    const [row] = await this.db
      .update(agentAccountSpends)
      .set({
        status: out.status,
        txHash: out.txHash ?? null,
        rentalId: out.rentalId ?? null,
        settledAt: out.status === 'unknown' ? null : now,
      })
      .where(and(eq(agentAccountSpends.id, spendId), inArray(agentAccountSpends.status, [...OPEN])))
      .returning();
    if (!row) throw new RepoError('not_found', 'no open payment with this id');
    return row;
  }

  async spends(agentId: string): Promise<AgentAccountSpendRow[]> {
    return this.db.select().from(agentAccountSpends).where(eq(agentAccountSpends.agentId, agentId));
  }
}
