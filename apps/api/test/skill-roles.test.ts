// Role skill slots: `roles` on POST/PUT /skills, on every public skill view, the Exchange filter,
// and the equip rule on PATCH /agents/:id and POST /market/:id/trial.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FLOOD_WARDEN, SAMPLE_SKILL, setup, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await setup();
});
afterAll(() => h.close());

describe('role skill slots', () => {
  it('defaults roles to any and validates them', async () => {
    const u = await h.as('roles-writer');
    const any = await u.post('/skills', SAMPLE_SKILL);
    expect(any.status).toBe(201);
    expect(any.body.roles).toEqual(['any']);
    const scout = await u.post('/skills', { ...SAMPLE_SKILL, roles: ['Hauler', 'Scout'] });
    expect(scout.status).toBe(201);
    expect(scout.body.roles).toEqual(['Scout', 'Hauler']);
    expect((await u.get(`/skills/${scout.body.id}`)).body.roles).toEqual(['Scout', 'Hauler']);
    // A new version may change them.
    const v2 = await u.put(`/skills/${scout.body.id}`, { ...SAMPLE_SKILL, roles: ['any'] });
    expect(v2.status).toBe(200);
    expect(v2.body).toMatchObject({ version: 2, roles: ['any'] });

    for (const roles of [[], ['Wizard'], ['Scout', 'Scout'], ['any', 'Scout'], 'Scout']) {
      const res = await u.post('/skills', { ...SAMPLE_SKILL, roles });
      expect(res.status, JSON.stringify(roles)).toBe(400);
      expect(res.body.error.details.issues[0].path).toMatch(/^roles/);
    }
    // The starter skill is for any role.
    const starter = (await u.get('/skills?tab=owned')).body.find((s: { id: string }) => s.id === FLOOD_WARDEN.id);
    expect(starter.roles).toEqual(['any']);
  });

  it('refuses to equip a skill for another role, or a role change that strands one', async () => {
    const u = await h.as('roles-equipper');
    const [rook] = (await u.get('/agents')).body;
    expect((await u.patch(`/agents/${rook.id}`, { role: 'Builder' })).status).toBe(200);
    const scout = (await u.post('/skills', { ...SAMPLE_SKILL, roles: ['Scout'] })).body;

    const refused = await u.patch(`/agents/${rook.id}`, { skills: [{ id: scout.id, version: 1 }] });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatchObject({
      code: 'skill_role_mismatch',
      details: { skillId: scout.id, version: 1, roles: ['Scout'], role: 'Builder' },
    });

    const ok = await u.patch(`/agents/${rook.id}`, { role: 'Scout', skills: [{ id: scout.id, version: 1 }, FLOOD_WARDEN] });
    expect(ok.status).toBe(200);
    expect(ok.body.skills.map((s: { id: string }) => s.id)).toEqual([scout.id, FLOOD_WARDEN.id]);

    const strand = await u.patch(`/agents/${rook.id}`, { role: 'Runner' });
    expect(strand.status).toBe(422);
    expect(strand.body.error.code).toBe('skill_role_mismatch');
    // Any-role skills (the starter) never block.
    expect((await u.patch(`/agents/${rook.id}`, { skills: [FLOOD_WARDEN], role: 'Runner' })).status).toBe(200);
  });

  it('shows roles on Exchange cards and detail, filters by role, and gates trials', async () => {
    const seller = await h.as('roles-seller');
    const buyer = await h.as('roles-buyer');
    const scout = (await seller.post('/skills', { ...SAMPLE_SKILL, name: 'Scout Sweep', roles: ['Scout'] })).body;
    const any = (await seller.post('/skills', { ...SAMPLE_SKILL, name: 'Any Sweep' })).body;
    for (const s of [scout, any]) expect((await seller.post(`/skills/${s.id}/mint`)).status).toBeLessThan(300);

    const cards = (await buyer.get('/market')).body as { skill: { id: string; roles: string[] } }[];
    expect(cards.find((c) => c.skill.id === scout.id)!.skill.roles).toEqual(['Scout']);
    expect(cards.find((c) => c.skill.id === any.id)!.skill.roles).toEqual(['any']);
    const forScouts = (await buyer.get('/market?role=Scout')).body.map((c: { skill: { id: string } }) => c.skill.id);
    expect(forScouts).toEqual(expect.arrayContaining([scout.id, any.id]));
    const forHaulers = (await buyer.get('/market?role=Hauler')).body.map((c: { skill: { id: string } }) => c.skill.id);
    expect(forHaulers).toContain(any.id);
    expect(forHaulers).not.toContain(scout.id);
    expect((await buyer.get('/market?role=Wizard')).status).toBe(400);
    expect((await buyer.get(`/market/${scout.id}`)).body.skill.roles).toEqual(['Scout']);

    const [agent] = (await buyer.get('/agents')).body;
    await buyer.patch(`/agents/${agent.id}`, { role: 'Hauler' });
    const trial = await buyer.post(`/market/${scout.id}/trial`, { agentId: agent.id });
    expect(trial.status).toBe(422);
    expect(trial.body.error.code).toBe('skill_role_mismatch');
    await buyer.patch(`/agents/${agent.id}`, { role: 'Scout' });
    expect((await buyer.post(`/market/${scout.id}/trial`, { agentId: agent.id })).status).toBe(202);
  });
});
