import { describe, expect, it } from 'vitest';
import { intentsOf } from './live';

const ag = (id: string, team: 'A' | 'B', x: number, y: number, o: Record<string, unknown> = {}) =>
  ({ id, name: id, team, x, y, role: 'Builder', out: false, down: false, items: [], ...o }) as never;
const prevAt = (pos: Record<string, [number, number]>) =>
  ({ state: { grid: [], agents: Object.entries(pos).map(([id, [x, y]]) => ({ id, x, y })) } }) as never;
// Item at (7,1), switch at (2,3), exit (passed in) at (7,3); column 4 row 2 unseen.
const rows = ['#########', '#......*#', '#...?...#', '#.V.....#', '#########'];
const EXIT: [number, number] = [7, 3];
const frame = (agents: never[], events: unknown[] = []) => ({ rows, agents, events }) as never;

describe('what each agent is going for (intentsOf)', () => {
  it('carrying and a step closer to the exit: the exit', () => {
    const s = intentsOf(frame([ag('a1', 'A', 6, 3, { items: ['jug'] })]), prevAt({ a1: [5, 3] }), EXIT);
    expect(s.get('a1')).toEqual({ kind: 'exit', goal: [7, 3] });
  });

  it('not carrying, a step closer to the nearest visible item: the item', () => {
    const s = intentsOf(frame([ag('a1', 'A', 6, 1)]), prevAt({ a1: [5, 1] }), EXIT);
    expect(s.get('a1')).toEqual({ kind: 'item', goal: [7, 1] });
  });

  it('carrying but walking away from the exit falls back to the nearest item', () => {
    const s = intentsOf(frame([ag('a1', 'A', 6, 1, { items: ['jug'] })]), prevAt({ a1: [6, 2] }), EXIT);
    expect(s.get('a1')).toEqual({ kind: 'item', goal: [7, 1] });
  });

  it('a step closer to a nearby switch that is nearer than any item: the switch', () => {
    const s = intentsOf(frame([ag('a1', 'A', 2, 2)]), prevAt({ a1: [2, 1] }), EXIT);
    expect(s.get('a1')).toEqual({ kind: 'switch', goal: [2, 3] });
  });

  it('pulling a switch next to it this tick: the switch, even standing still', () => {
    const s = intentsOf(frame([ag('a1', 'A', 1, 3)], [{ kind: 'switch', agent: 'a1', name: 'weir', floods: 'B', until: 9 }]), prevAt({ a1: [1, 3] }), EXIT);
    expect(s.get('a1')).toEqual({ kind: 'switch', goal: [2, 3] });
  });

  it('no step, a teleport, no prior frame, walking away from everything, or down: no intent', () => {
    const agents = [ag('still', 'A', 3, 1), ag('tp', 'A', 6, 1), ag('fresh', 'A', 6, 1), ag('away', 'A', 1, 1), ag('down', 'A', 6, 1, { down: true })];
    const s = intentsOf(frame(agents), prevAt({ still: [3, 1], tp: [1, 1], away: [2, 1], down: [5, 1] }), EXIT);
    expect(s.size).toBe(0);
  });

  it('unseen items do not count, and rivals follow the same rule from what this crew sees', () => {
    const blind = ['#########', '#......?#', '#.......#', '#.......#', '#########'];
    const s = intentsOf({ rows: blind, agents: [ag('b1', 'B', 6, 1)], events: [] } as never, prevAt({ b1: [5, 1] }), EXIT);
    expect(s.get('b1')).toBeUndefined();
    const seen = intentsOf(frame([ag('b1', 'B', 6, 1)]), prevAt({ b1: [5, 1] }), EXIT);
    expect(seen.get('b1')).toEqual({ kind: 'item', goal: [7, 1] });
  });
});
