// Agents, equipped skills and unlock items (Game Spec §8).
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import {
  appearanceOr,
  isAppearance,
  normalizeSkillRoles,
  progressionOf,
  traitPickError,
  isTraitId,
  skillFitsRole,
  skillRolesLabel,
  type AgentAppearance,
  type Tag,
  type Unlock,
} from '@skirm/shared';
import type { Executor } from '../client';
import {
  agentSkills,
  agents,
  skillOwnership,
  skillVersions,
  unlockItems,
  v2Matches,
} from '../schema';
import {
  AGENT_SYSTEM_PROMPT_MAX,
  RepoError,
  type AgentView,
  type CrewOwnership,
  type UnlockItemView,
  V2_ROLES,
  V2_TALK_TIERS,
  type V2Role,
  type V2TalkTier,
} from '../types';
import { tx } from './util';

export type AgentRow = typeof agents.$inferSelect;

export const MAX_SKILLS_PER_AGENT = 3;
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} '\-_.]{0,23}$/u;

export interface AgentPatch {
  name?: string;
  skills?: { id: string; version: number }[];
  unlocks?: Unlock[];
  role?: V2Role;
  vision?: number;
  comms?: number;
  tier?: V2TalkTier;
  /** The owner's instructions; null or blank clears them. */
  systemPrompt?: string | null;
}

const isAttr = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 5;

export class AgentsRepo {
  constructor(private readonly db: Executor) {}

  async get(id: string): Promise<AgentRow | undefined> {
    const [row] = await this.db.select().from(agents).where(eq(agents.id, id));
    return row;
  }

  async listByOwner(ownerId: string): Promise<AgentView[]> {
    const rows = await this.db
      .select()
      .from(agents)
      .where(eq(agents.ownerId, ownerId))
      .orderBy(asc(agents.createdAt), asc(agents.id));
    return this.views(rows);
  }

  async view(id: string): Promise<AgentView | undefined> {
    const row = await this.get(id);
    if (!row) return undefined;
    const [v] = await this.views([row]);
    return v;
  }

