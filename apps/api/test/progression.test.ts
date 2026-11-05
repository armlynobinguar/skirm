// Agent progression: GET /agents/:id/progression, POST /agents/:id/traits, XP from finished matches
// and the account export.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await setup();
});
afterAll(() => h.close());

const crewOf = (a: { id: string; name: string }) => [{ id: a.id, name: a.name, role: 'Runner', vision: 3, comms: 3, tier: 'standard' }];
const debrief = (agentId: string, delivered: number) => ({
  eloDelta: null,
  mvp: agentId,
  goals: [],
  talk: { sent: 0, overheard: 0 },
  credits: { held: 0, used: 0, returned: 0 },
  registry: null,
  agents: [{ agentId, name: 'x', delivered, used: 0, picks: delivered }],
});

describe('agent progression', () => {
  it('shows level 1 and the trait catalogue, then XP from a casual match', async () => {
    const ana = await h.as('ana');
    const ben = await h.as('ben');
    const [mine] = (await ana.get('/agents')).body as { id: string; name: string; progression: { level: number } }[];
    const [theirs] = (await ben.get('/agents')).body as { id: string; name: string }[];
    expect(mine!.progression).toMatchObject({ xp: 0, level: 1, traits: [] });

    const res = await ana.get(`/agents/${mine!.id}/progression`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ agentId: mine!.id, progression: { level: 1, traitSlots: 0 }, traitLevels: [3, 6], maxTraits: 2, rankedTraits: false });
    expect(res.body.traits.map((t: { id: string }) => t.id)).toEqual(['keen', 'clear', 'steady', 'calm', 'quick', 'strong']);

    const m = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.accountId, teamB: ben.accountId, crews: { A: crewOf(mine!), B: crewOf(theirs!) } });
    await h.repos.v2Matches.finish(m.id, { winner: 'A', reason: 'goal', decidedBy: 'goal', score: { A: 4, B: 0 }, ticks: 80, debriefs: { A: debrief(mine!.id, 2) } });
    expect((await ana.get(`/agents/${mine!.id}/progression`)).body.progression.xp).toBe(25 + 20 + 4);
    // The stored debrief carries the XP line.
    const rec = await ana.get(`/v2/matches/${m.id}`);
    expect(rec.body.debrief.xp).toEqual([expect.objectContaining({ agentId: mine!.id, gained: 49 })]);
  });

  it('picks a trait once a trait level is reached', async () => {
    const cat = await h.as('cat');
    const fox = await h.as('fox');
    const [a] = (await cat.get('/agents')).body as { id: string; name: string }[];
    const [f] = (await fox.get('/agents')).body as { id: string; name: string }[];
    expect((await cat.post(`/agents/${a!.id}/traits`, { trait: 'keen' })).status).toBe(422);
    expect((await cat.post(`/agents/${a!.id}/traits`, { trait: 'flying' })).status).toBe(400);
    // Four casual wins with 10 delivered: 4 × (25 + 20 + 20) = 260 XP, level 3.
    for (let i = 0; i < 4; i++) {
      const m = await h.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: cat.accountId, teamB: fox.accountId, crews: { A: crewOf(a!), B: crewOf(f!) } });
      await h.repos.v2Matches.finish(m.id, { winner: 'A', reason: 'goal', debriefs: { A: debrief(a!.id, 10) } });
    }
    const ok = await cat.post(`/agents/${a!.id}/traits`, { trait: 'keen' });
    expect(ok.status).toBe(200);
    expect(ok.body.progression).toMatchObject({ level: 3, traits: ['keen'] });
    expect((await cat.post(`/agents/${a!.id}/traits`, { trait: 'keen' })).body.error.code).toBe('trait_taken');
    // The account export carries the agent's XP and traits.
    const exp = await cat.get('/me/export');
    expect(exp.body.agents.find((x: { id: string }) => x.id === a!.id)).toMatchObject({ xp: 260, traits: ['keen'] });
  });

  it("refuses another player's agent and needs a session", async () => {
    const dee = await h.as('dee');
    const eve = await h.as('eve');
    const [evs] = (await eve.get('/agents')).body as { id: string }[];
    expect((await dee.get(`/agents/${evs!.id}/progression`)).status).toBe(404);
    expect((await dee.post(`/agents/${evs!.id}/traits`, { trait: 'calm' })).status).toBe(404);
    expect((await h.http().get(`/agents/${evs!.id}/progression`)).status).toBe(401);
  });
});
