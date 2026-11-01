import type { Observation } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { distancesFrom, routeHint, turnPrompt } from '../src/v2';

/** A hand-made observation: only the fields route hints read, plus enough for the prompt. */
function obs(rows: string[], me: [number, number], o: Partial<Observation> = {}): Observation {
  const exit = (() => {
    for (let y = 0; y < rows.length; y++) {
      const x = rows[y]!.indexOf('E');
      if (x >= 0) return [x, y] as [number, number];
    }
    return [0, 0] as [number, number];
  })();
  return {
    tick: 1,
    ticksLeft: 149,
    map: { id: 't', name: 'T', w: rows[0]!.length, h: rows.length, goal: 3, item: 'Gem', deliverTo: 'Exit', exit },
    rows,
    me: { id: 'a', name: 'A', team: 'A', role: 'Runner', x: me[0], y: me[1], carrying: 0, capacity: 2, tier: 'standard' },
    teammates: [],
    rivals: [],
    score: { mine: 0, rival: 0 },
    blocksLeft: 0,
    verbs: [],
    heard: [],
    legal: [{ type: 'wait' }, { type: 'move', dir: 'E' }, { type: 'move', dir: 'W' }],
    ...o,
  };
}

describe('v2 route hints', () => {
  it('counts steps around walls to the nearest item and the delivery point, and rubble as 3', () => {
    const rows = ['#######', '#..#*.#', '#..#..#', '#.....#', '#E.d..#', '#######'];
    const o = obs(rows, [1, 1]);
    expect(distancesFrom(o, 1, 1)).toMatchObject({ item: 7, deliver: 3 });
    // Through rubble (d) costs 3: from (5,4) west to E at (1,4) is 2 + 3 + 1 = 6, or 6 around through row 3.
    expect(distancesFrom(o, 5, 4).deliver).toBe(6);
  });

  it('hints each move with the closer target, unseen tiles when no item is known, and nothing for waits', () => {
    const o = obs(['#######', '#.....#', '#E...*#', '#######'], [3, 1]);
    expect(routeHint(o, { type: 'move', dir: 'E' })).toBe(' (item 2)');
    expect(routeHint(o, { type: 'move', dir: 'W' })).toBe(' (item 4)');
    expect(routeHint(o, { type: 'wait' })).toBe('');
    const carrying = obs(['#######', '#.....#', '#E...*#', '#######'], [3, 1], { me: { ...o.me, carrying: 1 } });
    expect(routeHint(carrying, { type: 'move', dir: 'W' })).toBe(' (item 4, deliver 2)');
    const fog = obs(['#######', '#....?#', '#E...?#', '#######'], [3, 1]);
    expect(routeHint(fog, { type: 'move', dir: 'E' })).toBe(' (deliver 4, unseen 1)');
  });

  it('puts the hints, the recent moves and the answer-first format in the turn prompt', () => {
    const o = obs(['#######', '#.....#', '#E...*#', '#######'], [3, 1]);
    const p = turnPrompt(o, null, false, ['move E from 2,1']);
    expect(p).toContain('2. move E (item 2)');
    expect(p).toContain('Your last moves: move E from 2,1.');
    expect(p).toContain('nearest item 3 steps');
    expect(p).toMatch(/Answer at once, no explanation/);
  });
});
