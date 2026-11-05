import { appendTick, logHash, startLog, type LogHeader } from '@skirm/engine/v2';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { publicLog } from '../src/controllers/public.controller';
import { setup, type Harness, type UserClient } from './helpers';

const SECRET = 'SECRET-ORDER-12: rush the left sluice';

const header: LogHeader = {
  schema: 'skirm.match/v2',
  map: 'copper-hollow',
  crews: {
    A: [{ id: 'rook', name: 'Rook', role: 'Builder', vision: 3, comms: 3, tier: 'standard' }],
    B: [{ id: 'wren', name: 'Wren', role: 'Digger', vision: 3, comms: 3, tier: 'standard' }],
  },
  ranked: false,
  models: { planner: 'greedy', actor: 'greedy', speech: 'greedy' },
};

function matchLog() {
  const log = startLog(header);
  appendTick(log, { tick: 1, actions: { rook: { type: 'wait' }, wren: { type: 'wait' } }, says: [] });
  appendTick(log, {
    tick: 2,
    actions: { rook: { type: 'wait' }, wren: { type: 'wait' } },
    says: [],
    commands: [{ team: 'A', agents: ['rook'], preset: null, text: SECRET }],
  });
  log.result = { winner: 'B', reason: 'time', decidedBy: 'score', score: { A: 0, B: 1 }, ticks: 2 };
  return log;
}

describe('GET /v2/matches/:id/log', () => {
  let h: Harness;
  let ana: UserClient;
  let ben: UserClient;
  beforeEach(async () => {
    h = await setup();
    ana = await h.as('ana');
    ben = await h.as('ben');
  });
  afterEach(() => h.close());

  it('serves an ended match log to anyone, without live commands', async () => {
    const log = matchLog();
    const m = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.accountId, teamB: ben.accountId });
    await h.repos.v2Matches.finish(m.id, { winner: 'B', reason: 'time', decidedBy: 'score', score: { A: 0, B: 1 }, ticks: 2, log, logHash: logHash(log) });
    const res = await h.http().get(`/v2/matches/${m.id}/log`).expect(200);
    expect(res.body.matchId).toBe(m.id);
    expect(res.body.logHash).toBe(logHash(log));
    expect(res.body.log.header).toEqual(header);
    expect(res.body.log.hashes).toEqual(log.hashes);
    expect(res.body.log.ticks[0]).not.toHaveProperty('redacted');
    expect(res.body.log.ticks[1]).toMatchObject({ tick: 2, redacted: true });
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
  });

  it('409 while live, 404 without a log', async () => {
    const live = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.accountId, teamB: ben.accountId });
    await h.http().get(`/v2/matches/${live.id}/log`).expect(409);
    await h.repos.v2Matches.finish(live.id, { winner: null, reason: 'declined', fault: 'B' });
    await h.http().get(`/v2/matches/${live.id}/log`).expect(404);
  });

  it('publicLog keeps ticks without commands untouched', () => {
    const log = matchLog();
    const out = publicLog(log)!;
    expect(out.ticks[0]).toBe(log.ticks[0]);
    expect(out.ticks[1]).toEqual({ tick: 2, actions: log.ticks[1]!.actions, says: [], redacted: true });
    expect(publicLog(null)).toBeNull();
    expect(publicLog({ ticks: [] })).toBeNull();
  });
});
