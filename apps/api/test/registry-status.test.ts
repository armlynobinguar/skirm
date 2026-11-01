// Registry status as the api shows it (GET /v2/matches/:id).
import { describe, expect, it } from 'vitest';
import { v2MatchView } from '../src/views';

describe('v2 match registry status', () => {
  const row = (over: Record<string, unknown>) =>
    ({
      id: 'mat_1',
      mapId: 'copper-hollow',
      ranked: true,
      practice: false,
      status: 'ended',
      difficulty: null,
      teamAAccountId: 'acc_a',
      teamBAccountId: 'acc_b',
      crews: null,
      winner: 'A',
      reason: 'goal',
      decidedBy: 'goal',
      scoreA: 1,
      scoreB: 0,
      ticks: 90,
      eloDeltas: [],
      stats: null,
      logHash: null,
      debriefs: null,
      registryStatus: 'pending',
      registryTx: null,
      createdAt: new Date(0),
      endedAt: new Date(0),
      ...over,
    }) as never;
  const handles = { A: 'a', B: 'b' };

  it('void matches read none (never recorded); others read the stored state', () => {
    expect(v2MatchView(row({ status: 'void', winner: null }), handles).registry).toEqual({
      status: 'none',
    });
    expect(v2MatchView(row({}), handles).registry).toEqual({ status: 'pending' });
    expect(
      v2MatchView(row({ registryStatus: 'local', registryTx: 'noop:x' }), handles).registry,
    ).toEqual({
      status: 'local',
      txHash: 'noop:x',
    });
    expect(v2MatchView(row({ ranked: false, registryStatus: 'none' }), handles).registry).toEqual({
      status: 'none',
    });
  });
});
