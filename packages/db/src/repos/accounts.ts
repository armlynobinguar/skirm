// Accounts and the new-account defaults (contract: 3 agents, starter unlocks, Flood Warden on Rook,
// 60 free credits a day).
import { and, eq } from 'drizzle-orm';
import { DEFAULTS } from '@skirm/shared';
import type { Executor } from '../client';
import { newId } from '../ids';
import {
  accounts,
  agentSkills,
  agents,
  ledgerAccounts,
  skillOwnership,
  skillVersions,
  skills,
  unlockItems,
} from '../schema';
import {
  STARTER_AGENT_NAMES,
  STARTER_SKILL,
  STARTER_SKILL_TEXT,
  STARTER_UNLOCKS,
  SYSTEM_ACCOUNT_ID,
  SYSTEM_HANDLE,
} from '../starter';
import { RepoError, type SkillSealer } from '../types';
import { isUniqueViolation, tx } from './util';

export type AccountRow = typeof accounts.$inferSelect;

export interface SignInUser {
  handle: string;
  privyDid?: string;
}

export class AccountsRepo {
  constructor(private readonly db: Executor) {}

  async get(id: string): Promise<AccountRow | undefined> {
    const [row] = await this.db.select().from(accounts).where(eq(accounts.id, id));
    return row;
  }

  async byHandle(handle: string): Promise<AccountRow | undefined> {
    const [row] = await this.db.select().from(accounts).where(eq(accounts.handle, handle));
    return row;
  }

  async byPrivyDid(did: string): Promise<AccountRow | undefined> {
    const [row] = await this.db.select().from(accounts).where(eq(accounts.privyDid, did));
    return row;
  }

  async byNearAccount(nearAccountId: string): Promise<AccountRow | undefined> {
    const [row] = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.nearAccountId, nearAccountId), eq(accounts.system, false)));
    return row;
  }

  /** Sign-in lookup. Never resolves to a platform (system) account. */
  private async find(user: SignInUser): Promise<AccountRow | undefined> {
    const row = user.privyDid
      ? await this.byPrivyDid(user.privyDid)
      : await this.byHandle(user.handle);
    return row && !row.system ? row : undefined;
  }

  /**
   * Returns the account for a signed-in user, creating it with the new-account defaults on first
   * sign-in. `sealer` encrypts the starter skill the first time any account is created.
   */
  async getOrCreate(
    user: SignInUser,
    sealer: SkillSealer,
  ): Promise<{ account: AccountRow; created: boolean }> {
    // The system account creates the starter skill, so signing in as it would hand out the
    // creator read-back of Flood Warden's prompt. Its handle is not a valid login anywhere.
    if (user.handle === SYSTEM_HANDLE)
      throw new RepoError('forbidden', 'this handle is reserved for the platform');
    const existing = await this.find(user);
    if (existing) return { account: existing, created: false };
    // Seal outside the transaction (KMS calls can be slow); only used if the skill is missing.
    const starterExists = await this.starterSkillExists();
    const sealed = starterExists
      ? undefined
      : await sealer.encryptSkill(STARTER_SKILL_TEXT.prompt, STARTER_SKILL_TEXT.reflexes);
    try {
      const account = await tx(this.db, async (t) => {
        if (sealed) await ensureStarterSkill(t, sealed);
        return createAccountWithDefaults(t, user);
      });
      return { account, created: true };
    } catch (err) {
      if (isUniqueViolation(err)) {
        const raced = await this.find(user);
        if (raced) return { account: raced, created: false };
      }
      throw err;
    }
  }

  async starterSkillExists(): Promise<boolean> {
    const [row] = await this.db
      .select({ v: skillVersions.version })
      .from(skillVersions)
      .where(
        and(
          eq(skillVersions.skillId, STARTER_SKILL.id),
          eq(skillVersions.version, STARTER_SKILL.version),
        ),
      );
    return !!row;
  }

  /** Links a NEAR account; `taken` when another player already holds it (unique accounts_near_uq). */
  async linkNearAccount(
    id: string,
    nearAccountId: string,
  ): Promise<{ ok: true } | { ok: false; error: 'taken' }> {
    try {
      // A savepoint, so a refused link inside a caller's transaction does not abort it.
      await tx(this.db, (t) => t.update(accounts).set({ nearAccountId }).where(eq(accounts.id, id)));
      return { ok: true };
    } catch (err) {
      if (isUniqueViolation(err)) return { ok: false, error: 'taken' };
      throw err;
    }
  }

  /** Clears the linked NEAR account (DELETE /me/near; the api checks what forbids it first). */
  async unlinkNearAccount(id: string): Promise<AccountRow | undefined> {
    const [row] = await this.db
      .update(accounts)
      .set({ nearAccountId: null })
      .where(eq(accounts.id, id))
      .returning();
    return row;
  }
}

