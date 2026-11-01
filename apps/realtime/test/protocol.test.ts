import { describe, expect, it } from 'vitest';
import { parseClientMessage } from '../src/protocol';

const ok = (v: unknown) => {
  const r = parseClientMessage(typeof v === 'string' ? v : JSON.stringify(v));
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.msg;
};
const err = (v: unknown) => {
  const r = parseClientMessage(typeof v === 'string' ? v : JSON.stringify(v));
  if (r.ok) throw new Error('expected an error');
  return r.code;
};

describe('parseClientMessage', () => {
  it('accepts sign-in and every v2 message', () => {
    expect(ok({ type: 'auth', devUser: 'alice' })).toEqual({ type: 'auth', devUser: 'alice' });
    expect(ok({ type: 'auth', token: 'jwt.x.y' })).toEqual({ type: 'auth', token: 'jwt.x.y' });
    expect(ok({ type: 'v2_cancel_queue' })).toEqual({ type: 'v2_cancel_queue' });
    for (const type of ['v2_accept', 'v2_decline', 'v2_watch', 'v2_unwatch', 'v2_replay'])
      expect(ok({ type, matchId: 'mat_1' })).toEqual({ type, matchId: 'mat_1' });
    expect(
      ok({
        type: 'v2_queue',
        ranked: true,
        crew: [
          { agentId: 'agt_1', tier: 'quiet' },
          { agentId: 'agt_2', tier: 'standard' },
          { agentId: 'agt_3', tier: 'open' },
        ],
      }),
    ).toMatchObject({ type: 'v2_queue', ranked: true, crew: [{ tier: 'quiet' }, { tier: 'standard' }, { tier: 'open' }] });
  });

  it('rejects malformed input with a code', () => {
    const crew = [{ agentId: 'agt_1', tier: 'standard' }];
    expect(err('not json')).toBe('bad_json');
    expect(err('[1,2]')).toBe('bad_message');
    expect(err({ kind: 'auth' })).toBe('bad_message');
    expect(err({ type: 'hello' })).toBe('unknown_type');
    expect(err({ type: 'auth' })).toBe('bad_message');
    expect(err({ type: 'auth', devUser: 5 })).toBe('bad_message');
    expect(err({ type: 'auth', devUser: 'a', extra: 1 })).toBe('bad_message');
    expect(err({ type: 'v2_watch' })).toBe('bad_message');
    expect(err({ type: 'v2_watch', matchId: '../../etc' })).toBe('bad_message');
    expect(err({ type: 'v2_watch', matchId: 'x'.repeat(65) })).toBe('bad_message');
    expect(err({ type: 'v2_watch', matchId: 7 })).toBe('bad_message');
    expect(err({ type: 'v2_unwatch', matchId: 'mat_1', x: 1 })).toBe('bad_message');
    expect(err({ type: 'v2_cancel_queue', now: true })).toBe('bad_message');
    expect(err({ type: 'v2_queue', ranked: 'paid', crew })).toBe('bad_message');
    expect(err({ type: 'v2_queue', ranked: true, crew: [] })).toBe('bad_message');
    expect(err({ type: 'v2_queue', ranked: true, crew: [{}] })).toBe('bad_message');
    expect(err({ type: 'v2_queue', ranked: true, crew: [{ agentId: 'a1', tier: 'loud' }] })).toBe('bad_message');
    expect(err({ type: 'v2_queue', ranked: true, crew: [{ agentId: 'a1', tier: 'open', unlocks: [] }] })).toBe('bad_message');
    expect(err({ type: 'v2_queue', ranked: true, crew: [1, 2, 3, 4].map((i) => ({ agentId: `a${i}`, tier: 'open' })) })).toBe('bad_message');
    expect(err({ type: 'v2_queue', ranked: true, crew: [crew[0], crew[0]] })).toBe('bad_message');
    expect(err({ type: 'v2_lock_in', matchId: 'mat_1', tiers: ['quiet', 'quiet', 'quiet', 'quiet'] })).toBe('bad_message');
    expect(err(JSON.stringify({ type: 'auth', devUser: 'a', pad: 'x'.repeat(20_000) }))).toBe('too_large');
    expect(parseClientMessage(null)).toMatchObject({ ok: false, code: 'bad_message' });
  });

  it('accepts the v2 casual pick, lock-in crew changes and replay requests', () => {
    const crew = [{ agentId: 'agt_1', tier: 'open' }];
    expect(
      ok({ type: 'v2_queue', crew, ranked: false, mapId: 'copper-hollow', difficulty: 'hard' }),
    ).toEqual({
      type: 'v2_queue',
      crew,
      ranked: false,
      mapId: 'copper-hollow',
      difficulty: 'hard',
    });
    expect(ok({ type: 'v2_queue', crew, ranked: true })).toEqual({
      type: 'v2_queue',
      crew,
      ranked: true,
    });
    expect(err({ type: 'v2_queue', crew, ranked: false, difficulty: 'brutal' })).toBe(
      'bad_message',
    );
    expect(err({ type: 'v2_queue', crew, ranked: false, mapId: '../maps' })).toBe('bad_message');
    // Practice against the bot: casual only.
    expect(ok({ type: 'v2_queue', crew, ranked: false, opponent: 'bot' })).toEqual({
      type: 'v2_queue',
      crew,
      ranked: false,
      opponent: 'bot',
    });
    expect(err({ type: 'v2_queue', crew, ranked: true, opponent: 'bot' })).toBe('practice_unranked');
    expect(err({ type: 'v2_queue', crew, ranked: false, opponent: 'human' })).toBe('bad_message');
    expect(
      ok({
        type: 'v2_lock_in',
        matchId: 'mat_1',
        tiers: ['quiet'],
        crew: [{ agentId: 'agt_2', tier: 'quiet' }],
      }),
    ).toEqual({
      type: 'v2_lock_in',
      matchId: 'mat_1',
      tiers: ['quiet'],
      crew: [{ agentId: 'agt_2', tier: 'quiet' }],
    });
    expect(ok({ type: 'v2_lock_in', matchId: 'mat_1', tiers: [] })).toEqual({
      type: 'v2_lock_in',
      matchId: 'mat_1',
      tiers: [],
    });
    expect(err({ type: 'v2_lock_in', matchId: 'mat_1', tiers: [], crew: [] })).toBe('bad_message');
    expect(err({ type: 'v2_lock_in', matchId: 'mat_1', tiers: [], crew: [crew[0], crew[0]] })).toBe(
      'bad_message',
    );
    expect(ok({ type: 'v2_replay', matchId: 'mat_1' })).toEqual({
      type: 'v2_replay',
      matchId: 'mat_1',
    });
    expect(err({ type: 'v2_replay', matchId: 'mat_1', speed: 2 })).toBe('bad_message');
  });

  it('accepts Buffer frames as ws delivers them', () => {
    expect(parseClientMessage(Buffer.from('{"type":"v2_cancel_queue"}'))).toEqual({
      ok: true,
      msg: { type: 'v2_cancel_queue' },
    });
  });
});
