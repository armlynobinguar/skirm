// Greedy against greedy over every v2 map on Easy and Normal, 1v1 and 2v2: the data PRACTICE_MAPS is
// pinned from. A map is clean when all four settings end before tick 150 with nobody eliminated and
// at least one item delivered.
import { DEFAULT_PRACTICE, MAPS_V2, PRACTICE_MAPS, botCrew, mapV2, verifyLog, type Difficulty, type MapDefV2 } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { createGreedyBrain, playHeadless, type HeadlessResult } from '../src/v2';

const greedy = (def: MapDefV2, difficulty: Difficulty, n: 1 | 2) =>
  playHeadless({ def, difficulty, crews: { A: botCrew(n, 'a'), B: botCrew(n, 'b') }, brains: { A: createGreedyBrain(), B: createGreedyBrain() } });

describe('greedy practice sweep', () => {
  it('ends every match, and the clean maps are exactly PRACTICE_MAPS', async () => {
    const clean: string[] = [];
    for (const def of MAPS_V2) {
      const runs: HeadlessResult[] = [];
      for (const difficulty of ['easy', 'normal'] as const) for (const n of [1, 2] as const) runs.push(await greedy(def, difficulty, n));
      for (const r of runs) {
        expect(r.result, def.id).not.toBeNull();
        expect(r.ticks).toBeLessThanOrEqual(150);
      }
      if (runs.every((r) => r.ticks < 150 && r.result.reason !== 'eliminated' && r.score.A + r.score.B > 0)) clean.push(def.id);
    }
    expect(clean).toEqual([...PRACTICE_MAPS]);
    // Every map, now that crews know where items start and see supply drops land.
    expect(clean).toEqual(MAPS_V2.map((m) => m.id));
  }, 60_000);

  it('plays the default practice to a result before tick 90, 1v1 and 2v2, with a valid log', async () => {
    const def = mapV2(DEFAULT_PRACTICE.mapId)!;
    for (const n of [1, 2] as const) {
      const r = await greedy(def, DEFAULT_PRACTICE.difficulty, n);
      expect(r.result.reason).toBe('goal');
      expect(r.ticks).toBeLessThan(90);
      expect(verifyLog(r.log)).toBeNull();
      expect(r.log.result).toEqual(r.result);
    }
  });
});
