// The v2 player ladder as queries: per-account Elo from ranked v2 matches.
import { sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { rowsOf } from './util';

/** v2 player ladder: per-account Elo from ranked v2 matches. */
export interface PlayerLadderRow {
  rank: number;
  account: { id: string; handle: string };
  elo: number;
  rankedMatches: number;
  wins: number;
  losses: number;
  draws: number;
}

type PlayerLadderSqlRow = {
  id: string;
  handle: string;
  elo: number;
  ranked_matches: number;
  wins: number;
  losses: number;
  draws: number;
  rank: number | string;
};

const playerRow = (r: PlayerLadderSqlRow): PlayerLadderRow => ({
  rank: Number(r.rank),
  account: { id: r.id, handle: r.handle },
  elo: Number(r.elo),
  rankedMatches: Number(r.ranked_matches),
  wins: Number(r.wins),
  losses: Number(r.losses),
  draws: Number(r.draws),
});

/** Players with at least one ranked v2 match, ranked by Elo (ties share a rank). */
const playersCte = sql`
  with ladder as (
    select a.id, a.handle, a.elo, a.ranked_matches, a.wins, a.losses, a.draws,
      rank() over (order by a.elo desc) as rank
    from accounts a
    where a.ranked_matches > 0 and not a.system
  )`;

export class LeaderboardsRepo {
  constructor(private readonly db: Executor) {}

  /** The v2 player ladder, top first. */
  async playerLadder(limit = 100): Promise<PlayerLadderRow[]> {
    const res = await this.db.execute<PlayerLadderSqlRow>(sql`
      ${playersCte}
      select * from ladder order by elo desc, wins desc, id asc limit ${limit}`);
    return rowsOf<PlayerLadderSqlRow>(res).map(playerRow);
  }

  /**
   * A player's ladder row; undefined before their first ranked v2 match. Runs on every GET /me, so
   * the rank is a count of better Elos (same as the ladder's rank()) instead of ranking everyone.
   */
  async playerRowFor(accountId: string): Promise<PlayerLadderRow | undefined> {
    const res = await this.db.execute<PlayerLadderSqlRow>(sql`
      select a.id, a.handle, a.elo, a.ranked_matches, a.wins, a.losses, a.draws,
        1 + (select count(*) from accounts o where o.ranked_matches > 0 and not o.system and o.elo > a.elo) as rank
      from accounts a
      where a.id = ${accountId} and a.ranked_matches > 0 and not a.system`);
    const [r] = rowsOf<PlayerLadderSqlRow>(res);
    return r ? playerRow(r) : undefined;
  }
}
