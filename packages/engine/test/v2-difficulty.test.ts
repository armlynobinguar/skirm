import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, DIFF_MODS, MAPS_V2, MATCH_GOALS, RANKED_DIFFICULTY, goalFor, isDifficulty } from '../src/v2';

describe('v2 difficulty and goals data', () => {
  it('has five levels in picker order, ranked on Normal', () => {
    expect(DIFFICULTIES).toEqual(['easy', 'normal', 'hard', 'agentic', 'mega']);
    for (const d of DIFFICULTIES) expect(DIFF_MODS[d].key).toBe(d);
    expect(DIFF_MODS[RANKED_DIFFICULTY]).toMatchObject({ hazardScale: 1, capDelta: 0, goalDelta: 0, ticks: 150, fog: false });
    expect(DIFF_MODS.mega).toMatchObject({ ticks: 120, fog: true, night: true, fullRival: true });
    expect(isDifficulty('hard')).toBe(true);
    expect(isDifficulty('brutal')).toBe(false);
  });

  it('gives every official map one goal per level, each needing the win', () => {
    for (const m of MAPS_V2) {
      expect(MATCH_GOALS[m.id]).toHaveLength(5);
      expect(goalFor(m.id, 'easy').check).toBe('win');
    }
    expect(goalFor('copper-hollow', 'normal')).toEqual({ title: 'Shore the tunnels', text: 'Win and dig or shore 3 times on the way.', check: 'verb', n: 3 });
    expect(goalFor('nowhere', 'hard')).toMatchObject({ check: 'win' });
  });
});
