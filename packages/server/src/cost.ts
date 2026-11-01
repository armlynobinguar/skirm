// Cost alert (Milestones Sun 8 Nov, Observability: "Tokens, cost and latency per turn logged; cost
// alert"; risk table: "Daily spend above the cap set in prep"). Every model call's costUsd is added
// to a per-UTC-day total shared by every worker and realtime instance (Redis), and a structured
// `cost_alert` log line goes out once per level as the day's spend crosses 50%, 80% and 100% of
// COST_ALERT_DAILY_USD.
//
// System Architecture routes alerts through Cloud Logging/Monitoring and Billing budgets. Neither is
// reachable from the app, so the alert is the log line: on GCP, a log-based metric on
// `jsonPayload.msg="cost_alert"` drives the Monitoring alert (docs/deploy.md). The provider-side
// monthly spend limits on each key stay the hard stop.

/** Per-day running total. `add` returns the new total for the day. */
export interface CostStore {
  add(day: string, usd: number): Promise<number>;
}

export class MemoryCostStore implements CostStore {
  private readonly totals = new Map<string, number>();
  async add(day: string, usd: number): Promise<number> {
    const t = (this.totals.get(day) ?? 0) + usd;
    this.totals.set(day, t);
    return t;
  }
}

/** The ioredis calls the Redis store needs. */
export interface CostRedis {
  incrbyfloat(key: string, increment: number): Promise<string>;
  expire(key: string, seconds: number): Promise<number>;
}

export const costKey = (day: string) => `cost:usd:${day}`;

/** Shared across instances: INCRBYFLOAT is atomic, so exactly one caller sees each crossing. */
export class RedisCostStore implements CostStore {
  constructor(private readonly redis: CostRedis) {}
  async add(day: string, usd: number): Promise<number> {
    const key = costKey(day);
    const total = Number(await this.redis.incrbyfloat(key, usd));
    await this.redis.expire(key, 3 * 86_400);
    return total;
  }
}

/** Fractions of the daily budget that raise an alert. */
export const COST_ALERT_LEVELS = [0.5, 0.8, 1] as const;

export interface CostAlert {
  day: string;
  /** Fraction of the budget crossed (0.5, 0.8 or 1). */
  level: number;
  spentUsd: number;
  budgetUsd: number;
}

export interface CostMonitorOptions {
  store: CostStore;
  /** COST_ALERT_DAILY_USD; 0 turns alerts off (spend is still summed). */
  dailyBudgetUsd: number;
  /** Receives each alert (the apps log it as `cost_alert`). */
  onAlert: (alert: CostAlert) => void;
  now?: () => number;
}

export class CostMonitor {
  constructor(private readonly opts: CostMonitorOptions) {}

  /** Adds one call's cost to today's total and raises any level it crosses. */
  async record(costUsd: number): Promise<void> {
    if (!Number.isFinite(costUsd) || costUsd <= 0) return;
    const day = new Date((this.opts.now ?? Date.now)()).toISOString().slice(0, 10);
    const total = await this.opts.store.add(day, costUsd);
    const budget = this.opts.dailyBudgetUsd;
    if (!(budget > 0)) return;
    const before = total - costUsd;
    for (const level of COST_ALERT_LEVELS) {
      const at = level * budget;
      // Small epsilon: float sums must not re-cross a level they already reached.
      if (before < at - 1e-12 && total >= at - 1e-12)
        this.opts.onAlert({ day, level, spentUsd: round6(total), budgetUsd: budget });
    }
  }
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
