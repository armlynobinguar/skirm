// Ranked tiers' server side: the per-map and per-skill leaderboards, and the Elo decay of inactive
// players from DEFAULTS.ranked.decay.fromTier up (@skirm/shared decayedElo). The overall ladder is
// LeaderboardsRepo.playerLadder.
import { DEFAULTS, decayFloorElo, decayedElo } from '@skirm/shared';
import { desc, eq, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { accounts, eloDecays } from '../schema';
import { rowsOf, tx, type Clock } from './util';

const DAY_MS = 86_400_000;

/** A player's ranked record on one map. */
export interface MapLadderRow {
  rank: number;
  account: { id: string; handle: string };
  /** The player's overall Elo and ranked matches (their tier comes from these). */
  elo: number;
  rankedMatches: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  /** wins / matches on this map. */
  winRate: number;
}

type MapLadderSqlRow = {
  id: string;
  handle: string;
  elo: number;
  ranked_matches: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  rank: number | string;
};

/** A skill's ranked record over all its versions (match_skill_stats, one count per crew and match). */
export interface SkillLadderRow {
  rank: number;
  skill: { id: string; name: string };
  creator: { id: string; handle: string };
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  /** wins / matches, as the market's rankedWinRate. */
  winRate: number;
}

type SkillLadderSqlRow = {
  skill_id: string;
  name: string;
  creator_id: string;
  handle: string;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  rank: number | string;
};

/** One decay step the job applied. */
export interface EloDecayStep {
  accountId: string;
  before: number;
  after: number;
}

export interface DecayOptions {
  /** Days without a ranked result (or a decay step) before the next step. */
  days?: number;
  /** Elo one step takes. */
  amount?: number;
}

const rate = (wins: number, matches: number) => (matches > 0 ? wins / matches : 0);

export class RankedRepo {
  constructor(
    private readonly db: Executor,
    private readonly clock: Clock = () => Date.now(),
  ) {}

  /**
   * Players by ranked results on one map: most wins first, then the better win rate (ties share a
   * rank), then Elo. Ended ranked matches only.
   */
  async mapLadder(mapId: string, limit = 100): Promise<MapLadderRow[]> {
    const res = await this.db.execute<MapLadderSqlRow>(sql`
      with sides as (
        select team_a_account_id as account_id,
          case winner when 'A' then 'win' when 'draw' then 'draw' else 'loss' end as outcome
        from v2_matches where map_id = ${mapId} and ranked and status = 'ended'
        union all
        select team_b_account_id,
          case winner when 'B' then 'win' when 'draw' then 'draw' else 'loss' end
        from v2_matches where map_id = ${mapId} and ranked and status = 'ended'
      ), agg as (
        select account_id, count(*)::int as matches,
          (count(*) filter (where outcome = 'win'))::int as wins,
          (count(*) filter (where outcome = 'loss'))::int as losses,
          (count(*) filter (where outcome = 'draw'))::int as draws
        from sides group by account_id
      )
      select a.id, a.handle, a.elo, a.ranked_matches, g.matches, g.wins, g.losses, g.draws,
        rank() over (order by g.wins desc, g.wins::float8 / g.matches desc) as rank
      from agg g join accounts a on a.id = g.account_id
      where not a.system
      order by g.wins desc, g.wins::float8 / g.matches desc, a.elo desc, a.id asc
      limit ${limit}`);
    return rowsOf<MapLadderSqlRow>(res).map((r) => ({
      rank: Number(r.rank),
      account: { id: r.id, handle: r.handle },
      elo: Number(r.elo),
      rankedMatches: Number(r.ranked_matches),
      matches: Number(r.matches),
      wins: Number(r.wins),
      losses: Number(r.losses),
      draws: Number(r.draws),
      winRate: rate(Number(r.wins), Number(r.matches)),
    }));
  }

  /**
   * Skills by ranked win rate, only those with at least `minMatches` ranked matches (optionally on
   * one map); ties share a rank, then more matches first.
   */
  async skillLadder(opts: { minMatches: number; limit?: number; mapId?: string }): Promise<SkillLadderRow[]> {
    const onMap = opts.mapId !== undefined ? sql`and map_id = ${opts.mapId}` : sql``;
    const res = await this.db.execute<SkillLadderSqlRow>(sql`
      with plays as (
        select distinct skill_id, match_id, team, outcome from match_skill_stats where ranked ${onMap}
      ), agg as (
        select skill_id, count(*)::int as matches,
          (count(*) filter (where outcome = 'win'))::int as wins,
          (count(*) filter (where outcome = 'loss'))::int as losses,
          (count(*) filter (where outcome = 'draw'))::int as draws
        from plays group by skill_id having count(*) >= ${opts.minMatches}
      )
      select g.skill_id, s.name, s.creator_id, a.handle, g.matches, g.wins, g.losses, g.draws,
        rank() over (order by g.wins::float8 / g.matches desc) as rank
      from agg g join skills s on s.id = g.skill_id join accounts a on a.id = s.creator_id
      order by g.wins::float8 / g.matches desc, g.matches desc, g.skill_id asc
      limit ${opts.limit ?? 100}`);
    return rowsOf<SkillLadderSqlRow>(res).map((r) => ({
      rank: Number(r.rank),
      skill: { id: r.skill_id, name: r.name },
      creator: { id: r.creator_id, handle: r.handle },
      matches: Number(r.matches),
      wins: Number(r.wins),
      losses: Number(r.losses),
      draws: Number(r.draws),
      winRate: rate(Number(r.wins), Number(r.matches)),
    }));
  }

  /**
   * One decay step for every placed player at or above the decay tier whose last ranked result and
   * last decay step are both at least `days` old: `amount` Elo less, never below the floor of the
   * tier they are in. Rows are locked as finish() locks them, so a result landing at the same time
   * wins (its fresh `last_ranked_at` takes the player out). Safe to run again: a player decays at
   * most once per `days`.
   */
  async decayInactive(opts: DecayOptions = {}): Promise<EloDecayStep[]> {
    const days = opts.days ?? DEFAULTS.ranked.decay.days;
    const amount = opts.amount ?? DEFAULTS.ranked.decay.amount;
    if (!(days > 0) || !(amount > 0)) return [];
    const now = this.clock();
    const cutoff = new Date(now - days * DAY_MS).toISOString();
    return tx(this.db, async (t) => {
      const res = await t.execute<{ id: string; elo: number; ranked_matches: number }>(sql`
        select a.id, a.elo, a.ranked_matches from accounts a
        where not a.system and a.deleted_at is null
          and a.ranked_matches >= ${DEFAULTS.ranked.placementMatches}
          and a.elo >= ${decayFloorElo()}
          and coalesce(a.last_ranked_at, a.created_at) <= ${cutoff}
          and not exists (
            select 1 from elo_decays d where d.account_id = a.id and d.created_at > ${cutoff})
        order by a.id
        for update of a`);
      const steps: EloDecayStep[] = [];
      for (const r of rowsOf<{ id: string; elo: number; ranked_matches: number }>(res)) {
        const before = Number(r.elo);
        const after = decayedElo(before, Number(r.ranked_matches), amount);
        if (after >= before) continue;
        await t.update(accounts).set({ elo: after }).where(eq(accounts.id, r.id));
        await t.insert(eloDecays).values({ accountId: r.id, eloBefore: before, eloAfter: after, createdAt: new Date(now) });
        steps.push({ accountId: r.id, before, after });
      }
      return steps;
    });
  }

  /**
   * When the next decay step would hit the player if they play no ranked match, or null when decay
   * does not apply to them (below the decay tier, at their tier floor, or still placing).
   */
  async nextDecayAt(
    account: { id: string; elo: number; rankedMatches: number; lastRankedAt: Date | null; createdAt: Date },
    days: number = DEFAULTS.ranked.decay.days,
  ): Promise<Date | null> {
    if (decayedElo(account.elo, account.rankedMatches) >= account.elo) return null;
    const [last] = await this.db
      .select({ at: eloDecays.createdAt })
      .from(eloDecays)
      .where(eq(eloDecays.accountId, account.id))
      .orderBy(desc(eloDecays.createdAt))
      .limit(1);
    const since = Math.max((account.lastRankedAt ?? account.createdAt).getTime(), last?.at.getTime() ?? 0);
    return new Date(since + days * DAY_MS);
  }
}
