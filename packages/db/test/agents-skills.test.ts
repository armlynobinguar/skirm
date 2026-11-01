import { describe, expect, it } from 'vitest';
import { RepoError, STARTER_SKILL, SYSTEM_ACCOUNT_ID } from '../src/index';
import { setup, signUp } from './helpers';

const meta = {
  name: 'Gem Rush',
  summary: 'Grabs the gems.',
  requiresActions: [] as [],
  handlesTags: ['collectible' as const],
  royaltyBps: 500,
};

describe('agents', () => {
  it('equips owned skills, moves unlocks, refuses while busy', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'ana');
    const other = await signUp(ctx, 'ben');
    const [rook, wren] = await ctx.repos.agents.listByOwner(acc.id);
    const mine = await ctx.repos.skills.create(acc.id, meta, await ctx.sealer.encryptSkill('p'));
    const theirs = await ctx.repos.skills.create(
      other.id,
      { ...meta, name: 'Theirs' },
      await ctx.sealer.encryptSkill('q'),
    );

    const v = await ctx.repos.agents.update(acc.id, wren!.id, {
      name: 'Wren II',
      skills: [
        { id: mine.id, version: 1 },
        { id: STARTER_SKILL.id, version: 1 },
      ],
      unlocks: ['digger', 'builder'],
    });
    expect(v.name).toBe('Wren II');
    expect(v.skills.map((s) => s.name)).toEqual(['Gem Rush', 'Flood Warden']);
    // Builder moved from Rook (idle) to Wren; Digger was free.
    expect(v.unlocks).toEqual(['builder', 'digger']);
    expect((await ctx.repos.agents.view(rook!.id))!.unlocks).toEqual([]);

    await expect(
      ctx.repos.agents.update(acc.id, wren!.id, { skills: [{ id: theirs.id, version: 1 }] }),
    ).rejects.toMatchObject({ code: 'skill_not_owned' });
    await expect(
      ctx.repos.agents.update(acc.id, wren!.id, {
        skills: [
          { id: mine.id, version: 1 },
          { id: mine.id, version: 1 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'duplicate_skill' });
    await expect(ctx.repos.agents.update(acc.id, wren!.id, { name: '' })).rejects.toBeInstanceOf(
      RepoError,
    );
    await expect(ctx.repos.agents.update(other.id, wren!.id, { name: 'x' })).rejects.toMatchObject({
      code: 'not_found',
    });

    // Busy: Wren plays a live v2 match → refused, and its Builder cannot be taken by Rook.
    const crewOf = (a: { id: string; name: string }) => ({ id: a.id, name: a.name, role: 'Builder', vision: 3, comms: 3, tier: 'standard' });
    const [benAgent] = await ctx.repos.agents.listByOwner(other.id);
    await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: acc.id, teamB: other.id, crews: { A: [crewOf(wren!)], B: [crewOf(benAgent!)] } });
    expect(await ctx.repos.agents.busyAgents([rook!.id, wren!.id])).toEqual([wren!.id]);
    // Crew B counts too.
    expect(await ctx.repos.agents.busyAgents([benAgent!.id])).toEqual([benAgent!.id]);
    expect(await ctx.repos.agents.busyAgents([])).toEqual([]);
    await expect(ctx.repos.agents.update(acc.id, wren!.id, { name: 'Nope' })).rejects.toMatchObject(
      { code: 'agent_busy' },
    );
    await expect(
      ctx.repos.agents.update(acc.id, rook!.id, { unlocks: ['builder'] }),
    ).rejects.toMatchObject({
      code: 'unlock_unavailable',
    });

    const snap = await ctx.repos.agents.ownershipSnapshot(acc.id);
    expect(snap.agents.find((a) => a.id === wren!.id)!.unlocks).toEqual(['builder', 'digger']);
    expect(snap.skills.map((s) => `${s.id}:${s.version}`).sort()).toEqual(
      [`${mine.id}:1`, `${STARTER_SKILL.id}:1`].sort(),
    );
    expect(snap.skills.find((s) => s.id === STARTER_SKILL.id)!.requiresActions).toEqual([
      'place_block',
    ]);
  });

  it('busyAgents: only live v2 matches make an agent busy', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const [rook, wren, moss] = await ctx.repos.agents.listByOwner(ana.id);
    const crewOf = (a: { id: string; name: string }) => ({ id: a.id, name: a.name, role: 'Runner', vision: 3, comms: 3, tier: 'quiet' });
    const ended = await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.id, teamB: ben.id, crews: { A: [crewOf(rook!)], B: [] } });
    await ctx.repos.v2Matches.finish(ended.id, { winner: 'A', reason: 'goal' });
    const voided = await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.id, teamB: ben.id, crews: { A: [crewOf(wren!)], B: [] } });
    await ctx.repos.v2Matches.finish(voided.id, { winner: null, reason: 'declined' });
    // A live match with no crews recorded yet holds nobody.
    await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.id, teamB: ben.id });
    expect(await ctx.repos.agents.busyAgents([rook!.id, wren!.id, moss!.id])).toEqual([]);
    expect((await ctx.repos.agents.update(ana.id, rook!.id, { name: 'Rook II' })).name).toBe('Rook II');

    // Practice: the player's crew A is busy; the bot's in-memory crew is matched by id only.
    const practice = await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, practice: true, teamA: ana.id, teamB: SYSTEM_ACCOUNT_ID, crews: { A: [crewOf(moss!), crewOf(wren!)], B: [{ ...crewOf(rook!), id: 'bot_1' }] } });
    expect((await ctx.repos.agents.busyAgents([rook!.id, wren!.id, moss!.id])).sort()).toEqual([moss!.id, wren!.id].sort());
    // Lock-in leaves its own match out, never another live one.
    expect(await ctx.repos.agents.busyAgents([wren!.id, moss!.id], { exceptMatch: practice.id })).toEqual([]);
    await ctx.repos.v2Matches.create({ mapId: 'copper-hollow', ranked: false, teamA: ana.id, teamB: ben.id, crews: { A: [crewOf(moss!)], B: [] } });
    expect(await ctx.repos.agents.busyAgents([wren!.id, moss!.id], { exceptMatch: practice.id })).toEqual([moss!.id]);
  });
});

