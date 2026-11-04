// Skills and their immutable versions (Spec §9). Only ciphertext is stored; the public view never
// includes it, and `loadSealed` is for the vault (runner decrypt, creator read-back) only.
import { and, desc, eq, inArray, isNotNull, isNull, lt, max, ne, or, sql } from 'drizzle-orm';
import { normalizeSkillRoles, type SkillRole, type Tag } from '@skirm/shared';
import type { Executor } from '../client';
import { newId } from '../ids';
import { accounts, agentSkills, agents, skillOwnership, skillVersions, skills } from '../schema';
import { RepoError, type SealedSkill } from '../types';
import { tx } from './util';

export type SkillStatusName = 'draft' | 'minted' | 'listed';
export type RequiredAction = 'place_block' | 'dig' | 'extinguish';

export interface SkillMetaInput {
  name: string;
  summary?: string | null;
  requiresActions: RequiredAction[];
  handlesTags: Tag[];
  /** Agent roles that may equip it; omitted or empty = any role. */
  roles?: readonly SkillRole[];
  royaltyBps: number;
}

/** Public fields of one skill version (never prompt or reflexes, never ciphertext). */
export interface SkillVersionView {
  id: string;
  version: number;
  name: string;
  summary: string | null;
  creatorId: string;
  creatorHandle: string;
  creatorNear: string | null;
  accountBound: boolean;
  royaltyBps: number;
  requiresActions: RequiredAction[];
  handlesTags: Tag[];
  /** `['any']` or the agent roles that may equip this version. */
  roles: SkillRole[];
  promptSha256: string;
  status: SkillStatusName;
  tokenId: string | null;
  mintedAt: Date | null;
  createdAt: Date;
  /** Latest version of the skill. */
  latestVersion: number;
}

const versionColumns = {
  id: skillVersions.skillId,
  version: skillVersions.version,
  name: skillVersions.name,
  summary: skillVersions.summary,
  creatorId: skills.creatorId,
  creatorHandle: accounts.handle,
  creatorNear: accounts.nearAccountId,
  accountBound: skills.accountBound,
  royaltyBps: skillVersions.royaltyBps,
  requiresActions: skillVersions.requiresActions,
  handlesTags: skillVersions.handlesTags,
  roles: skillVersions.roles,
  promptSha256: skillVersions.promptSha256,
  status: skillVersions.status,
  tokenId: skillVersions.tokenId,
  mintedAt: skillVersions.mintedAt,
  createdAt: skillVersions.createdAt,
  latestVersion:
    sql<number>`(select max(v2.version) from skill_versions v2 where v2.skill_id = ${skillVersions.skillId})`.mapWith(
      Number,
    ),
};

type VersionRow = { [K in keyof typeof versionColumns]: unknown };
const toView = (r: VersionRow) => r as unknown as SkillVersionView;

export class SkillsRepo {
  constructor(private readonly db: Executor) {}

  /** POST /skills: a new skill with version 1 as a draft. */
  async create(
    creatorId: string,
    meta: SkillMetaInput,
    sealed: SealedSkill,
  ): Promise<SkillVersionView> {
    const id = newId('skl');
    await tx(this.db, async (t) => {
      await t.insert(skills).values({
        id,
        creatorId,
        name: meta.name,
        summary: meta.summary ?? null,
        accountBound: false,
      });
      await insertVersion(t, id, 1, meta, sealed);
      await t.insert(skillOwnership).values({ skillId: id, version: 1, ownerId: creatorId });
    });
    return (await this.get(id, 1))!;
  }

  /** PUT /skills/:id: the next version as a draft (versions are immutable). Creator only. */
  async createVersion(
    skillId: string,
    creatorId: string,
    meta: SkillMetaInput,
    sealed: SealedSkill,
  ): Promise<SkillVersionView> {
    const version = await tx(this.db, async (t) => {
      const [skill] = await t.select().from(skills).where(eq(skills.id, skillId)).for('update');
      if (!skill) throw new RepoError('not_found', 'skill not found');
      if (skill.creatorId !== creatorId)
        throw new RepoError('forbidden', 'only the creator can edit a skill');
      if (skill.accountBound) throw new RepoError('forbidden', 'starter skills cannot be edited');
      const [{ v } = { v: 0 }] = await t
        .select({ v: max(skillVersions.version) })
        .from(skillVersions)
        .where(eq(skillVersions.skillId, skillId));
      const next = (v ?? 0) + 1;
      // `skills.name/summary` track the latest version for skill-level lists; every version keeps
      // the name and summary it was published with, so a minted v1 never changes.
      await t
        .update(skills)
        .set({ name: meta.name, summary: meta.summary ?? null })
        .where(eq(skills.id, skillId));
      await insertVersion(t, skillId, next, meta, sealed);
      await t.insert(skillOwnership).values({ skillId, version: next, ownerId: creatorId });
      return next;
    });
    return (await this.get(skillId, version))!;
  }

