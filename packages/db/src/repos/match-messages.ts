// What was said in a v2 match: the lines realtime saw delivered, stored by V2MatchesRepo.finish.
import { and, asc, eq, gt } from 'drizzle-orm';
import type { Executor } from '../client';
import { matchMessages } from '../schema';

export type MatchMessageRow = typeof matchMessages.$inferSelect;

export const MATCH_MESSAGES_MAX_LIMIT = 500;

export interface MatchMessagesPage {
  messages: MatchMessageRow[];
  /** Pass as `afterTick` for the next page; absent on the last page. */
  next?: number;
}

export class MatchMessagesRepo {
  constructor(private readonly db: Executor) {}

  /**
   * A match's lines in order (tick, then id), after `afterTick` when given. Pages end on a whole
   * tick, so `next` (the last tick returned) never skips a line; a single tick with more lines than
   * `limit` comes back whole.
   */
  async list(matchId: string, opts: { afterTick?: number; limit?: number } = {}): Promise<MatchMessagesPage> {
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 200), 1), MATCH_MESSAGES_MAX_LIMIT);
    const where = opts.afterTick === undefined
      ? eq(matchMessages.matchId, matchId)
      : and(eq(matchMessages.matchId, matchId), gt(matchMessages.tick, opts.afterTick));
    const rows = await this.db
      .select()
      .from(matchMessages)
      .where(where)
      .orderBy(asc(matchMessages.tick), asc(matchMessages.id))
      .limit(limit + 1);
    if (rows.length <= limit) return { messages: rows };
    const cut = rows[limit]!.tick;
    let page = rows.slice(0, limit).filter((r) => r.tick !== cut);
    if (page.length === 0) {
      page = await this.db
        .select()
        .from(matchMessages)
        .where(and(eq(matchMessages.matchId, matchId), eq(matchMessages.tick, cut)))
        .orderBy(asc(matchMessages.id));
    }
    return { messages: page, next: page.at(-1)!.tick };
  }
}