  private async views(rows: AgentRow[]): Promise<AgentView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const equipped = await this.db
      .select({
        agentId: agentSkills.agentId,
        slot: agentSkills.slot,
        id: agentSkills.skillId,
        version: agentSkills.version,
        name: skillVersions.name,
      })
      .from(agentSkills)
      .innerJoin(
        skillVersions,
        and(
          eq(skillVersions.skillId, agentSkills.skillId),
          eq(skillVersions.version, agentSkills.version),
        ),
      )
      .where(inArray(agentSkills.agentId, ids))
      .orderBy(asc(agentSkills.slot));
    const unlocks = await this.db
      .select({ agentId: unlockItems.attachedAgentId, kind: unlockItems.kind })
      .from(unlockItems)
      .where(inArray(unlockItems.attachedAgentId, ids));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      elo: r.elo,
      matchesPlayed: r.matchesPlayed,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
      skills: equipped
        .filter((s) => s.agentId === r.id)
        .map((s) => ({ id: s.id, version: s.version, name: s.name })),
      unlocks: sortUnlocks(unlocks.filter((u) => u.agentId === r.id).map((u) => u.kind)),
      role: (V2_ROLES as readonly string[]).includes(r.role) ? (r.role as V2Role) : 'Runner',
      vision: r.vision,
      comms: r.comms,
      tier: (V2_TALK_TIERS as readonly string[]).includes(r.tier) ? (r.tier as V2TalkTier) : 'standard',
      systemPrompt: r.systemPrompt ?? null,
      appearance: appearanceOr(r.appearance, r.id),
      progression: progressionOf(r.xp, r.traits),
    }));
  }

  /**
   * The owner picks a trait for an agent (one per trait level reached, each once, at most
   * DEFAULTS.progression.maxTraits). Refused while the agent is in a live match, so a crew plays the
   * traits it queued with. Kept in pick order; a match plays them in catalogue order.
   */
  async pickTrait(ownerId: string, agentId: string, trait: string): Promise<AgentView> {
    if (!isTraitId(trait)) throw new RepoError('invalid_trait', 'no such trait');
    await tx(this.db, async (t) => {
      const [agent] = await t
        .select()
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
        .for('update');
      if (!agent) throw new RepoError('not_found', 'agent not found');
      if ((await new AgentsRepo(t).busyAgents([agentId])).length > 0)
        throw new RepoError('agent_busy', 'agent is in a live match');
      const why = traitPickError(progressionOf(agent.xp, agent.traits), trait);
      if (why) throw new RepoError(why.includes('already') ? 'trait_taken' : 'no_trait_slot', why);
      await t
        .update(agents)
        .set({ traits: [...(agent.traits ?? []), trait] })
        .where(eq(agents.id, agentId));
    });
    return (await this.view(agentId))!;
  }

  async unlocksOf(ownerId: string): Promise<UnlockItemView[]> {
    const rows = await this.db
      .select({
        id: unlockItems.id,
        kind: unlockItems.kind,
        attachedAgentId: unlockItems.attachedAgentId,
      })
      .from(unlockItems)
      .where(eq(unlockItems.ownerId, ownerId))
      .orderBy(asc(unlockItems.createdAt), asc(unlockItems.id));
    return rows;
  }

  /**
   * Agent ids among `agentIds` that are in a crew of a live v2 match (v2_matches.crews A or B).
   * `exceptMatch` leaves one match out: a crew changed at lock-in may keep the agents it queued with.
   */
  async busyAgents(
    agentIds: readonly string[],
    opts: { exceptMatch?: string } = {},
  ): Promise<string[]> {
    if (agentIds.length === 0) return [];
    const busy = new Set<string>();
    const live = await this.db
      .select({ crews: v2Matches.crews })
      .from(v2Matches)
      .where(
        and(
          eq(v2Matches.status, 'live'),
          opts.exceptMatch !== undefined ? ne(v2Matches.id, opts.exceptMatch) : undefined,
          or(
            ...agentIds.flatMap((id) => {
              const member = JSON.stringify([{ id }]);
              return [
                sql`(${v2Matches.crews} -> 'A') @> ${member}::jsonb`,
                sql`(${v2Matches.crews} -> 'B') @> ${member}::jsonb`,
              ];
            }),
          ),
        ),
      );
    for (const m of live)
      for (const c of [...(m.crews?.A ?? []), ...(m.crews?.B ?? [])])
        if (agentIds.includes(c.id)) busy.add(c.id);
    return [...busy];
  }

  /**
   * PATCH /agents/:id. Refused while the agent plays a live v2 match. Skills must be owned (≤3,
   * no duplicates). Unlocks: the agent ends with exactly this set; free items of the account are
   * attached first, then items moved from the owner's idle agents.
   */
  /**
   * Change how the agent looks. Cosmetic only, so unlike `update` it is allowed while the agent is
   * in a match: the 3D board picks the new look up on the next frame.
   */
  async setAppearance(ownerId: string, agentId: string, appearance: AgentAppearance): Promise<AgentView> {
    if (!isAppearance(appearance)) throw new RepoError('invalid_appearance', 'appearance is not valid');
    const [row] = await this.db
      .update(agents)
      .set({ appearance: { ...appearance } })
      .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
      .returning();
    if (!row) throw new RepoError('not_found', 'agent not found');
    const [v] = await this.views([row]);
    return v!;
  }

  async update(ownerId: string, agentId: string, patch: AgentPatch): Promise<AgentView> {
    return tx(this.db, async (t) => {
      const [agent] = await t
        .select()
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
        .for('update');
      if (!agent) throw new RepoError('not_found', 'agent not found');
      const repo = new AgentsRepo(t);
      if ((await repo.busyAgents([agentId])).length > 0)
        throw new RepoError('agent_busy', 'agent is in a live match');

      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!NAME_RE.test(name))
          throw new RepoError('invalid_name', 'name must be 1-24 characters');
        await t.update(agents).set({ name }).where(eq(agents.id, agentId));
      }

      if (patch.role !== undefined && !(V2_ROLES as readonly string[]).includes(patch.role))
        throw new RepoError('invalid_role', `role must be one of ${V2_ROLES.join(', ')}`);
      if (patch.tier !== undefined && !(V2_TALK_TIERS as readonly string[]).includes(patch.tier))
        throw new RepoError('invalid_tier', `talk tier must be one of ${V2_TALK_TIERS.join(', ')}`);
      if ((patch.vision !== undefined && !isAttr(patch.vision)) || (patch.comms !== undefined && !isAttr(patch.comms)))
        throw new RepoError('invalid_attribute', 'vision and comms are whole numbers from 1 to 5');
      const prompt = patch.systemPrompt === undefined ? undefined : patch.systemPrompt?.trim() || null;
      if (prompt && [...prompt].length > AGENT_SYSTEM_PROMPT_MAX)
        throw new RepoError('invalid_system_prompt', `instructions are at most ${AGENT_SYSTEM_PROMPT_MAX} characters`);
      const v2 = {
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        ...(patch.vision !== undefined ? { vision: patch.vision } : {}),
        ...(patch.comms !== undefined ? { comms: patch.comms } : {}),
        ...(patch.tier !== undefined ? { tier: patch.tier } : {}),
        ...(prompt !== undefined ? { systemPrompt: prompt } : {}),
      };
      if (Object.keys(v2).length) await t.update(agents).set(v2).where(eq(agents.id, agentId));

      if (patch.skills !== undefined) {
        const list = patch.skills;
        if (list.length > MAX_SKILLS_PER_AGENT)
          throw new RepoError(
            'too_many_skills',
            `at most ${MAX_SKILLS_PER_AGENT} skills per agent`,
          );
        const ids = new Set(list.map((s) => s.id));
        if (ids.size !== list.length)
          throw new RepoError('duplicate_skill', 'a skill is listed twice');
        const owned = await ownedVersionKeys(t, ownerId);
        for (const s of list) {
          if (!owned.has(`${s.id}:${s.version}`))
            throw new RepoError('skill_not_owned', `skill ${s.id} v${s.version} is not owned`, {
              skillId: s.id,
              version: s.version,
            });
        }
        await t.delete(agentSkills).where(eq(agentSkills.agentId, agentId));
        if (list.length > 0)
          await t
            .insert(agentSkills)
            .values(list.map((s, slot) => ({ agentId, slot, skillId: s.id, version: s.version })));
      }

      // Role slots: every skill the agent ends up with must be for its (new) role or any role.
      if (patch.skills !== undefined || (patch.role !== undefined && patch.role !== agent.role))
        await assertSkillsFitRole(t, agentId, patch.role ?? agent.role);

      if (patch.unlocks !== undefined) {
        const want = new Set(patch.unlocks);
        if (want.size !== patch.unlocks.length)
          throw new RepoError('duplicate_unlock', 'an unlock is listed twice');
        const items = await t
          .select()
          .from(unlockItems)
          .where(eq(unlockItems.ownerId, ownerId))
          .orderBy(asc(unlockItems.createdAt), asc(unlockItems.id))
          .for('update');
        // Detach kinds no longer wanted.
        for (const it of items) {
          if (it.attachedAgentId === agentId && !want.has(it.kind)) {
            await t
              .update(unlockItems)
              .set({ attachedAgentId: null })
              .where(eq(unlockItems.id, it.id));
            it.attachedAgentId = null;
          }
        }
        for (const kind of want) {
          if (items.some((it) => it.kind === kind && it.attachedAgentId === agentId)) continue;
          let pick = items.find((it) => it.kind === kind && it.attachedAgentId === null);
          if (!pick) {
            const candidates = items.filter(
              (it) => it.kind === kind && it.attachedAgentId !== null,
            );
            const busy = new Set(await repo.busyAgents(candidates.map((c) => c.attachedAgentId!)));
            pick = candidates.find((c) => !busy.has(c.attachedAgentId!));
          }
          if (!pick)
            throw new RepoError('unlock_unavailable', `no ${kind} unlock available`, {
              unlock: kind,
            });
          await t
            .update(unlockItems)
            .set({ attachedAgentId: agentId })
            .where(eq(unlockItems.id, pick.id));
          pick.attachedAgentId = agentId;
        }
      }

      const [view] = await repo.views([(await repo.get(agentId))!]);
      return view!;
    });
  }

  /** Agents (with attached unlocks) and owned skill versions, for crew validation. */
  async ownershipSnapshot(ownerId: string): Promise<CrewOwnership> {
    const agentRows = await this.db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.ownerId, ownerId));
    const unl = await this.db
      .select({ agentId: unlockItems.attachedAgentId, kind: unlockItems.kind })
      .from(unlockItems)
      .where(eq(unlockItems.ownerId, ownerId));
    const owned = await this.db
      .select({
        id: skillVersions.skillId,
        version: skillVersions.version,
        requiresActions: skillVersions.requiresActions,
        handlesTags: skillVersions.handlesTags,
      })
      .from(skillOwnership)
      .innerJoin(
        skillVersions,
        and(
          eq(skillVersions.skillId, skillOwnership.skillId),
          eq(skillVersions.version, skillOwnership.version),
        ),
      )
      .where(eq(skillOwnership.ownerId, ownerId));
    return {
      agents: agentRows.map((a) => ({
        id: a.id,
        unlocks: sortUnlocks(unl.filter((u) => u.agentId === a.id).map((u) => u.kind)),
      })),
      skills: owned.map((s) => ({
        id: s.id,
        version: s.version,
        requiresActions: s.requiresActions as CrewOwnership['skills'][number]['requiresActions'],
        handlesTags: s.handlesTags as Tag[],
      })),
    };
  }

  /** Items not attached to any agent. */
  async freeUnlocks(ownerId: string): Promise<UnlockItemView[]> {
    return this.db
      .select({
        id: unlockItems.id,
        kind: unlockItems.kind,
        attachedAgentId: unlockItems.attachedAgentId,
      })
      .from(unlockItems)
      .where(and(eq(unlockItems.ownerId, ownerId), isNull(unlockItems.attachedAgentId)));
  }
}

