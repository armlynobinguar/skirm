import { describe, expect, it } from 'vitest';
import { BOT_HANDLE, DEFAULT_PRACTICE, DIFFICULTIES, MAPS_V2, PRACTICE_MAPS, ROLES, V2_REPLAN_EVERY, botCrew, createMatch, isPracticeMap, legalActions, mapV2, practiceRival, stepMatch } from '../src/v2';

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
    // Every map plays cleanly greedy against greedy.
    expect([...PRACTICE_MAPS]).toEqual(atlas);
    expect(isPracticeMap('nowhere')).toBe(false);
  });

  it('gives bot crews the tier asked for', () => {
    expect(botCrew(2, 'b', 'open').map((a) => a.tier)).toEqual(['open', 'open']);
  });

  it('shapes the bot by difficulty: Easy waits 12 s on Quiet, Agentic talks Open, Mega fields a full crew', () => {
    expect(practiceRival('easy', 1, 3)).toEqual({ size: 1, tier: 'quiet', hold: 6, lieCap: 1 });
    expect(practiceRival('normal', 2, 3)).toEqual({ size: 2, tier: 'standard', hold: 0, lieCap: 3 });
    expect(practiceRival('hard', 1, 3)).toEqual({ size: 1, tier: 'standard', hold: 0, lieCap: 4 });
    expect(practiceRival('agentic', 2, 3)).toEqual({ size: 2, tier: 'open', hold: 0, lieCap: 6 });
    expect(practiceRival('mega', 1, 3)).toEqual({ size: 3, tier: 'open', hold: 0, lieCap: 9 });
    // Never more than the map takes, and never fewer than the player.
    expect(practiceRival('mega', 1, 2).size).toBe(2);
    expect(practiceRival('mega', 2, 1).size).toBe(2);
    for (const d of DIFFICULTIES) expect(practiceRival(d, 3, 3).size).toBe(3);
  });

  it('holds a crew for the extra ticks on top of the head start', () => {
    const map = mapV2('copper-hollow')!;
    // Mega: the bot fields 3 against 1, so the player gets 10 ticks; Easy's wait adds to the bot's own.
    const mega = createMatch(map, { A: botCrew(1, 'p'), B: botCrew(3, 'b') }, { difficulty: 'mega' });
    expect(mega.holdTicks).toEqual({ A: 0, B: 10 });
    const easy = createMatch(map, { A: botCrew(1, 'p'), B: botCrew(1, 'b') }, { difficulty: 'easy', hold: { B: 6 } });
    expect(easy.holdTicks).toEqual({ A: 0, B: 6 });
    const both = createMatch(map, { A: botCrew(2, 'p'), B: botCrew(1, 'b') }, { hold: { B: 6 } });
    expect(both.holdTicks).toEqual({ A: 5, B: 6 });
    // The held crew stands still for its ticks, then moves.
    const bot = easy.agents.find((a) => a.team === 'B')!;
    for (let t = 0; t < 6; t++) {
      expect(legalActions(easy, bot.id)).toEqual([{ type: 'wait' }]);
      stepMatch(easy, { actions: {} });
    }
    expect(legalActions(easy, bot.id).length).toBeGreaterThan(1);
  });

  it('pins the plan cadence and the bot handle', () => {
    expect(V2_REPLAN_EVERY).toBe(25);
    expect(BOT_HANDLE).toBe('Greedy bot');
  });
});
