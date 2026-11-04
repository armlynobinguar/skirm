import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ACCOUNT_ID, type V2CrewRecord } from '@skirm/db';
import { NearBadges, type FunctionCaller } from '@skirm/server';
import { DAILY_QUESTS, drawQuests, questWindow } from '@skirm/shared';
import { setup, type Harness, type UserClient } from './helpers';

let h: Harness;
let ana: UserClient;
let ben: UserClient;

const agent = (id: string, tier: string): V2CrewRecord => ({
  id,
  name: id,
  role: 'Builder',
  vision: 3,
  comms: 3,
  tier,
});

const debrief = (sent: number) => ({
  eloDelta: null,
  mvp: null,
  goals: [],
  talk: { sent, overheard: 0 },
  credits: { held: 0, used: 0, returned: 0 },
  registry: null,
  agents: [],
});

async function practiceWin(accountId: string, ticks = 60) {
  const m = await h.repos.v2Matches.create({
    mapId: 'copper-hollow',
    ranked: false,
    practice: true,
    difficulty: 'easy',
    teamA: accountId,
    teamB: SYSTEM_ACCOUNT_ID,
  });
  await h.repos.v2Matches.finish(m.id, {
    winner: 'A',
    reason: 'goal',
    ticks,
    score: { A: 5, B: 0 },
    crews: {
      A: [agent('a1', 'quiet'), agent('a2', 'quiet'), agent('a3', 'quiet')],
      B: [agent('bot', 'standard')],
    },
    debriefs: { A: debrief(20) },
  });
}

/** One match set that completes every daily quest in the pool. */
async function completeEveryDaily() {
  for (let i = 0; i < 3; i++) await practiceWin(ana.accountId);
  const ranked = await h.repos.v2Matches.create({
    mapId: 'copper-hollow',
    ranked: true,
    teamA: ana.accountId,
    teamB: ben.accountId,
  });
  await h.repos.v2Matches.finish(ranked.id, {
    winner: 'A',
    reason: 'goal',
    ticks: 80,
    score: { A: 2, B: 1 },
    crews: { A: [agent('a1', 'open')], B: [agent('b1', 'standard')] },
  });
}

beforeAll(async () => {
  h = await setup({ now: '2026-11-04T08:00:00Z' });
  ana = await h.as('questana');
  ben = await h.as('questben');
});
afterAll(() => h.close());

describe('GET /quests', () => {
  it('draws the same 3 daily and 2 weekly quests as @skirm/shared, with no progress yet', async () => {
    const res = await ana.get('/quests');
    expect(res.status).toBe(200);
    const now = Date.parse('2026-11-04T08:00:00Z');
    expect(res.body.daily.key).toBe('2026-11-04');
    expect(res.body.daily.endsAt).toBe('2026-11-05T00:00:00.000Z');
    expect(res.body.weekly.key).toBe('2026-11-02');
    expect(res.body.daily.quests.map((q: { id: string }) => q.id)).toEqual(
      drawQuests(questWindow('daily', now)).map((q) => q.id),
    );
    expect(res.body.weekly.quests).toHaveLength(2);
    expect(res.body.daily.quests[0]).toMatchObject({
      period: 'daily',
      progress: 0,
      done: false,
      claimed: false,
      claimable: false,
      rewardCredits: 10,
      credited: null,
    });
    expect(res.body.weekly.quests[0].rewardCredits).toBe(25);
    expect(res.body.streak).toEqual({ current: 0, best: 0, playedToday: false });
    expect(res.body.allowanceLeft).toBe(60);
  });

  it('needs a session', async () => {
    expect((await h.http().get('/quests')).status).toBe(401);
  });
});

