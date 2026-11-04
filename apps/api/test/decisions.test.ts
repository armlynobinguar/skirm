// GET /v2/matches/:id/decisions: the debrief's decision timeline. Players only, each their own crew
// (practice adds the bot's), 409 while live; skills by id with the model's or the inferred pick; skill
// text only for the skill's creator, never another player's.
import type { MatchTimelineInput } from '@skirm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SAMPLE_SKILL, setup, type Harness, type UserClient } from './helpers';

let h: Harness;
let ana: UserClient;
let ben: UserClient;
let cara: UserClient;
let anaSkill: { id: string; version: number };
let benSkill: { id: string; version: number };

const BEN_PROMPT = 'BEN-SECRET-44d1: dig the right wall when the water turns.';

beforeAll(async () => {
  h = await setup();
  ana = await h.as('decana');
  ben = await h.as('decben');
  cara = await h.as('deccara');
  const a = await ana.post('/skills', SAMPLE_SKILL);
  expect(a.status).toBe(201);
  anaSkill = { id: a.body.id, version: a.body.version };
  const b = await ben.post('/skills', { ...SAMPLE_SKILL, name: 'Wall Digger', prompt: BEN_PROMPT, reflexes: undefined, requires_actions: ['dig'] });
  expect(b.status).toBe(201);
  benSkill = { id: b.body.id, version: b.body.version };
});
afterAll(() => h.close());

function crews() {
  return {
    A: [{ id: 'agt_w', name: 'Wick', role: 'Builder', vision: 3, comms: 3, tier: 'standard', skills: [anaSkill] }],
    B: [{ id: 'agt_r', name: 'Wren', role: 'Digger', vision: 3, comms: 3, tier: 'standard', skills: [benSkill] }],
  };
}

function timelines(brainB = 'model'): MatchTimelineInput[] {
  return [
    {
      team: 'A',
      brain: 'model',
      plans: [{ tick: 1, text: 'Wick dams the left gap.', why: 'Water comes from the left.' }],
      decisions: [
        { tick: 1, agentId: 'agt_w', observed: 'At 1,1 carrying 0/2.', action: 'move E', reason: 'chosen', skill: anaSkill, thought: 'Gap first.' },
        { tick: 2, agentId: 'agt_w', observed: 'At 2,1 carrying 0/2.', action: 'verb dam E', reason: 'chosen', effect: 'add_solid', outcome: ['used dam'] },
        { tick: 3, agentId: 'agt_w', observed: 'At 2,1 carrying 0/2.', action: 'wait', reason: 'timeout' },
      ],
      moments: [{ tick: 2, kind: 'hazard_breach', team: 'A', agentId: 'agt_w', text: 'water reached Wick' }],
    },
    {
      team: 'B',
      brain: brainB,
      plans: [{ tick: 1, text: 'Wren digs right.', why: null }],
      decisions: [{ tick: 1, agentId: 'agt_r', observed: 'At 9,1 carrying 0/2.', action: 'move W', reason: 'chosen', effect: 'remove_solid' }],
      moments: [],
    },
  ];
}

async function ended(practice = false, brainB = 'model') {
  const m = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, practice, teamA: ana.accountId, teamB: ben.accountId, crews: crews() });
  await h.repos.v2Matches.finish(m.id, { winner: 'A', reason: 'goal', ticks: 3, score: { A: 3, B: 1 } });
  await h.repos.matchTimelines.put(m.id, timelines(brainB));
  return m.id;
}

describe('GET /v2/matches/:id/decisions', () => {
  it('needs a session, a player of the match and an ended match', async () => {
    const m = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.accountId, teamB: ben.accountId, crews: crews() });
    expect((await h.http().get(`/v2/matches/${m.id}/decisions`)).status).toBe(401);
    expect((await ana.get('/v2/matches/mat_01JB7Z3K9QX4M2T8V6N5R1C0DF/decisions')).status).toBe(404);
    const live = await ana.get(`/v2/matches/${m.id}/decisions`);
    expect(live.status).toBe(409);
    expect(live.body.error.code).toBe('match_live');
    await h.repos.v2Matches.finish(m.id, { winner: 'A', reason: 'goal' });
    const other = await cara.get(`/v2/matches/${m.id}/decisions`);
    expect(other.status).toBe(403);
    // Ended without a stored timeline: no crews, not an error.
    expect((await ana.get(`/v2/matches/${m.id}/decisions`)).body).toMatchObject({ you: 'A', crews: [] });
  });

  it("gives each player their own crew only, with skills by id and only their own skill's text", async () => {
    const id = await ended();
    const a = await ana.get(`/v2/matches/${id}/decisions`);
    expect(a.status).toBe(200);
    expect(a.body.you).toBe('A');
    expect(a.body.crews.map((c: { team: string }) => c.team)).toEqual(['A']);
    const crew = a.body.crews[0];
    expect(crew).toMatchObject({ own: true, brain: 'model', agents: [{ id: 'agt_w', name: 'Wick', role: 'Builder', skills: [anaSkill] }] });
    expect(crew.plans[0]).toEqual({ tick: 1, text: 'Wick dams the left gap.', why: 'Water comes from the left.' });
    expect(crew.decisions.map((d: { skill: unknown }) => d.skill)).toEqual([{ ...anaSkill, by: 'model' }, { ...anaSkill, by: 'inferred' }, null]);
    expect(crew.moments).toEqual([{ tick: 2, kind: 'hazard_breach', team: 'A', agentId: 'agt_w', text: 'water reached Wick' }]);
    expect(a.body.skills).toEqual([{ ...anaSkill, name: 'Gap Sealer', mine: true, prompt: SAMPLE_SKILL.prompt }]);
    const raw = JSON.stringify(a.body);
    expect(raw).not.toContain('BEN-SECRET');
    expect(raw).not.toContain('Wren digs right.');

    const b = await ben.get(`/v2/matches/${id}/decisions`);
    expect(b.body.you).toBe('B');
    expect(b.body.crews.map((c: { team: string }) => c.team)).toEqual(['B']);
    // The dig matches Wall Digger, the only equipped skill that needs one.
    expect(b.body.crews[0].decisions[0].skill).toEqual({ ...benSkill, by: 'inferred' });
    expect(b.body.skills).toEqual([{ ...benSkill, name: 'Wall Digger', mine: true, prompt: BEN_PROMPT }]);
    expect(JSON.stringify(b.body)).not.toContain('SECRET-PROMPT-7f3a');
  });

  it('practice adds the bot crew; a skill the viewer did not write never shows its text; greedy infers nothing', async () => {
    const id = await ended(true, 'greedy');
    const a = await ana.get(`/v2/matches/${id}/decisions`);
    expect(a.body.crews.map((c: { team: string; own: boolean }) => [c.team, c.own])).toEqual([
      ['A', true],
      ['B', false],
    ]);
    expect(a.body.crews[1].decisions[0].skill).toBeNull();
    const theirs = a.body.skills.find((s: { id: string }) => s.id === benSkill.id);
    expect(theirs).toEqual({ ...benSkill, name: 'Wall Digger', mine: false });
    expect(JSON.stringify(a.body)).not.toContain('BEN-SECRET');
  });
});
