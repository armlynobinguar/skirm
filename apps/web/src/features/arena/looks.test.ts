import { ROLES, STUN_TICKS, carryOf, type V2Frame } from '@skirm/engine/v2';
import { ROLE_LOOKS, lookFor } from '@skirm/ui';
import { describe, expect, it } from 'vitest';
import { v2FrameFixture } from '@/test/fixtures';
import { figurePose } from './figure2d';
import { actsOf, composeV2Arena } from './live';

describe('role looks in the arena', () => {
  it('has a look for every engine role, with its carry cap', () => {
    for (const r of ROLES) {
      expect(ROLE_LOOKS[r], r).toBeDefined();
      expect(lookFor(r).carry, r).toBe(carryOf(r));
    }
  });

  it('carries each agent role onto the board, and keeps a knocked-down agent drawn (not out)', () => {
    const f = v2FrameFixture();
    f.agents[1]!.down = true;
    const a = composeV2Arena(f)!;
    const [wick, moss] = a.state.agents;
    expect(wick!.role).toBe('Builder');
    expect(moss!.role).toBe('Digger');
    expect(moss!.down).toBe(true);
    expect(moss!.out).toBe(false);
  });
});

describe('what each agent did this tick (actsOf)', () => {
  const frame = (tick: number, events: V2Frame['events'], move?: [number, number]) => {
    const f = v2FrameFixture({ tick, events });
    if (move) [f.agents[0]!.x, f.agents[0]!.y] = move;
    return f;
  };

  it('reads verbs, digs, tools and deliveries from the events', () => {
    const acts = actsOf(
      frame(5, [
        { kind: 'verb', agent: 'wick', verb: 'shore', effect: 'add_solid', at: [1, 1] },
        { kind: 'dug', agent: 'moss', at: [3, 1], done: false },
        { kind: 'delivered', agent: 'wick', team: 'A', count: 1, score: 1 },
      ]),
    );
    expect(acts.get('wick')).toEqual({ act: 'add_solid', cheer: true });
    expect(acts.get('moss')).toEqual({ act: 'remove_solid' });
    expect(
      actsOf(frame(5, [{ kind: 'tool_used', agent: 'wick', tool: 'pump', at: [1, 1] }])).get('wick')
        ?.act,
    ).toBe('tool');
  });

  it('keeps a stun for STUN_TICKS frames while the agent stays put, and drops it once it moves', () => {
    const f0 = frame(5, [{ kind: 'stunned', agent: 'wick', by: 'wren' }]);
    const a0 = composeV2Arena(f0)!;
    expect(a0.state.agents[0]!.stun).toBe(true);
    let prev = a0;
    for (let t = 6; t <= 5 + STUN_TICKS; t++) {
      const a = composeV2Arena(frame(t, []), prev)!;
      expect(a.state.agents[0]!.stun, `tick ${t}`).toBe(true);
      prev = a;
    }
    expect(composeV2Arena(frame(6 + STUN_TICKS, []), prev)!.state.agents[0]!.stun).toBeFalsy();
    // Moving ends it early.
    const moved = composeV2Arena(frame(6, [], [2, 2]), a0)!;
    expect(moved.state.agents[0]!.stun).toBeFalsy();
    // A new match (tick back to the start) never inherits one.
    expect(composeV2Arena(frame(1, []), a0)!.state.agents[0]!.stun).toBeFalsy();
  });
});

describe('the 2D figure pose', () => {
  const look = lookFor('Builder');
  it('follows the agent status', () => {
    expect(figurePose({ down: true }, look, 0, { age: 1 }).kind).toBe('down');
    expect(figurePose({ stun: true }, look, 0).kind).toBe('stun');
    expect(figurePose({ act: 'add_solid' }, look, 0).kind).toBe('act');
    expect(figurePose({ inv: [1] }, look, 0, { moving: true, walk: 0.5 }).kind).toBe('walk');
    expect(figurePose({ inv: [1] }, look, 0).kind).toBe('carry');
    expect(figurePose({}, look, 0).kind).toBe('idle');
    // A celebration is over by the time an old frame is drawn.
    expect(figurePose({ cheer: true }, look, 0, { age: 9 }).kind).toBe('idle');
    expect(figurePose({ cheer: true }, look, 0, { age: 0.2 }).kind).toBe('cheer');
  });
});
