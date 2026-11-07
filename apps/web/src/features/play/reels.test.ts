import { describe, expect, it } from 'vitest';
import { PREROLL_TICKS, REEL_COUNT, REEL_TICKS, captionsOf, reelMaps, startReel, stepReel } from './reels';

describe('showreel matches', () => {
  it('picks REEL_COUNT different maps, changing with the day', () => {
    const a = reelMaps(100);
    expect(a).toHaveLength(REEL_COUNT);
    expect(new Set(a.map((m) => m.id)).size).toBe(REEL_COUNT);
    expect(reelMaps(101)[0]!.id).not.toBe(a[0]!.id);
  });

  it('opens a few ticks in and cuts after REEL_TICKS or at the result', () => {
    for (const def of reelMaps(7)) {
      const r = startReel(def);
      expect(r.s.tick).toBe(PREROLL_TICKS);
      expect(r.frame.mapId).toBe(def.id);
      let n = 0;
      while (!r.done) {
        stepReel(r);
        n++;
      }
      expect(n).toBeLessThanOrEqual(REEL_TICKS);
      expect(stepReel(r)).toEqual([]);
    }
  });

  it('captions deliveries with the crew and its score', () => {
    const r = startReel(reelMaps(0)[0]!);
    const caps = captionsOf(r, [{ kind: 'delivered', agent: r.s.agents[0]!.id, team: 'A', count: 2, score: 3 }]);
    expect(caps).toEqual([{ team: 'A', text: `Vex delivers 2 · Ember crew 3/${r.goal}` }]);
  });
});
