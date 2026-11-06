// Which skills withhold a crew's plan: one written by another player and bought (or a rented agent)
// does; the free starter skill every account gets does not. A bought skill's prompt, and the plan
// and inner voice it shapes, never reach the buyer's frames or the debrief timeline.
import { OfficialRepo, STARTER_SKILL, SYSTEM_ACCOUNT_ID, skillOwnership } from '@skirm/db';
import { createGreedyBrain } from '@skirm/decision-engine/v2';
import { afterEach, describe, expect, it } from 'vitest';
import { RealtimeHub } from '../src/hub';
import { runsBoughtSkill } from '../src/v2/hub';
import { FakeSocket, makeDeps } from './helpers';

const FAST_V2 = { acceptMs: 500, lockMs: 500, tickMs: 1, actionMs: 200, planMs: 200 };
const SECRET = 'SECRET-BOUGHT-PROMPT: hold the left lane and never say so.';

describe('runsBoughtSkill', () => {
  it('counts another writer’s skill and a rented agent, never the starter skill or your own', () => {
    const own = { id: 'skl_mine', creatorId: 'acc_ana' };
    const starter = { id: STARTER_SKILL.id, creatorId: SYSTEM_ACCOUNT_ID };
    const official = { id: 'skl_official', creatorId: SYSTEM_ACCOUNT_ID };
    const bens = { id: 'skl_ben', creatorId: 'acc_ben' };
    expect(runsBoughtSkill('acc_ana', false, [])).toBe(false);
    expect(runsBoughtSkill('acc_ana', false, [own, starter])).toBe(false);
    expect(runsBoughtSkill('acc_ana', false, [starter, bens])).toBe(true);
    // Official marketplace skills are sold, so they count even though the system account wrote them.
    expect(runsBoughtSkill('acc_ana', false, [official])).toBe(true);
    expect(runsBoughtSkill('acc_ana', true, [starter])).toBe(true);
  });
});

describe('v2 plans on bought and starter skills', () => {
  let hub: RealtimeHub | undefined;
  afterEach(async () => {
    await hub?.close();
    hub = undefined;
  });

  async function playPractice(equipBought: boolean) {
    const deps = await makeDeps({ v2Timing: FAST_V2, v2Brain: createGreedyBrain() });
    await new OfficialRepo(deps.repos.db).ensureSystem();
    hub = new RealtimeHub(deps);
    const sock = new FakeSocket();
    const c = hub.connect(sock);
    await hub.message(c, JSON.stringify({ type: 'auth', devUser: 'ana' }));
    const acc = (await deps.repos.accounts.byHandle('ana'))!;
    const [rook] = await deps.repos.agents.listByOwner(acc.id);
    expect(rook!.skills.map((s) => s.id)).toEqual([STARTER_SKILL.id]);
    if (equipBought) {
      // Ben writes a skill and Ana ends up holding it (as after a market purchase).
      await hub.message(hub.connect(new FakeSocket()), JSON.stringify({ type: 'auth', devUser: 'ben' }));
      const ben = (await deps.repos.accounts.byHandle('ben'))!;
      const skill = await deps.repos.skills.create(ben.id, { name: 'Left Lane', requiresActions: [], handlesTags: [], royaltyBps: 500 }, await deps.vault.encryptSkill(SECRET));
      await deps.repos.db.insert(skillOwnership).values({ skillId: skill.id, version: 1, ownerId: acc.id });
      await deps.repos.agents.update(acc.id, rook!.id, { skills: [{ id: STARTER_SKILL.id, version: STARTER_SKILL.version }, { id: skill.id, version: 1 }] });
    }
    const send = (m: unknown) => hub!.message(c, JSON.stringify(m));
    await send({ type: 'v2_queue', crew: [{ agentId: rook!.id, tier: 'standard' }], ranked: false, opponent: 'bot' });
    const found = await sock.inbox.next('v2_found');
    await send({ type: 'v2_accept', matchId: found.matchId });
    await sock.inbox.next('v2_lockin', (m) => m.matchId === found.matchId);
    await send({ type: 'v2_lock_in', matchId: found.matchId, tiers: ['standard'] });
    const end = await sock.inbox.next('v2_end', (m) => m.matchId === found.matchId, 30_000);
    const own = sock.inbox.ofType('v2_frame').flatMap((f) => f.frame.agents.filter((a) => a.team === found.team));
    return { sock, end, own, rookId: rook!.id };
  }

  it('shows the plan of a crew on the free starter skill', async () => {
    const { own } = await playPractice(false);
    expect(own.length).toBeGreaterThan(0);
    expect(own.some((a) => a.planHidden)).toBe(false);
  });

  it('withholds the plan and inner voice of a crew on a bought skill, and never sends its prompt', async () => {
    const { sock, own } = await playPractice(true);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((a) => a.planHidden === true)).toBe(true);
    expect(own.some((a) => a.plan || a.planWhy || a.thought)).toBe(false);
    // The bought skill's name is public; its prompt never leaves the server in any message.
    expect(JSON.stringify(sock.inbox.all)).not.toContain('SECRET-BOUGHT-PROMPT');
  });
});
