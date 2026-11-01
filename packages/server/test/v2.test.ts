import { describe, expect, expectTypeOf, it } from 'vitest';
import { V2_OPPONENTS, isV2Opponent, type V2ClientMessage, type V2ServerMessage } from '../src/index';

describe('v2 protocol', () => {
  it('knows the practice opponent', () => {
    expect(V2_OPPONENTS).toEqual(['bot']);
    expect(isV2Opponent('bot')).toBe(true);
    for (const v of ['human', '', null, undefined, 1, {}]) expect(isV2Opponent(v)).toBe(false);
  });

  it('carries practice and free on the queue, found and lock-in messages', () => {
    type Queue = Extract<V2ClientMessage, { type: 'v2_queue' }>;
    type Found = Extract<V2ServerMessage, { type: 'v2_found' }>;
    type LockIn = Extract<V2ServerMessage, { type: 'v2_lockin' }>;
    expectTypeOf<Queue['opponent']>().toEqualTypeOf<'bot' | undefined>();
    expectTypeOf<Found['practice']>().toEqualTypeOf<true | undefined>();
    expectTypeOf<Found['free']>().toEqualTypeOf<true | undefined>();
    expectTypeOf<Found['rivalHandle']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<LockIn['free']>().toEqualTypeOf<true | undefined>();
    const found: Found = { type: 'v2_found', matchId: 'mat_1', team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 10_000, practice: true, free: true, rivalHandle: 'Greedy bot' };
    expect(found.rivalHandle).toBe('Greedy bot');
  });
});
