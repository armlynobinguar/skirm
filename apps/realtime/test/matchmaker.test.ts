import { describe, expect, it } from 'vitest';
import { Matchmaker } from '../src/matchmaker';
import { DEFAULT_QUEUE_TIMING, eloRange, type Scheduler } from '../src/timing';
import { v2PoolsMatch } from '../src/v2/hub';

class ManualScheduler implements Scheduler {
  t = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private id = 0;
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => {
    const id = ++this.id;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  };
  clearTimeout = (h: unknown) => {
    this.timers = this.timers.filter((x) => x.id !== h);
  };
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = end;
  }
}

describe('Elo range widening', () => {
  it('starts at ±100 and widens by 50 every 5 s up to 1000', () => {
    expect(eloRange(DEFAULT_QUEUE_TIMING, 0)).toBe(100);
    expect(eloRange(DEFAULT_QUEUE_TIMING, 4999)).toBe(100);
    expect(eloRange(DEFAULT_QUEUE_TIMING, 5000)).toBe(150);
    expect(eloRange(DEFAULT_QUEUE_TIMING, 60_000)).toBe(700);
    expect(eloRange(DEFAULT_QUEUE_TIMING, 10 * 60_000)).toBe(1000);
  });

  it('pairs far-apart ratings only once both ranges cover the gap, and sends queue_status', () => {
    const s = new ManualScheduler();
    const statuses: [string, number, number][] = [];
    const pairs: [string, string][] = [];
    const mm = new Matchmaker<null>(DEFAULT_QUEUE_TIMING, s, {
      status: (e, ms, r) => statuses.push([e.key, ms, r]),
      pair: (a, b) => pairs.push([a.key, b.key]),
    });
    mm.start();
    mm.add({ key: 'low', lane: 'casual', rating: 1200, payload: null });
    s.advance(2000);
    mm.add({ key: 'high', lane: 'casual', rating: 1450, payload: null });
    mm.add({ key: 'ranked', lane: 'ranked', rating: 1200, payload: null });
    expect(pairs).toEqual([]);
    // gap 250 needs range 250 = 100 + 3 × 50: 15 s for `high` (joined 2 s later).
    s.advance(14_000); // t = 16 s: `high` has searched 14 s, range 200
    expect(pairs).toEqual([]);
    s.advance(1000);
    expect(pairs).toEqual([['low', 'high']]);
    expect(mm.has('ranked')).toBe(true);
    const lowStatus = statuses.filter(([k]) => k === 'low');
    expect(lowStatus[0]).toEqual(['low', 0, 100]);
    expect(lowStatus.some(([, ms, r]) => ms >= 5000 && r === 150)).toBe(true);
    mm.stop();
  });

  it('prefers the closest rating and never pairs an account with itself', () => {
    const s = new ManualScheduler();
    const pairs: [string, string][] = [];
    const mm = new Matchmaker<null>(DEFAULT_QUEUE_TIMING, s, {
      status: () => {},
      pair: (a, b) => pairs.push([a.key, b.key]),
    });
    mm.add({ key: 'a', lane: 'casual', rating: 1200, payload: null });
    expect(() => mm.add({ key: 'a', lane: 'casual', rating: 1200, payload: null })).toThrow();
    s.advance(10);
    mm.add({ key: 'b', lane: 'casual', rating: 1290, payload: null });
    expect(pairs).toEqual([['a', 'b']]);
    mm.add({ key: 'c', lane: 'casual', rating: 1200, payload: null });
    mm.add({ key: 'd', lane: 'casual', rating: 1260, payload: null });
    mm.add({ key: 'e', lane: 'casual', rating: 1210, payload: null });
    expect(pairs).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(mm.remove('e')).toBeTruthy();
    expect(mm.size).toBe(0);
  });

  it('pairs entries with a pool only within that pool', () => {
    const s = new ManualScheduler();
    const pairs: [string, string][] = [];
    const mm = new Matchmaker<null>(DEFAULT_QUEUE_TIMING, s, {
      status: () => {},
      pair: (a, b) => pairs.push([a.key, b.key]),
    });
    mm.add({
      key: 'hard',
      lane: 'casual',
      pool: 'copper-hollow|hard',
      rating: 1200,
      payload: null,
    });
    mm.add({
      key: 'easy',
      lane: 'casual',
      pool: 'copper-hollow|easy',
      rating: 1200,
      payload: null,
    });
    mm.add({ key: 'none', lane: 'casual', rating: 1200, payload: null });
    s.advance(10);
    expect(pairs).toEqual([]);
    mm.add({
      key: 'hard2',
      lane: 'casual',
      pool: 'copper-hollow|hard',
      rating: 1210,
      payload: null,
    });
    expect(pairs).toEqual([['hard', 'hard2']]);
    mm.add({ key: 'none2', lane: 'casual', rating: 1200, payload: null });
    expect(pairs).toEqual([
      ['hard', 'hard2'],
      ['none', 'none2'],
    ]);
    expect(mm.has('easy')).toBe(true);
  });
});

describe('v2 casual pools', () => {
  it('pairs equal pools, and an any-map search with a picked map at the same difficulty', () => {
    expect(v2PoolsMatch(undefined, undefined)).toBe(true);
    expect(v2PoolsMatch('copper-hollow|hard', 'copper-hollow|hard')).toBe(true);
    expect(v2PoolsMatch('*|hard', 'copper-hollow|hard')).toBe(true);
    expect(v2PoolsMatch('copper-hollow|hard', '*|hard')).toBe(true);
    expect(v2PoolsMatch('*|hard', '*|easy')).toBe(false);
    expect(v2PoolsMatch('copper-hollow|hard', 'sunken-metro|hard')).toBe(false);
    expect(v2PoolsMatch(undefined, '*|normal')).toBe(false);
  });
});
