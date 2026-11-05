// Hybrid control in the engine: a player's steer input turned into a legal action on the agent's
// own observation, and when a standing order is done.
import { describe, expect, it } from 'vitest';
import { parseSteerInput, steerAction, type Action, type Observation } from '../src/v2';

/** A 7x5 room: the agent at (1,2), an item at (4,1), the delivery point at (5,3), a wall at (3,2). */
function obs(o: Partial<Observation['me']> = {}, legal?: Action[]): Observation {
  const me = { id: 'a', name: 'A', team: 'A' as const, role: 'Builder' as const, x: 1, y: 2, carrying: 0, capacity: 2, tier: 'standard' as const, ...o };
  return {
    tick: 1,
    ticksLeft: 50,
    map: { id: 'm', name: 'M', w: 7, h: 5, goal: 2, item: 'Item', deliverTo: 'Exit', exit: [5, 3] },
    rows: ['#######', '#...*.#', '#..#..#', '#....E#', '#######'],
    me,
    teammates: [],
    rivals: [],
    score: { mine: 0, rival: 0 },
    blocksLeft: 2,
    verbs: [{ id: 'build', name: 'Build', effect: 'add_solid' }],
    heard: [],
    legal: legal ?? [{ type: 'wait' }, { type: 'move', dir: 'N' }, { type: 'move', dir: 'E' }, { type: 'move', dir: 'S' }, { type: 'verb', verb: 'build', dir: 'E' }],
  };
}

describe('steer input', () => {
  it('plays one-tick inputs once, and a wait for anything not legal', () => {
    expect(steerAction(obs(), { kind: 'move', dir: 'E' })).toEqual({ action: { type: 'move', dir: 'E' }, done: true });
    expect(steerAction(obs(), { kind: 'move', dir: 'W' })).toEqual({ action: { type: 'wait' }, done: true });
    expect(steerAction(obs(), { kind: 'wait' })).toEqual({ action: { type: 'wait' }, done: true });
    expect(steerAction(obs(), { kind: 'use', dir: 'E' })).toEqual({ action: { type: 'verb', verb: 'build', dir: 'E' }, done: true });
    expect(steerAction(obs(), { kind: 'use' }).action).toEqual({ type: 'verb', verb: 'build', dir: 'E' });
    expect(steerAction(obs({}, [{ type: 'wait' }, { type: 'switch' }]), { kind: 'use' }).action).toEqual({ type: 'switch' });
    expect(steerAction(obs({}, [{ type: 'wait' }]), { kind: 'use', dir: 'N' }).action).toEqual({ type: 'wait' });
  });

  it('walks standing orders until they are done', () => {
    // Take: toward the item; done when full.
    expect(steerAction(obs(), { kind: 'take' })).toEqual({ action: { type: 'move', dir: expect.stringMatching(/^[NE]$/) }, done: false });
    expect(steerAction(obs({ carrying: 2 }), { kind: 'take' })).toEqual({ action: { type: 'wait' }, done: true });
    // Deliver: toward the delivery point; done with empty hands.
    expect(steerAction(obs({ carrying: 1 }), { kind: 'deliver' })).toEqual({ action: { type: 'move', dir: expect.stringMatching(/^[ES]$/) }, done: false });
    expect(steerAction(obs(), { kind: 'deliver' })).toEqual({ action: { type: 'wait' }, done: true });
    // Goto: to the tile; next to it when it is solid; done on arrival.
    expect(steerAction(obs(), { kind: 'goto', to: [1, 3] })).toEqual({ action: { type: 'move', dir: 'S' }, done: false });
    expect(steerAction(obs(), { kind: 'goto', to: [1, 2] })).toEqual({ action: { type: 'wait' }, done: true });
    expect(steerAction(obs({ x: 2 }), { kind: 'goto', to: [3, 2] })).toEqual({ action: { type: 'wait' }, done: true });
    expect(steerAction(obs(), { kind: 'goto', to: [3, 2] }).done).toBe(false);
    // Out of reach: done at once.
    expect(steerAction(obs(), { kind: 'goto', to: [0, 0] })).toEqual({ action: { type: 'wait' }, done: true });
  });

  it('checks inputs as a client sends them', () => {
    expect(parseSteerInput({ kind: 'goto', to: [2, 3] })).toEqual({ kind: 'goto', to: [2, 3] });
    expect(parseSteerInput({ kind: 'use', dir: null })).toEqual({ kind: 'use' });
    expect(typeof parseSteerInput({ kind: 'move', dir: 'X' })).toBe('string');
    expect(typeof parseSteerInput({ kind: 'stop', extra: 1 })).toBe('string');
    expect(typeof parseSteerInput(null)).toBe('string');
  });
});
