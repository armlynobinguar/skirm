import { CAMPAIGN_CHAPTERS, missionUnlocked, objectiveMet } from '@skirm/shared';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { RepoError, campaignRewards } from '../src/index';
import { setup, signUp } from './helpers';

const win = { winner: 'A' as const, score: { A: 3, B: 1 }, ticks: 60 };
const loss = { winner: 'B' as const, score: { A: 0, B: 3 }, ticks: 70 };
const [c1, c2, c3] = CAMPAIGN_CHAPTERS;

describe('campaign rules', () => {
  it('opens missions in order, and each chapter after the one before', () => {
    const none = new Set<string>();
    expect(missionUnlocked('c1-m1', none)).toBe(true);
    expect(missionUnlocked('c1-m2', none)).toBe(false);
    expect(missionUnlocked('c2-m1', none)).toBe(false);
    expect(missionUnlocked('c1-m2', new Set(['c1-m1']))).toBe(true);
    const chapter1 = new Set(c1!.missions.map((m) => m.id));
    expect(missionUnlocked('c2-m1', chapter1)).toBe(true);
    expect(missionUnlocked('c2-m2', chapter1)).toBe(false);
    expect(missionUnlocked('c3-m1', chapter1)).toBe(false);
    expect(missionUnlocked('nope', chapter1)).toBe(false);
  });

  it('reads each objective from the result', () => {
    expect(objectiveMet({ kind: 'win' }, win)).toBe(true);
    expect(objectiveMet({ kind: 'win' }, loss)).toBe(false);
    expect(objectiveMet({ kind: 'win' }, { ...win, winner: 'draw' })).toBe(false);
    expect(objectiveMet({ kind: 'win_within', ticks: 60 }, win)).toBe(true);
    expect(objectiveMet({ kind: 'win_within', ticks: 59 }, win)).toBe(false);
    expect(objectiveMet({ kind: 'shutout' }, win)).toBe(false);
    expect(objectiveMet({ kind: 'shutout' }, { ...win, score: { A: 3, B: 0 } })).toBe(true);
  });
});

describe('CampaignRepo', () => {
  it('counts attempts, clears once and keeps the fastest clear', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'ana');
    const { campaign } = ctx.repos;
    expect(await campaign.record(acc.id, 'c1-m1', 'mat_1', loss)).toEqual({ cleared: false, newlyCleared: false, granted: [] });
    expect(await campaign.record(acc.id, 'c1-m1', 'mat_2', { ...win, ticks: 80 })).toEqual({ cleared: true, newlyCleared: true, granted: [] });
    const first = (await campaign.progress(acc.id))[0]!;
    expect(await campaign.record(acc.id, 'c1-m1', 'mat_3', { ...win, ticks: 50 })).toEqual({ cleared: true, newlyCleared: false, granted: [] });
    await campaign.record(acc.id, 'c1-m1', 'mat_4', loss);
    const [row] = await campaign.progress(acc.id);
    expect(row).toMatchObject({ missionId: 'c1-m1', attempts: 4, bestTicks: 50, lastMatchId: 'mat_4' });
    // A later loss never undoes the clear, and the first clear's time stays.
    expect(row!.clearedAt).toEqual(first.clearedAt);
    expect([...(await campaign.cleared(acc.id))]).toEqual(['c1-m1']);
    await expect(campaign.record(acc.id, 'c9-m9', 'mat_5', win)).rejects.toBeInstanceOf(RepoError);
  });

  it('grants a chapter skill and cosmetic once, equippable and account-bound', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'ana');
    const { campaign, skills, cosmetics } = ctx.repos;
    await campaign.ensureRewardSkills(ctx.sealer);
    await campaign.ensureRewardSkills(ctx.sealer); // idempotent
    expect(await campaign.rewardSkillsExist()).toBe(true);

    const last = c1!.missions.length - 1;
    for (const [i, m] of c1!.missions.entries()) {
      const r = await campaign.record(acc.id, m.id, `mat_${i}`, win);
      expect(r.granted).toEqual(i === last ? ['c1'] : []);
    }
    const skill = c1!.rewards.skill;
    expect(await skills.owns(acc.id, skill.id, skill.version)).toBe(true);
    const owned = await skills.listOwned(acc.id);
    expect(owned.find((v) => v.id === skill.id)).toMatchObject({ name: skill.name, accountBound: true });

    // Replaying a cleared mission, or a backfill, grants nothing again.
    expect((await campaign.record(acc.id, c1!.missions[0]!.id, 'mat_again', win)).granted).toEqual([]);
    expect(await campaign.grantDue(acc.id)).toEqual([]);
    expect(await campaign.rewards(acc.id)).toHaveLength(1);

    // The last chapter adds its cosmetic.
    for (const ch of [c2!, c3!]) for (const m of ch.missions) await campaign.record(acc.id, m.id, `mat_${m.id}`, { winner: 'A', score: { A: 3, B: 0 }, ticks: 40 });
    expect((await campaign.rewards(acc.id)).map((r) => r.chapterId).sort()).toEqual(['c1', 'c2', 'c3']);
    expect(await cosmetics.owned(acc.id)).toContain(c3!.rewards.cosmetic);
  });

  it('backfills a complete chapter with no reward row (grantDue)', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'ben');
    const { campaign } = ctx.repos;
    // Clears recorded through the repo grant as they go; drop the grant to simulate a lost one.
    for (const m of c1!.missions) await campaign.record(acc.id, m.id, `mat_${m.id}`, win);
    await ctx.repos.db.delete(campaignRewards).where(eq(campaignRewards.accountId, acc.id));
    expect(await campaign.grantDue(acc.id)).toEqual(['c1']);
    expect(await campaign.grantDue(acc.id)).toEqual([]);
  });

  it('is in the account export', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'cy');
    await ctx.repos.campaign.record(acc.id, 'c1-m1', 'mat_1', win);
    const out = await ctx.repos.accounts.exportFor(acc.id);
    expect(out.campaign).toHaveLength(1);
    expect(out.campaignRewards).toEqual([]);
  });
});
