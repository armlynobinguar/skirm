import { describe, expect, it } from 'vitest';
import { lookFor, poseAt } from './looks';

describe('reactions over the base pose (social)', () => {
  const look = lookFor('Builder');
  const at = (kind: Parameters<typeof poseAt>[0], social: Parameters<typeof poseAt>[2]['social'], still = false) =>
    poseAt(kind, look, { time: 1.3, age: 0.4, walk: 0.5, still, social });

  it('gestures while talking and nods while listening, keeping the legs of the walk', () => {
    const talk = at('walk', { talk: true });
    expect(talk.off.hand![2]).toBeGreaterThan(0);
    expect(talk.off.footL).toEqual(at('walk', null).off.footL);
    expect(at('idle', { listen: true }).off.head![1]).toBeLessThanOrEqual(0);
  });

  it('pumps a fist, squares up, points and thinks; never over a fall, a stun or a verb', () => {
    expect(at('idle', { hype: true }).off.hand![1]).toBeGreaterThan(0.18);
    expect(at('idle', { square: true }).lean).toBeGreaterThan(0.1);
    expect(at('walk', { point: true }).off.hand).toEqual([0, 0.16, 0.16]);
    expect(at('idle', { think: true }).off.hand).toEqual([0, 0.24, 0.07]);
    for (const kind of ['down', 'stun', 'act', 'out'] as const) expect(at(kind, { hype: true })).toEqual(at(kind, null));
  });

  it('keeps reduced motion still: no idle habit, a fixed reaction frame', () => {
    expect(poseAt('idle', lookFor('Runner'), { time: 2, age: 9, still: true })).toMatchObject({ lift: 0, lean: 0 });
    expect(at('idle', { bump: true }, true).lean).toBeCloseTo(-0.12);
  });
});

describe('idle habits by role', () => {
  it('the dasher bounces, the digger leans on its tool, the builder taps now and then', () => {
    const lifts = [0.1, 0.3, 0.5].map((t) => poseAt('idle', lookFor('Runner'), { time: t, age: 9 }).lift);
    expect(Math.max(...lifts)).toBeGreaterThan(0.01);
    expect(poseAt('idle', lookFor('Digger'), { time: 1, age: 9 }).lean).toBeCloseTo(0.08);
    const taps = [0.1, 0.2, 0.3].map((t) => poseAt('idle', lookFor('Builder'), { time: t, age: 9, seed: 0 }).off.hand![1]);
    expect(Math.max(...taps)).toBeGreaterThan(0.05);
  });
});
