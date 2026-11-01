// Worker wiring of the cost alert: daily spend in Redis, `cost_alert` logged at 50/80/100%.
import { describe, expect, it } from 'vitest';
import { costMonitor } from '../src/app';
import { quietLogger } from './helpers';

describe('worker cost alert', () => {
  it('logs cost_alert (warn, then error at 100%) as the day crosses COST_ALERT_DAILY_USD', async () => {
    const kv = new Map<string, number>();
    const redis = {
      incrbyfloat: async (k: string, by: number) => String(kv.set(k, (kv.get(k) ?? 0) + by).get(k)),
      expire: async () => 1,
    };
    const logger = quietLogger();
    const m = costMonitor(redis as never, 0.01, logger);
    for (let i = 0; i < 10; i++) await m.record(0.0011);
    const alerts = logger.lines.filter((l) => l.msg === 'cost_alert');
    expect(alerts.map((a) => [a.level, (a.fields as { level: number }).level])).toEqual([
      ['warn', 0.5],
      ['warn', 0.8],
      ['error', 1],
    ]);
    expect(alerts[2]!.fields).toMatchObject({ budgetUsd: 0.01 });
  });
});