const UNLOCK_ORDER: readonly Unlock[] = ['builder', 'digger', 'firefighter'];
function sortUnlocks(list: Unlock[]): Unlock[] {
  return [...new Set(list)].sort((a, b) => UNLOCK_ORDER.indexOf(a) - UNLOCK_ORDER.indexOf(b));
}

/** Throws `skill_role_mismatch` when a skill equipped on the agent is not for `role` (nor any role). */
async function assertSkillsFitRole(t: Executor, agentId: string, role: string): Promise<void> {
  const rows = await t
    .select({ id: skillVersions.skillId, version: skillVersions.version, name: skillVersions.name, roles: skillVersions.roles })
    .from(agentSkills)
    .innerJoin(
      skillVersions,
      and(eq(skillVersions.skillId, agentSkills.skillId), eq(skillVersions.version, agentSkills.version)),
    )
    .where(eq(agentSkills.agentId, agentId))
    .orderBy(asc(agentSkills.slot));
  const bad = rows.find((r) => !skillFitsRole(r.roles, role));
  if (bad)
    throw new RepoError(
      'skill_role_mismatch',
      `${bad.name} is for ${skillRolesLabel(bad.roles)}, not a ${role}`,
      { skillId: bad.id, version: bad.version, roles: normalizeSkillRoles(bad.roles), role },
    );
}

async function ownedVersionKeys(t: Executor, ownerId: string): Promise<Set<string>> {
  const rows = await t
    .select({ id: skillOwnership.skillId, version: skillOwnership.version })
    .from(skillOwnership)
    .where(eq(skillOwnership.ownerId, ownerId));
  return new Set(rows.map((r) => `${r.id}:${r.version}`));
}