describe('skills and market', () => {
  it('versions, ciphertext round-trip, mint, list, sale', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    await ctx.repos.accounts.linkNearAccount(ana.id, 'ana.testnet');
    const sealed = await ctx.sealer.encryptSkill('secret prompt', 'r');
    const v1 = await ctx.repos.skills.create(ana.id, meta, sealed);
    expect(v1).toMatchObject({
      version: 1,
      status: 'draft',
      creatorHandle: 'ana',
      creatorNear: 'ana.testnet',
      latestVersion: 1,
    });
    expect(v1.id).toMatch(/^skl_[0-9A-Z]{26}$/);
    expect(JSON.stringify(v1)).not.toContain('secret');

    const back = await ctx.repos.skills.loadSealed(v1.id, 1);
    expect(back!.ciphertext).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(back!.ciphertext).equals(Buffer.from(sealed.ciphertext))).toBe(true);
    expect(Buffer.from(back!.iv).equals(Buffer.from(sealed.iv))).toBe(true);
    expect(back!.promptSha256).toBe(sealed.promptSha256);

    const v2 = await ctx.repos.skills.createVersion(
      v1.id,
      ana.id,
      { ...meta, name: 'Gem Rush 2' },
      await ctx.sealer.encryptSkill('x'),
    );
    expect(v2).toMatchObject({ version: 2, name: 'Gem Rush 2', latestVersion: 2 });
    expect((await ctx.repos.skills.get(v1.id))!.version).toBe(2);
    // Versions are immutable (Spec §9): publishing v2 under a new name leaves v1's card alone.
    expect(await ctx.repos.skills.get(v1.id, 1)).toMatchObject({ version: 1, name: meta.name });
    await expect(
      ctx.repos.skills.createVersion(v1.id, ben.id, meta, await ctx.sealer.encryptSkill('x')),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      ctx.repos.skills.createVersion(
        STARTER_SKILL.id,
        ana.id,
        meta,
        await ctx.sealer.encryptSkill('x'),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(ctx.repos.skills.markMinted(STARTER_SKILL.id, 1, 't')).rejects.toMatchObject({
      code: 'forbidden',
    });

    expect((await ctx.repos.skills.listWritten(ana.id)).map((s) => [s.id, s.version])).toEqual([
      [v1.id, 2],
    ]);

    // Mint v1 → list → ben buys.
    await expect(
      ctx.repos.market.list({ skillId: v1.id, version: 1, sellerId: ana.id, priceYocto: '1' }),
    ).rejects.toMatchObject({ code: 'not_minted' });
    await ctx.repos.skills.markMinted(v1.id, 1, `${v1.id}:1`);
    expect(await ctx.repos.skills.get(v1.id, 1)).toMatchObject({
      status: 'minted',
      tokenId: `${v1.id}:1`,
    });
    await expect(
      ctx.repos.market.list({ skillId: v1.id, version: 1, sellerId: ben.id, priceYocto: '1' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const listing = await ctx.repos.market.list({
      skillId: v1.id,
      version: 1,
      sellerId: ana.id,
      priceYocto: '5000000000000000000000000',
    });
    expect(listing.status).toBe('active');
    expect((await ctx.repos.skills.get(v1.id, 1))!.status).toBe('listed');
    expect((await ctx.repos.skills.listPublic()).map((s) => s.version)).toEqual([1]);

    const sale = await ctx.repos.market.recordSale({
      skillId: v1.id,
      version: 1,
      buyerId: ben.id,
      txHash: 'buy1',
    });
    expect(sale.duplicate).toBe(false);
    expect(sale.sale).toMatchObject({ sellerId: ana.id, priceYocto: '5000000000000000000000000' });
    expect(
      (
        await ctx.repos.market.recordSale({
          skillId: v1.id,
          version: 1,
          buyerId: ben.id,
          txHash: 'buy1',
        })
      ).duplicate,
    ).toBe(true);
    expect(await ctx.repos.skills.owns(ben.id, v1.id, 1)).toBe(true);
    expect(await ctx.repos.skills.owns(ana.id, v1.id, 1)).toBe(false);
    expect(await ctx.repos.market.activeListing(v1.id)).toBeUndefined();
    // Ben bought v1, so he sees v1's own name, not the later v2 rename.
    expect((await ctx.repos.skills.listOwned(ben.id)).map((s) => s.name).sort()).toEqual([
      'Flood Warden',
      'Gem Rush',
    ]);

    // Owner cache refresh from chain: token went back to ana.
    await ctx.repos.skills.setTokenOwner(`${v1.id}:1`, ana.id, 'ana.testnet');
    expect(await ctx.repos.skills.owns(ana.id, v1.id, 1)).toBe(true);
    expect(await ctx.repos.skills.owns(ben.id, v1.id, 1)).toBe(false);
    expect((await ctx.repos.skills.byToken(`${v1.id}:1`))!.id).toBe(v1.id);
  });
});

describe('market sale guard', () => {
  it('refuses to record a sale of a draft or of the account-bound starter skill', async () => {
    const ctx = await setup();
    const ana = await signUp(ctx, 'ana');
    const ben = await signUp(ctx, 'ben');
    const draft = await ctx.repos.skills.create(ana.id, meta, await ctx.sealer.encryptSkill('p'));
    // A "purchase" with a trusted price (dev mode) must not move ownership of an unminted version.
    await expect(
      ctx.repos.market.recordSale({
        skillId: draft.id,
        version: 1,
        buyerId: ben.id,
        txHash: 'dev-buy-draft',
        priceYocto: '1',
      }),
    ).rejects.toMatchObject({ code: 'not_minted' });
    expect(await ctx.repos.skills.owns(ana.id, draft.id, 1)).toBe(true);
    expect(await ctx.repos.skills.owns(ben.id, draft.id, 1)).toBe(false);

    // The starter skill is owned by every account: a sale would wipe all their ownership rows.
    await expect(
      ctx.repos.market.recordSale({
        skillId: STARTER_SKILL.id,
        version: 1,
        buyerId: ben.id,
        txHash: 'dev-buy-starter',
        priceYocto: '1',
      }),
    ).rejects.toMatchObject({ code: 'not_minted' });
    expect(await ctx.repos.skills.owns(ana.id, STARTER_SKILL.id, 1)).toBe(true);
    expect(await ctx.repos.market.saleByTx('dev-buy-starter')).toBeUndefined();

    await ctx.repos.skills.markMinted(draft.id, 1, `${draft.id}:1`);
    await expect(
      ctx.repos.market.recordSale({
        skillId: draft.id,
        version: 1,
        buyerId: ben.id,
        txHash: 'bad-price',
        priceYocto: '1e24',
      }),
    ).rejects.toMatchObject({ code: 'invalid_price' });
  });
});