describe('POST /quests/:id/claim', () => {
  it('refuses a quest that is not drawn now or not finished', async () => {
    expect((await ana.post('/quests/nope/claim')).status).toBe(404);
    const notToday = DAILY_QUESTS.find(
      (q) => !drawQuests(questWindow('daily', h.clock.now)).some((d) => d.id === q.id),
    )!;
    expect((await ana.post(`/quests/${notToday.id}/claim`)).status).toBe(404);
    const [first] = (await ana.get('/quests')).body.daily.quests;
    const res = await ana.post(`/quests/${first.id}/claim`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('quest_incomplete');
  });

  it('tracks progress from match results and the streak', async () => {
    await completeEveryDaily();
    const res = await ana.get('/quests');
    for (const q of res.body.daily.quests) expect(q).toMatchObject({ done: true, claimable: true });
    expect(res.body.streak).toEqual({ current: 1, best: 1, playedToday: true });
  });

  it('refills only free credits spent today, never past the daily allowance', async () => {
    const [q1, q2] = (await ana.get('/quests')).body.daily.quests;
    // Nothing spent: the allowance is full, the claim stays open.
    let res = await ana.post(`/quests/${q1.id}/claim`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('allowance_full');

    // A held match is not spent yet: what it does not charge comes back on settle.
    const runId = 'mat_questrun-A';
    expect((await h.repos.ledger.hold({ accountId: ana.accountId, runId, stepLimit: 30, agents: 1 })).ok).toBe(true);
    expect((await ana.post(`/quests/${q1.id}/claim`)).body.error.code).toBe('allowance_full');

    const turns = Array.from({ length: 12 }, () => ({ agent: 0, reason: null }));
    expect((await h.repos.ledger.chargeTurns(runId, turns)).ok).toBe(true);
    res = await ana.post(`/quests/${q1.id}/claim`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ credited: 10, allowanceLeft: 40 });
    expect(res.body.quest).toMatchObject({ id: q1.id, claimed: true, claimable: false, credited: 10 });

    res = await ana.post(`/quests/${q1.id}/claim`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_claimed');

    // Only 2 of the 12 spent are left to refill.
    res = await ana.post(`/quests/${q2.id}/claim`);
    expect(res.body).toMatchObject({ credited: 2, allowanceLeft: 42 });

    // Settle returns the 18 unused: the allowance is full again, not above it.
    expect((await h.repos.ledger.settle(runId)).ok).toBe(true);
    const me = await ana.get('/me');
    expect(me.body.credits.allowanceLeft).toBe(60);
    expect(me.body.credits.balance).toBe(0);
    expect((await ana.get('/quests')).body.allowanceLeft).toBe(60);
  });

  it('a new day draws new quests and keeps the streak going', async () => {
    const saved = h.clock.now;
    try {
      h.clock.now = Date.parse('2026-11-05T09:00:00Z');
      let res = await ana.get('/quests');
      expect(res.body.daily.key).toBe('2026-11-05');
      for (const q of res.body.daily.quests) expect(q).toMatchObject({ progress: 0, claimed: false });
      expect(res.body.streak).toEqual({ current: 1, best: 1, playedToday: false });
      await practiceWin(ana.accountId);
      res = await ana.get('/quests');
      expect(res.body.streak).toEqual({ current: 2, best: 2, playedToday: true });
    } finally {
      h.clock.now = saved;
    }
  });
});

describe('achievements', () => {
  it('unlock from all-time results and show progress', async () => {
    const res = await ana.get('/achievements');
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.achievements.map((a: { id: string }) => [a.id, a]));
    expect(by.first_match).toMatchObject({ unlocked: true, progress: 1, badge: null });
    expect(by.first_win.unlocked).toBe(true);
    expect(by.first_win.unlockedAt).toEqual(expect.any(String));
    expect(by.quick_goal.unlocked).toBe(true);
    expect(by.practice_10).toMatchObject({ unlocked: false, target: 10 });
    expect(by.wins_25.cosmetic).toEqual({ id: 'outfit_obsidian', name: 'Obsidian outfit' });
    // Reading again keeps the first unlock time.
    const again = await ana.get('/achievements');
    const first = again.body.achievements.find((a: { id: string }) => a.id === 'first_win');
    expect(first.unlockedAt).toBe(by.first_win.unlockedAt);
  });

  it('grant their cosmetic when they unlock (a 7-day streak)', async () => {
    const eve = await h.as('questeve');
    const saved = h.clock.now;
    try {
      for (let d = 0; d < 7; d++) {
        h.clock.now = Date.UTC(2026, 9, 20 + d, 12);
        await practiceWin(eve.accountId, 140);
      }
    } finally {
      h.clock.now = saved;
    }
    const res = await eve.get('/achievements');
    const streak = res.body.achievements.find((a: { id: string }) => a.id === 'streak_7');
    expect(streak).toMatchObject({ unlocked: true, progress: 7 });
    expect(res.body.streak.best).toBe(7);
    expect((await eve.get('/cosmetics')).body.owned).toContain('hair_platinum');
  });

  it('mint as a soulbound badge once, a no-op locally', async () => {
    expect((await ana.post('/achievements/nope/badge')).status).toBe(404);
    const locked = await ana.post('/achievements/wins_25/badge');
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('not_unlocked');

    const res = await ana.post('/achievements/first_win/badge');
    expect(res.status).toBe(200);
    expect(res.body.badge).toMatchObject({
      status: 'local',
      tokenId: `first_win:${ana.accountId}`,
      owner: ana.accountId,
      txHash: expect.stringMatching(/^noop:/),
    });
    expect(h.badges.mints).toHaveLength(1);
    const again = await ana.post('/achievements/first_win/badge');
    expect(again.body.badge).toEqual(res.body.badge);
    expect(h.badges.mints).toHaveLength(1);
    const list = await ana.get('/achievements');
    expect(list.body.achievements.find((a: { id: string }) => a.id === 'first_win').badge.status).toBe('local');
  });

  it('with a NEAR signer: needs a linked account, and a failed mint can be retried', async () => {
    let fail = true;
    const calls: Record<string, unknown>[] = [];
    const caller: FunctionCaller = {
      async call(_contract, _method, args) {
        if (fail) throw new Error('rpc down');
        calls.push(args);
        return { txHash: 'BADGETX' };
      },
    };
    const saved = h.deps.near.badges;
    h.deps.near.badges = new NearBadges(caller, 'badges.playskirm.testnet');
    try {
      const res = await ben.post('/achievements/first_match/badge');
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('near_account_required');

      const link = await h
        .http()
        .post('/auth/session')
        .set('x-dev-user', 'questana')
        .send({ nearAccountId: 'questana.testnet' });
      expect(link.body.account.nearAccountId).toBe('questana.testnet');
      const failed = await ana.post('/achievements/first_match/badge');
      expect(failed.status).toBe(502);
      expect(failed.body.error.code).toBe('mint_failed');
      const list = await ana.get('/achievements');
      expect(list.body.achievements.find((a: { id: string }) => a.id === 'first_match').badge.status).toBe('failed');

      fail = false;
      const ok = await ana.post('/achievements/first_match/badge');
      expect(ok.status).toBe(200);
      expect(ok.body.badge).toMatchObject({ status: 'minted', txHash: 'BADGETX', owner: 'questana.testnet' });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ token_id: `first_match:${ana.accountId}`, receiver_id: 'questana.testnet' });
    } finally {
      h.deps.near.badges = saved;
    }
  });
});