  /** One version (latest when `version` is omitted). */
  async get(skillId: string, version?: number): Promise<SkillVersionView | undefined> {
    const rows = await this.db
      .select(versionColumns)
      .from(skillVersions)
      .innerJoin(skills, eq(skills.id, skillVersions.skillId))
      .innerJoin(accounts, eq(accounts.id, skills.creatorId))
      .where(
        version === undefined
          ? eq(skillVersions.skillId, skillId)
          : and(eq(skillVersions.skillId, skillId), eq(skillVersions.version, version)),
      )
      .orderBy(desc(skillVersions.version))
      .limit(1);
    return rows[0] ? toView(rows[0]) : undefined;
  }

  async getMany(keys: readonly { id: string; version: number }[]): Promise<SkillVersionView[]> {
    if (keys.length === 0) return [];
    const ids = [...new Set(keys.map((k) => k.id))];
    const rows = await this.db
      .select(versionColumns)
      .from(skillVersions)
      .innerJoin(skills, eq(skills.id, skillVersions.skillId))
      .innerJoin(accounts, eq(accounts.id, skills.creatorId))
      .where(inArray(skillVersions.skillId, ids));
    const want = new Set(keys.map((k) => `${k.id}:${k.version}`));
    return rows.map(toView).filter((r) => want.has(`${r.id}:${r.version}`));
  }

  /** Ciphertext for the vault. Callers decrypt only inside the runner or for the creator. */
  async loadSealed(skillId: string, version: number): Promise<SealedSkill | undefined> {
    const [row] = await this.db
      .select({
        ciphertext: skillVersions.ciphertext,
        iv: skillVersions.iv,
        authTag: skillVersions.authTag,
        wrappedKey: skillVersions.wrappedKey,
        keyId: skillVersions.keyId,
        promptSha256: skillVersions.promptSha256,
      })
      .from(skillVersions)
      .where(and(eq(skillVersions.skillId, skillId), eq(skillVersions.version, version)));
    return row;
  }

  /** Latest version of each skill the account wrote ("written" tab). */
  async listWritten(creatorId: string): Promise<SkillVersionView[]> {
    const rows = await this.db
      .select(versionColumns)
      .from(skillVersions)
      .innerJoin(skills, eq(skills.id, skillVersions.skillId))
      .innerJoin(accounts, eq(accounts.id, skills.creatorId))
      .where(eq(skills.creatorId, creatorId))
      .orderBy(desc(skillVersions.createdAt), desc(skillVersions.version));
    const seen = new Set<string>();
    return rows.map(toView).filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  }

  /** Versions the account holds ("owned" tab): bought tokens, its own versions and starter skills. */
  async listOwned(ownerId: string): Promise<SkillVersionView[]> {
    const rows = await this.db
      .select(versionColumns)
      .from(skillOwnership)
      .innerJoin(
        skillVersions,
        and(
          eq(skillVersions.skillId, skillOwnership.skillId),
          eq(skillVersions.version, skillOwnership.version),
        ),
      )
      .innerJoin(skills, eq(skills.id, skillVersions.skillId))
      .innerJoin(accounts, eq(accounts.id, skills.creatorId))
      .where(eq(skillOwnership.ownerId, ownerId))
      .orderBy(desc(skillVersions.createdAt));
    return rows.map(toView);
  }

