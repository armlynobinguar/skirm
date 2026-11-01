// Operator stats for GET /ops/stats: players, credits in circulation and their flow, v2 match
// volume and the model cost each match recorded. Read-only aggregates over whole tables; every
// window is passed in so tests control the clock.
import { sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { rowsOf } from './util';

export interface OpsWindows {
  /** UTC day (YYYY-MM-DD) for the free budget row. */
  today: string;
  since1d: Date;
  since7d: Date;
  since30d: Date;
  /** Start of the daily series (UTC midnight). */
  seriesFrom: Date;
}

export interface LedgerFlowRow {
  type: string;
  source: string;
  rows: number;
  /** Sum of |amount| in credits. */
  credits: number;
}

export interface MatchDayRow {
  day: string;
  matches: number;
  costUsd: number;
  charged: number;
}

export interface OpsStats {
  players: { total: number; new1d: number; new7d: number; withNear: number };
  credits: {
    balance: number;
    held: number;
    fundedAccounts: number;
    freeBudgetUsedToday: number;
    flow30d: LedgerFlowRow[];
  };
  matches: {
    live: number;
    last1d: number;
    last7d: number;
    last30d: number;
    void30d: number;
    costUsd30d: number;
    charged30d: number;
    daily: MatchDayRow[];
  };
}

const n = (v: unknown) => Number(v ?? 0);

export class OpsRepo {
  constructor(private readonly db: Executor) {}

  async stats(w: OpsWindows): Promise<OpsStats> {
    const iso = (d: Date) => d.toISOString();
    const [players, balances, budget, flow, matches, daily] = await Promise.all([
      this.db.execute(sql`
        select count(*) as total,
          count(*) filter (where created_at >= ${iso(w.since1d)}::timestamptz) as new1d,
          count(*) filter (where created_at >= ${iso(w.since7d)}::timestamptz) as new7d,
          count(*) filter (where near_account_id is not null) as with_near
        from accounts where not system`),
      this.db.execute(sql`
        select coalesce(sum(balance), 0) as balance, coalesce(sum(held), 0) as held,
          count(*) filter (where balance > 0) as funded
        from ledger_accounts`),
      this.db.execute(sql`select used from free_budget_days where day = ${w.today}`),
      this.db.execute(sql`
        select type::text as type, source::text as source, count(*) as rows,
          coalesce(sum(abs(amount)), 0) as credits
        from ledger_rows where created_at >= ${iso(w.since30d)}::timestamptz
        group by type, source order by type, source`),
      this.db.execute(sql`
        select count(*) filter (where status = 'live') as live,
          count(*) filter (where created_at >= ${iso(w.since1d)}::timestamptz) as d1,
          count(*) filter (where created_at >= ${iso(w.since7d)}::timestamptz) as d7,
          count(*) filter (where created_at >= ${iso(w.since30d)}::timestamptz) as d30,
          count(*) filter (where status = 'void' and created_at >= ${iso(w.since30d)}::timestamptz) as void30,
          coalesce(sum(coalesce((stats->'A'->>'costUsd')::float8, 0) + coalesce((stats->'B'->>'costUsd')::float8, 0))
            filter (where created_at >= ${iso(w.since30d)}::timestamptz), 0) as cost30,
          coalesce(sum(coalesce((stats->'A'->>'charged')::float8, 0) + coalesce((stats->'B'->>'charged')::float8, 0))
            filter (where created_at >= ${iso(w.since30d)}::timestamptz), 0) as charged30
        from v2_matches`),
      this.db.execute(sql`
        select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*) as matches,
          coalesce(sum(coalesce((stats->'A'->>'costUsd')::float8, 0) + coalesce((stats->'B'->>'costUsd')::float8, 0)), 0) as cost,
          coalesce(sum(coalesce((stats->'A'->>'charged')::float8, 0) + coalesce((stats->'B'->>'charged')::float8, 0)), 0) as charged
        from v2_matches where created_at >= ${iso(w.seriesFrom)}::timestamptz
        group by 1 order by 1`),
    ]);
    const p = rowsOf<Record<string, unknown>>(players)[0] ?? {};
    const b = rowsOf<Record<string, unknown>>(balances)[0] ?? {};
    const m = rowsOf<Record<string, unknown>>(matches)[0] ?? {};
    return {
      players: { total: n(p.total), new1d: n(p.new1d), new7d: n(p.new7d), withNear: n(p.with_near) },
      credits: {
        balance: n(b.balance),
        held: n(b.held),
        fundedAccounts: n(b.funded),
        freeBudgetUsedToday: n(rowsOf<{ used: number }>(budget)[0]?.used),
        flow30d: rowsOf<Record<string, unknown>>(flow).map((r) => ({
          type: String(r.type),
          source: String(r.source),
          rows: n(r.rows),
          credits: n(r.credits),
        })),
      },
      matches: {
        live: n(m.live),
        last1d: n(m.d1),
        last7d: n(m.d7),
        last30d: n(m.d30),
        void30d: n(m.void30),
        costUsd30d: n(m.cost30),
        charged30d: n(m.charged30),
        daily: rowsOf<Record<string, unknown>>(daily).map((r) => ({
          day: String(r.day),
          matches: n(r.matches),
          costUsd: n(r.cost),
          charged: n(r.charged),
        })),
      },
    };
  }
}
