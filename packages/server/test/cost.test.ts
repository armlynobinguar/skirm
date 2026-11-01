// Cost alert: daily model spend summed across instances, one alert per level crossed.
import { describe, expect, it } from 'vitest';
import {
  CostMonitor,
  MemoryCostStore,
  RedisCostStore,
  costKey,
  loadConfig,
  type CostAlert,
  type CostRedis,
  type CostStore,
} from '../src/index';

const DAY = Date.UTC(2026, 10, 8, 12);

function monitor(budget: number, store: CostStore = new MemoryCostStore(), now = () => DAY) {
  const alerts: CostAlert[] = [];
  return {
    alerts,
    m: new CostMonitor({ store, dailyBudgetUsd: budget, onAlert: (a) => alerts.push(a), now }),
  };
}

describe('CostMonitor', () => {
  it('alerts once at 50%, 80% and 100% of the daily budget', async () => {
    const { m, alerts } = monitor(1);
    for (let i = 0; i < 12; i++) await m.record(0.1);
    expect(alerts.map((a) => a.level)).toEqual([0.5, 0.8, 1]);
    expect(alerts[0]).toMatchObject({ day: '2026-11-08', budgetUsd: 1, spentUsd: 0.5 });
    expect(alerts[2]!.spentUsd).toBeCloseTo(1, 6);
  });

  it('one big call can cross several levels; zero, negative and NaN costs are ignored', async () => {
    const { m, alerts } = monitor(2);
    await m.record(0);
    await m.record(-5);
    await m.record(Number.NaN);
    expect(alerts).toEqual([]);
    await m.record(1.7);
    expect(alerts.map((a) => a.level)).toEqual([0.5, 0.8]);
  });

  it('starts over each UTC day', async () => {
    let t = DAY;
    const { m, alerts } = monitor(1, new MemoryCostStore(), () => t);
    await m.record(0.6);
    t += 86_400_000;
    await m.record(0.6);
    expect(alerts.map((a) => [a.day, a.level])).toEqual([
      ['2026-11-08', 0.5],
      ['2026-11-09', 0.5],
    ]);
  });

  it('budget 0 turns alerts off', async () => {
    const { m, alerts } = monitor(0);
    await m.record(100);
    expect(alerts).toEqual([]);
  });

  it('shares the total through Redis INCRBYFLOAT, so two instances alert once between them', async () => {
    const kv = new Map<string, number>();
    const ttl = new Map<string, number>();
    const redis: CostRedis = {
      incrbyfloat: async (k, by) => String(kv.set(k, (kv.get(k) ?? 0) + by).get(k)),
      expire: async (k, s) => (ttl.set(k, s), 1),
    };
    const a = monitor(1, new RedisCostStore(redis));
    const b = monitor(1, new RedisCostStore(redis));
    await a.m.record(0.3);
    await b.m.record(0.3); // crosses 50% on instance b only
    expect(a.alerts).toEqual([]);
    expect(b.alerts.map((x) => x.level)).toEqual([0.5]);
    expect(kv.get(costKey('2026-11-08'))).toBeCloseTo(0.6, 9);
    expect(ttl.get(costKey('2026-11-08'))).toBe(3 * 86_400);
  });

  it('COST_ALERT_DAILY_USD defaults to 10 and is validated', () => {
    expect(loadConfig({}).COST_ALERT_DAILY_USD).toBe(10);
    expect(loadConfig({ COST_ALERT_DAILY_USD: '2.5' }).COST_ALERT_DAILY_USD).toBe(2.5);
    expect(loadConfig({ COST_ALERT_DAILY_USD: '0' }).COST_ALERT_DAILY_USD).toBe(0);
    expect(() => loadConfig({ COST_ALERT_DAILY_USD: '-1' })).toThrow(/COST_ALERT_DAILY_USD/);
  });
});