  async owns(ownerId: string, skillId: string, version: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: skillOwnership.id })
      .from(skillOwnership)
      .where(
        and(
          eq(skillOwnership.ownerId, ownerId),
          eq(skillOwnership.skillId, skillId),
          eq(skillOwnership.version, version),
        ),
      );
    return !!row;
  }

  /**
   * Takes the mint of a draft version for one request: true when this caller holds it now. A claim
   * older than `staleMs` (a request that died mid-mint) can be taken again.
   */
  async claimMint(skillId: string, version: number, staleMs = 120_000, now = new Date()): Promise<boolean> {
    const rows = await this.db
      .update(skillVersions)
      .set({ mintClaimedAt: now })
      .where(
        and(
          eq(skillVersions.skillId, skillId),
          eq(skillVersions.version, version),
          eq(skillVersions.status, 'draft'),
          or(isNull(skillVersions.mintClaimedAt), lt(skillVersions.mintClaimedAt, new Date(now.getTime() - staleMs))),
        ),
      )
      .returning({ version: skillVersions.version });
    return rows.length === 1;
  }

  /** Gives a claimed mint back (the chain call failed and nothing was minted). */
  async releaseMint(skillId: string, version: number): Promise<void> {
    await this.db
      .update(skillVersions)
      .set({ mintClaimedAt: null })
      .where(
        and(eq(skillVersions.skillId, skillId), eq(skillVersions.version, version), eq(skillVersions.status, 'draft')),
      );
  }

  /** After nft_mint: version minted with its token; the creator holds it. */
  async markMinted(
    skillId: string,
    version: number,
    tokenId: string,
    at = new Date(),
  ): Promise<void> {
    await tx(this.db, async (t) => {
      const [row] = await t
        .select({
          status: skillVersions.status,
          bound: skills.accountBound,
          creatorId: skills.creatorId,
        })
        .from(skillVersions)
        .innerJoin(skills, eq(skills.id, skillVersions.skillId))
        .where(and(eq(skillVersions.skillId, skillId), eq(skillVersions.version, version)))
        .for('update');
      if (!row) throw new RepoError('not_found', 'skill version not found');
      if (row.bound) throw new RepoError('forbidden', 'account-bound skills are never minted');
      if (row.status !== 'draft') return;
      await t
        .update(skillVersions)
        .set({ status: 'minted', tokenId, mintedAt: at, mintClaimedAt: null })
        .where(and(eq(skillVersions.skillId, skillId), eq(skillVersions.version, version)));
      await t
        .update(skillOwnership)
        .set({ tokenId, refreshedAt: at })
        .where(
          and(
            eq(skillOwnership.skillId, skillId),
            eq(skillOwnership.version, version),
            eq(skillOwnership.ownerId, row.creatorId),
          ),
        );
    });
  }

  async setStatus(skillId: string, version: number, status: SkillStatusName): Promise<void> {
    await this.db
      .update(skillVersions)
      .set({ status })
      .where(and(eq(skillVersions.skillId, skillId), eq(skillVersions.version, version)));
  }

  async byToken(tokenId: string): Promise<SkillVersionView | undefined> {
    const [row] = await this.db
      .select(versionColumns)
      .from(skillVersions)
      .innerJoin(skills, eq(skills.id, skillVersions.skillId))
      .innerJoin(accounts, eq(accounts.id, skills.creatorId))
      .where(eq(skillVersions.tokenId, tokenId));
    return row ? toView(row) : undefined;
  }

  /**
   * Owner cache refresh (OwnershipReader): the token now belongs to `ownerNear`, mapped to
   * `ownerId` when that NEAR account is linked to an account. Agents of anyone else lose the
   * version from their slots.
   */
  async setTokenOwner(
    tokenId: string,
    ownerId: string | null,
    ownerNear: string | null,
  ): Promise<void> {
    await tx(this.db, async (t) => {
      const [ver] = await t
        .select({ skillId: skillVersions.skillId, version: skillVersions.version })
        .from(skillVersions)
        .where(eq(skillVersions.tokenId, tokenId));
      if (!ver) throw new RepoError('not_found', `no skill version for token ${tokenId}`);
      await t
        .delete(skillOwnership)
        .where(and(eq(skillOwnership.tokenId, tokenId), isNotNull(skillOwnership.tokenId)));
      await t
        .insert(skillOwnership)
        .values({ skillId: ver.skillId, version: ver.version, tokenId, ownerId, ownerNear })
        .onConflictDoUpdate({
          target: [skillOwnership.skillId, skillOwnership.version, skillOwnership.ownerId],
          set: { tokenId, ownerNear, refreshedAt: new Date() },
        });
      await unequipOthers(t, ver.skillId, ver.version, ownerId);
    });
  }

  /** Every listed or minted public version (market source). */
  async listPublic(): Promise<SkillVersionView[]> {
    const rows = await this.db
      .select(versionColumns)
      .from(skillVersions)
      .innerJoin(skills, eq(skills.id, skillVersions.skillId))
      .innerJoin(accounts, eq(accounts.id, skills.creatorId))
      .where(inArray(skillVersions.status, ['minted', 'listed']))
      .orderBy(desc(skillVersions.createdAt));
    return rows.map(toView);
  }
}

/**
 * Removes a skill version from the slots of agents not owned by `ownerId` (every agent when the
 * token's owner maps to no account). Runs inside a sale or an owner refresh.
 */
export async function unequipOthers(
  t: Executor,
  skillId: string,
  version: number,
  ownerId: string | null,
): Promise<void> {
  const others = t
    .select({ id: agents.id })
    .from(agents)
    .where(ownerId === null ? sql`true` : ne(agents.ownerId, ownerId));
  await t
    .delete(agentSkills)
    .where(
      and(eq(agentSkills.skillId, skillId), eq(agentSkills.version, version), inArray(agentSkills.agentId, others)),
    );
}

async function insertVersion(
  t: Executor,
  skillId: string,
  version: number,
  meta: SkillMetaInput,
  sealed: SealedSkill,
): Promise<void> {
  await t.insert(skillVersions).values({
    skillId,
    version,
    name: meta.name,
    summary: meta.summary ?? null,
    requiresActions: [...meta.requiresActions],
    handlesTags: [...meta.handlesTags],
    roles: normalizeSkillRoles(meta.roles),
    royaltyBps: meta.royaltyBps,
    promptSha256: sealed.promptSha256,
    ciphertext: sealed.ciphertext,
    iv: sealed.iv,
    authTag: sealed.authTag,
    wrappedKey: sealed.wrappedKey,
    keyId: sealed.keyId,
    status: 'draft',
  });
}