/** System account + Flood Warden v1 (idempotent; fixed ids, so concurrent creators converge). */
async function ensureStarterSkill(
  t: Executor,
  sealed: Awaited<ReturnType<SkillSealer['encryptSkill']>>,
): Promise<void> {
  await t
    .insert(accounts)
    .values({ id: SYSTEM_ACCOUNT_ID, handle: SYSTEM_HANDLE, system: true })
    .onConflictDoNothing();
  await t
    .insert(skills)
    .values({
      id: STARTER_SKILL.id,
      creatorId: SYSTEM_ACCOUNT_ID,
      name: STARTER_SKILL.name,
      summary: STARTER_SKILL.summary,
      accountBound: true,
    })
    .onConflictDoNothing();
  await t
    .insert(skillVersions)
    .values({
      skillId: STARTER_SKILL.id,
      version: STARTER_SKILL.version,
      name: STARTER_SKILL.name,
      summary: STARTER_SKILL.summary,
      requiresActions: [...STARTER_SKILL.requiresActions],
      handlesTags: [...STARTER_SKILL.handlesTags],
      royaltyBps: STARTER_SKILL.royaltyBps,
      promptSha256: sealed.promptSha256,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      authTag: sealed.authTag,
      wrappedKey: sealed.wrappedKey,
      keyId: sealed.keyId,
      status: 'draft',
    })
    .onConflictDoNothing();
}

async function createAccountWithDefaults(t: Executor, user: SignInUser): Promise<AccountRow> {
  const id = newId('acc');
  const [account] = await t
    .insert(accounts)
    .values({
      id,
      handle: user.handle,
      privyDid: user.privyDid ?? null,
    })
    .returning();
  await t.insert(ledgerAccounts).values({
    accountId: id,
    balance: 0,
    held: 0,
    allowanceLeft: DEFAULTS.free.dailyCredits,
    allowanceDay: '',
  });
  const agentRows = STARTER_AGENT_NAMES.map((name) => ({
    id: newId('agt'),
    ownerId: id,
    name,
    elo: DEFAULTS.elo.start,
  }));
  await t.insert(agents).values(agentRows);
  const equipAgent = agentRows.find((a) => a.name === STARTER_SKILL.equipOn)!;
  await t.insert(unlockItems).values(
    STARTER_UNLOCKS.map((kind) => ({
      id: newId('unl'),
      ownerId: id,
      kind,
      attachedAgentId: kind === STARTER_SKILL.unlockOn ? equipAgent.id : null,
      source: 'starter',
    })),
  );
  await t.insert(skillOwnership).values({
    skillId: STARTER_SKILL.id,
    version: STARTER_SKILL.version,
    ownerId: id,
    tokenId: null,
  });
  await t.insert(agentSkills).values({
    agentId: equipAgent.id,
    slot: 0,
    skillId: STARTER_SKILL.id,
    version: STARTER_SKILL.version,
  });
  return account!;
}
