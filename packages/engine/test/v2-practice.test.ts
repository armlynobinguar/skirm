import { describe, expect, it } from 'vitest';
import { BOT_HANDLE, DEFAULT_PRACTICE, MAPS_V2, PRACTICE_MAPS, ROLES, V2_REPLAN_EVERY, botCrew, createMatch, isPracticeMap, mapV2 } from '../src/v2';

describe('v2 practice data', () => {
  it('builds bot crews of 1 to 3 Standard agents with unique ids and one role each', () => {
    for (const size of [1, 2, 3] as const) {
      const crew = botCrew(size, 'bot_m1');
      expect(crew).toHaveLength(size);
      expect(new Set(crew.map((a) => a.id)).size).toBe(size);
      expect(new Set(crew.map((a) => a.role)).size).toBe(size);
      for (const a of crew) {
        expect(a.id.startsWith('bot_m1-')).toBe(true);
        expect(a).toMatchObject({ tier: 'standard', vision: 3, comms: 3 });
        expect(ROLES).toContain(a.role);
      }
    }
    expect(botCrew(3, 'x').map((a) => a.role)).toEqual(ROLES.slice(0, 3));
  });

  it('gives two bot crews with different prefixes ids that never clash in a match', () => {
    const s = createMatch(mapV2(DEFAULT_PRACTICE.mapId)!, { A: botCrew(3, 'a'), B: botCrew(3, 'b') }, { difficulty: DEFAULT_PRACTICE.difficulty });
    expect(s.agents).toHaveLength(6);
    expect(() => createMatch(mapV2('copper-hollow')!, { A: botCrew(1, 'same'), B: botCrew(1, 'same') })).toThrow(/twice/);
  });

  it('lists practice maps that exist, in atlas order, with the default among them', () => {
    const atlas = MAPS_V2.map((m) => m.id);
    for (const id of PRACTICE_MAPS) expect(mapV2(id), id).toBeDefined();
    expect([...PRACTICE_MAPS]).toEqual(atlas.filter((id) => PRACTICE_MAPS.includes(id)));
    expect(new Set(PRACTICE_MAPS).size).toBe(PRACTICE_MAPS.length);
    expect(DEFAULT_PRACTICE).toEqual({ mapId: 'copper-hollow', difficulty: 'easy' });
    expect(isPracticeMap(DEFAULT_PRACTICE.mapId)).toBe(true);
    expect(isPracticeMap('saltmarsh-weir')).toBe(false);
    expect(isPracticeMap('nowhere')).toBe(false);
  });

  it('pins the plan cadence and the bot handle', () => {
    expect(V2_REPLAN_EVERY).toBe(25);
    expect(BOT_HANDLE).toBe('Greedy bot');
  });
});
