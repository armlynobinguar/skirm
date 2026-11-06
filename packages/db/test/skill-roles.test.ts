import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { STARTER_SKILL } from '../src/index';
import { setup, signUp } from './helpers';

const meta = {
  name: 'Scout Sweep',
  summary: 'Repels rivals near the gems.',
  requiresActions: [] as [],
  handlesTags: ['collectible' as const],
  royaltyBps: 500,
};

describe('role skill slots', () => {
  it('stores roles on the version, any by default (the starter and older versions too)', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'ana');
    const anyRole = await ctx.repos.skills.create(acc.id, meta, await ctx.sealer.encryptSkill('p'));
    expect(anyRole.roles).toEqual(['any']);
    const scout = await ctx.repos.skills.create(
      acc.id,
      { ...meta, name: 'Scout Only', roles: ['Hauler', 'Scout'] },
      await ctx.sealer.encryptSkill('p'),
    );
    expect(scout.roles).toEqual(['Scout', 'Hauler']);
    expect((await ctx.repos.skills.get(STARTER_SKILL.id, 1))!.roles).toEqual(['any']);
    // A version can change its roles; v1 keeps its own.
    const v2 = await ctx.repos.skills.createVersion(scout.id, acc.id, { ...meta, name: 'Scout Only', roles: ['any'] }, await ctx.sealer.encryptSkill('p'));
    expect(v2.roles).toEqual(['any']);
    expect((await ctx.repos.skills.get(scout.id, 1))!.roles).toEqual(['Scout', 'Hauler']);
    // The column default (what the migration gives rows written before roles) is any.
    const res = await ctx.db.execute<{ d: string }>(
      sql`select column_default as d from information_schema.columns where table_name = 'skill_versions' and column_name = 'roles'`,
    );
    expect(JSON.stringify(res)).toContain('any');
  });

  it('equips only skills for the agent role or any, and refuses a role change that strands one', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'ana');
    const [rook] = await ctx.repos.agents.listByOwner(acc.id);
    await ctx.repos.agents.update(acc.id, rook!.id, { role: 'Builder' });
    const scout = await ctx.repos.skills.create(
      acc.id,
      { ...meta, roles: ['Scout'] },
      await ctx.sealer.encryptSkill('p'),
    );

    await expect(
      ctx.repos.agents.update(acc.id, rook!.id, { skills: [{ id: scout.id, version: 1 }] }),
    ).rejects.toMatchObject({
      code: 'skill_role_mismatch',
      details: { skillId: scout.id, version: 1, roles: ['Scout'], role: 'Builder' },
    });
    // Refused as a whole: the starter (any role) is still equipped.
    expect((await ctx.repos.agents.view(rook!.id))!.skills.map((s) => s.id)).toEqual([STARTER_SKILL.id]);

    // Role and skills in one patch: checked against the new role.
    const v = await ctx.repos.agents.update(acc.id, rook!.id, {
      role: 'Scout',
      skills: [
        { id: scout.id, version: 1 },
        { id: STARTER_SKILL.id, version: 1 },
      ],
    });
    expect(v.role).toBe('Scout');
    expect(v.skills.map((s) => s.id)).toEqual([scout.id, STARTER_SKILL.id]);

    // Changing role away from the skill's role is refused while it is equipped.
    await expect(ctx.repos.agents.update(acc.id, rook!.id, { role: 'Hauler' })).rejects.toMatchObject({
      code: 'skill_role_mismatch',
    });
    expect((await ctx.repos.agents.view(rook!.id))!.role).toBe('Scout');
    // Any-role skills never block a role change.
    await ctx.repos.agents.update(acc.id, rook!.id, { skills: [{ id: STARTER_SKILL.id, version: 1 }] });
    expect((await ctx.repos.agents.update(acc.id, rook!.id, { role: 'Hauler' })).role).toBe('Hauler');
  });

  it('takes the new roles (plain text column, no migration) and keeps a six-role skill off them', async () => {
    const ctx = await setup();
    const acc = await signUp(ctx, 'ana');
    const [rook] = await ctx.repos.agents.listByOwner(acc.id);
    for (const role of ['Medic', 'Engineer', 'Saboteur', 'Courier'] as const) {
      expect((await ctx.repos.agents.update(acc.id, rook!.id, { role })).role).toBe(role);
      expect((await ctx.repos.agents.view(rook!.id))!.role).toBe(role);
    }
    await expect(ctx.repos.agents.update(acc.id, rook!.id, { role: 'Wizard' as never })).rejects.toMatchObject({ code: 'invalid_role' });
    const six = ['Builder', 'Digger', 'Firefighter', 'Scout', 'Runner', 'Hauler'] as const;
    const classic = await ctx.repos.skills.create(acc.id, { ...meta, name: 'Classic Only', roles: [...six] }, await ctx.sealer.encryptSkill('p'));
    expect(classic.roles).toEqual(six);
    await expect(ctx.repos.agents.update(acc.id, rook!.id, { skills: [{ id: classic.id, version: 1 }] })).rejects.toMatchObject({ code: 'skill_role_mismatch' });
    const medic = await ctx.repos.skills.create(acc.id, { ...meta, name: 'Field Medic', roles: ['Medic', 'Courier'] }, await ctx.sealer.encryptSkill('p'));
    expect(medic.roles).toEqual(['Medic', 'Courier']);
  });
});
