// /campaign: the chapter map with each mission's state, the start call that answers the v2_queue
// (403 mission_locked until the missions before are cleared), and chapter rewards granted once.
import { CAMPAIGN_CHAPTERS, CAMPAIGN_MISSIONS } from '@skirm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type Harness, type UserClient } from './helpers';

let h: Harness;
let ana: UserClient;

beforeAll(async () => {
  h = await setup({ config: { V2_BRAIN: 'greedy' } });
  ana = await h.as('ana');
});
afterAll(() => h.close());

const win = { winner: 'A' as const, score: { A: 3, B: 0 }, ticks: 40 };

describe('GET /campaign', () => {
  it('needs a session', async () => {
    expect((await h.http().get('/campaign')).status).toBe(401);
    expect((await h.http().post('/campaign/missions/c1-m1/start')).status).toBe(401);
  });

  it('opens the first mission only, free on the greedy brain', async () => {
    const res = await ana.get('/campaign');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ brain: 'greedy', free: true, progress: { cleared: 0, total: CAMPAIGN_MISSIONS.length } });
    expect(res.body.chapters).toHaveLength(CAMPAIGN_CHAPTERS.length);
    const [c1, c2] = res.body.chapters;
    expect(c1.missions.map((m: { status: string }) => m.status)).toEqual(['open', 'locked', 'locked']);
    expect(c1).toMatchObject({ unlocked: true, complete: false, rewards: { granted: false, skill: { name: 'Levee Line' } } });
    expect(c2.unlocked).toBe(false);
    expect(c1.missions[0]).toMatchObject({ id: 'c1-m1', mapId: 'saltmarsh-weir', difficulty: 'easy', crewSize: 1, costCredits: 0, objective: { kind: 'win', label: 'Win the match' } });
    // The reward skills are sealed and in place before any chapter can be completed.
    expect(await h.repos.campaign.rewardSkillsExist()).toBe(true);
  });
});

describe('POST /campaign/missions/:id/start', () => {
  it('answers the v2_queue for an open mission; refuses a locked or unknown one', async () => {
    const res = await ana.post('/campaign/missions/c1-m1/start');
    expect(res.status).toBe(200);
    expect(res.body.queue).toEqual({ type: 'v2_queue', ranked: false, opponent: 'bot', mapId: 'saltmarsh-weir', difficulty: 'easy', mission: 'c1-m1' });
    const locked = await ana.post('/campaign/missions/c1-m2/start');
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe('mission_locked');
    expect((await ana.post('/campaign/missions/nope/start')).status).toBe(404);
  });

  it('unlocks the next mission and grants the chapter reward once', async () => {
    const ben = await h.as('ben');
    const [c1] = CAMPAIGN_CHAPTERS;
    await h.repos.campaign.record(ben.accountId, 'c1-m1', 'mat_1', win);
    expect((await ben.post('/campaign/missions/c1-m2/start')).status).toBe(200);
    for (const m of c1!.missions.slice(1)) await h.repos.campaign.record(ben.accountId, m.id, `mat_${m.id}`, win);
    const res = await ben.get('/campaign');
    expect(res.body.chapters[0]).toMatchObject({ complete: true, cleared: c1!.missions.length, rewards: { granted: true } });
    expect(res.body.chapters[1].unlocked).toBe(true);
    // The skill is on the owned tab as an account-bound starter.
    const owned = await ben.get('/skills?tab=owned');
    const skill = owned.body.find((s: { id: string }) => s.id === c1!.rewards.skill.id);
    expect(skill).toMatchObject({ accountBound: true, status: 'Starter' });
    // A second read grants nothing again.
    await ben.get('/campaign');
    expect(await h.repos.campaign.rewards(ben.accountId)).toHaveLength(1);
  });
});
