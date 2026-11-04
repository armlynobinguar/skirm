import { describe, expect, it } from 'vitest';
import { skillActivity, skillTriggerHolds, type Observation, type SeenAgent } from '../src/v2';

const rival = (x: number, y: number, down = false): SeenAgent => ({ id: 'r', name: 'R', team: 'B', role: 'Scout', x, y, carrying: 0, down });

/** A 7x5 board seen by an agent at 1,2; '?' is fog. */
function obs(over: Partial<Observation> = {}, me: Partial<Observation['me']> = {}): Observation {
  return {
    tick: 1,
    ticksLeft: 150,
    map: { id: 'm', name: 'M', w: 7, h: 5, goal: 3, item: 'Ore', deliverTo: 'Exit', exit: [6, 2] },
    rows: ['#######', '#.....#', '#....^#', '#..?V.#', '#######'],
    me: { id: 'a', name: 'A', team: 'A', role: 'Scout', x: 1, y: 2, carrying: 0, capacity: 2, tier: 'standard', ...me },
    teammates: [],
    rivals: [],
    score: { mine: 0, rival: 0 },
    blocksLeft: 0,
    verbs: [],
    heard: [],
    legal: [{ type: 'wait' }],
    ...over,
  };
}

describe('skill triggers on an observation', () => {
  it('always and null always hold', () => {
    expect(skillTriggerHolds(null, obs())).toBe(true);
    expect(skillTriggerHolds({ kind: 'always' }, obs())).toBe(true);
  });

  it('hazard_within counts grid steps to a seen hazard', () => {
    // The fire at 5,2 is 4 steps from 1,2.
    expect(skillTriggerHolds({ kind: 'hazard_within', tiles: 3 }, obs())).toBe(false);
    expect(skillTriggerHolds({ kind: 'hazard_within', tiles: 4 }, obs())).toBe(true);
    // Diagonal tiles count by steps, not by a square.
    expect(skillTriggerHolds({ kind: 'hazard_within', tiles: 4 }, obs({}, { x: 2, y: 1 }))).toBe(true);
    expect(skillTriggerHolds({ kind: 'hazard_within', tiles: 3 }, obs({}, { x: 2, y: 1 }))).toBe(false);
  });

  it('hazard_within ignores tiles under fog', () => {
    const fogged = obs({ rows: ['#######', '#.....#', '#....?#', '#..?V.#', '#######'] });
    expect(skillTriggerHolds({ kind: 'hazard_within', tiles: 10 }, fogged)).toBe(false);
  });

  it('score triggers compare own and rival score', () => {
    expect(skillTriggerHolds({ kind: 'behind_on_score' }, obs({ score: { mine: 1, rival: 2 } }))).toBe(true);
    expect(skillTriggerHolds({ kind: 'ahead_on_score' }, obs({ score: { mine: 1, rival: 2 } }))).toBe(false);
    expect(skillTriggerHolds({ kind: 'ahead_on_score' }, obs({ score: { mine: 3, rival: 2 } }))).toBe(true);
    expect(skillTriggerHolds({ kind: 'behind_on_score' }, obs())).toBe(false);
    expect(skillTriggerHolds({ kind: 'ahead_on_score' }, obs())).toBe(false);
  });

  it('rival_near_switch needs a rival in sight, up, near a seen switch', () => {
    const t = { kind: 'rival_near_switch', tiles: 2 } as const;
    expect(skillTriggerHolds(t, obs())).toBe(false);
    expect(skillTriggerHolds(t, obs({ rivals: [rival(4, 1)] }))).toBe(true);
    expect(skillTriggerHolds(t, obs({ rivals: [rival(1, 1)] }))).toBe(false);
    expect(skillTriggerHolds(t, obs({ rivals: [rival(4, 1, true)] }))).toBe(false);
  });

  it('carrying_item and time_left_under read the agent and the clock', () => {
    expect(skillTriggerHolds({ kind: 'carrying_item' }, obs())).toBe(false);
    expect(skillTriggerHolds({ kind: 'carrying_item' }, obs({}, { carrying: 1 }))).toBe(true);
    // 2 s ticks: 29 ticks left is 58 s.
    expect(skillTriggerHolds({ kind: 'time_left_under', seconds: 60 }, obs({ ticksLeft: 29 }))).toBe(true);
    expect(skillTriggerHolds({ kind: 'time_left_under', seconds: 60 }, obs({ ticksLeft: 30 }))).toBe(false);
  });

  it('skillActivity judges each skill in order', () => {
    expect(skillActivity([null, { kind: 'carrying_item' }, { kind: 'hazard_within', tiles: 4 }], obs())).toEqual([true, false, true]);
  });
});
