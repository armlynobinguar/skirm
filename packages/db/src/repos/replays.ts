// Replay shares (a player's public link to an ended match's replay, optionally a clip) and the
// per-match highlight cache with its caster lines.
import { randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { replayCasts, replayShares, type ReplayHighlightRecord } from '../schema';

export type ReplayShareRow = typeof replayShares.$inferSelect;
export type ReplayCastRow = typeof replayCasts.$inferSelect;

/** At most this many live links per player per match. */
export const REPLAY_SHARES_PER_MATCH = 20;

/** A share token: `rps_` + 96 random bits in base64url. */
export const newShareId = () => `rps_${randomBytes(12).toString('base64url')}`;
export const SHARE_ID_RE = /^rps_[A-Za-z0-9_-]{16}$/;

export interface CreateShareInput {
  matchId: string;
  accountId: string;
  /** Both or neither: a clip of the match. */
  clip?: { start: number; end: number } | null;
}

export interface PutCastInput {
  matchId: string;
  highlights: ReplayHighlightRecord[];
  caster: 'model' | 'template';
  model: string | null;
  costUsd: number;
}

export class ReplaysRepo {
  constructor(private readonly db: Executor) {}

  async createShare(input: CreateShareInput): Promise<ReplayShareRow> {
    const [row] = await this.db
      .insert(replayShares)
      .values({
        id: newShareId(),
        matchId: input.matchId,
        accountId: input.accountId,
        startTick: input.clip?.start ?? null,
        endTick: input.clip?.end ?? null,
      })
      .returning();
    return row!;
  }

  /** A share that has not been revoked. */
  async getShare(id: string): Promise<ReplayShareRow | undefined> {
    const [row] = await this.db
      .select()
      .from(replayShares)
      .where(and(eq(replayShares.id, id), isNull(replayShares.revokedAt)));
    return row;
  }

  /** A player's live links to one match, newest first. */
  async sharesOf(matchId: string, accountId: string): Promise<ReplayShareRow[]> {
    return this.db
      .select()
      .from(replayShares)
      .where(and(eq(replayShares.matchId, matchId), eq(replayShares.accountId, accountId), isNull(replayShares.revokedAt)))
      .orderBy(desc(replayShares.createdAt), desc(replayShares.id));
  }

  async countShares(matchId: string, accountId: string): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(replayShares)
      .where(and(eq(replayShares.matchId, matchId), eq(replayShares.accountId, accountId), isNull(replayShares.revokedAt)));
    return Number(r?.n ?? 0);
  }

  /** Ends a link its creator made; false when it is not theirs or already ended. */
  async revokeShare(id: string, accountId: string): Promise<boolean> {
    const rows = await this.db
      .update(replayShares)
      .set({ revokedAt: new Date() })
      .where(and(eq(replayShares.id, id), eq(replayShares.accountId, accountId), isNull(replayShares.revokedAt)))
      .returning({ id: replayShares.id });
    return rows.length > 0;
  }

  async getCast(matchId: string): Promise<ReplayCastRow | undefined> {
    const [row] = await this.db.select().from(replayCasts).where(eq(replayCasts.matchId, matchId));
    return row;
  }

  /** Keeps the first cast of a match (a concurrent second one is dropped) and returns what is stored. */
  async putCast(input: PutCastInput): Promise<ReplayCastRow> {
    await this.db.insert(replayCasts).values(input).onConflictDoNothing({ target: replayCasts.matchId });
    return (await this.getCast(input.matchId))!;
  }
}
