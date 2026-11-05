// Accounts and the new-account defaults (contract: 3 agents, starter unlocks, Flood Warden on Rook,
// 60 free credits a day).
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { DEFAULTS } from '@skirm/shared';
import type { Executor } from '../client';
import { newId } from '../ids';
import {
  accounts,
  achievementsUnlocked,
  agentSkills,
  campaignProgress,
  campaignRewards,
  puzzleBests,
  puzzleRuns,
  agents,
  cosmeticsOwned,
  eloDecays,
  ledgerAccounts,
  ledgerRows,
  listings,
  matchMessages,
  onboardingProgress,
  playbooks,
  prizePayouts,
  questClaims,
  rentalOffers,
  rentals,
  sales,
  seasonStandings,
  skillOwnership,
  skillBenchRuns,
  skillTrials,
  skillVersions,
  skills,
  unlockItems,
  v2Matches,
} from '../schema';

/** A deleted account's handle: no sign-in can match it (dev handles start with a letter or digit). */
export const deletedHandle = (accountId: string) => `~deleted-${accountId.slice(-8).toLowerCase()}`;
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

  /** Sign-in lookup. Never resolves to a platform (system) account or a deleted one. */
  private async find(user: SignInUser): Promise<AccountRow | undefined> {
    const row = user.privyDid
      ? await this.byPrivyDid(user.privyDid)
      : await this.byHandle(user.handle);
    return row && !row.system && !row.deletedAt ? row : undefined;
  }

  /**
   * Deletes a player's account as the privacy policy says: the sign-in (Privy id), the NEAR link and
   * the system prompts and crew playbooks go, rental offers end, and the handle becomes `~deleted-<id>` (no sign-in can
   * match it). Agents, skills, match history, sales and the ledger stay, because other players' records
   * and paid rental passes depend on them; the account never signs in again (`deleted_at`).
   * The caller refuses a live match or an open listing first.
   */
  async deleteAccount(accountId: string, now = new Date()): Promise<AccountRow> {
    return tx(this.db, async (t) => {
      const [row] = await t
        .update(accounts)
        .set({ handle: deletedHandle(accountId), privyDid: null, nearAccountId: null, deletedAt: now })
        .where(and(eq(accounts.id, accountId), eq(accounts.system, false), isNull(accounts.deletedAt)))
        .returning();
      if (!row) throw new RepoError('not_found', 'account not found');
      await t.update(agents).set({ systemPrompt: null }).where(eq(agents.ownerId, accountId));
      await t.delete(playbooks).where(eq(playbooks.ownerId, accountId));
      await t.update(rentalOffers).set({ active: false, updatedAt: now }).where(and(eq(rentalOffers.ownerId, accountId), eq(rentalOffers.active, true)));
      return row;
    });
  }

  /**
   * Everything skirm holds about a player, table by table (GET /me/export). Skill prompts stay sealed
   * here; the api decrypts the player's own for the download.
   */
  async exportFor(accountId: string): Promise<Record<string, unknown[]>> {
    const [account] = await this.db.select().from(accounts).where(eq(accounts.id, accountId));
    if (!account) throw new RepoError('not_found', 'account not found');
    const myAgents = await this.db.select().from(agents).where(eq(agents.ownerId, accountId));
    const agentIds = myAgents.map((a) => a.id);
    const [
      agentSkillRows, unlockRows, skillRows, ownership, listingRows, saleRows, offers, rentalRows,
      ledger, ledgerRowsOut, matches, standings, payouts, trials, cosmetics, onboarding, decays, benchRuns, playbookRows,
    ] = await Promise.all([
      this.db.select().from(agentSkills).where(agentIds.length ? inArray(agentSkills.agentId, agentIds) : sql`false`),
      this.db.select().from(unlockItems).where(eq(unlockItems.ownerId, accountId)),
      this.db.select().from(skills).where(eq(skills.creatorId, accountId)),
      this.db.select().from(skillOwnership).where(eq(skillOwnership.ownerId, accountId)),
      this.db.select().from(listings).where(eq(listings.sellerId, accountId)),
      this.db.select().from(sales).where(or(eq(sales.sellerId, accountId), eq(sales.buyerId, accountId))),
      this.db.select().from(rentalOffers).where(eq(rentalOffers.ownerId, accountId)),
      this.db.select().from(rentals).where(or(eq(rentals.ownerId, accountId), eq(rentals.renterId, accountId))),
      this.db.select().from(ledgerAccounts).where(eq(ledgerAccounts.accountId, accountId)),
      this.db.select().from(ledgerRows).where(eq(ledgerRows.accountId, accountId)),
      this.db
        .select({ id: v2Matches.id, mapId: v2Matches.mapId, ranked: v2Matches.ranked, practice: v2Matches.practice, difficulty: v2Matches.difficulty, status: v2Matches.status, teamAAccountId: v2Matches.teamAAccountId, teamBAccountId: v2Matches.teamBAccountId, crews: v2Matches.crews, winner: v2Matches.winner, scoreA: v2Matches.scoreA, scoreB: v2Matches.scoreB, ticks: v2Matches.ticks, debriefs: v2Matches.debriefs, logHash: v2Matches.logHash, createdAt: v2Matches.createdAt, endedAt: v2Matches.endedAt })
        .from(v2Matches)
        .where(or(eq(v2Matches.teamAAccountId, accountId), eq(v2Matches.teamBAccountId, accountId))),
      this.db.select().from(seasonStandings).where(eq(seasonStandings.accountId, accountId)),
      this.db.select().from(prizePayouts).where(eq(prizePayouts.accountId, accountId)),
      this.db.select().from(skillTrials).where(eq(skillTrials.accountId, accountId)),
      this.db.select().from(cosmeticsOwned).where(eq(cosmeticsOwned.accountId, accountId)),
      this.db.select().from(onboardingProgress).where(eq(onboardingProgress.accountId, accountId)),
      this.db.select().from(eloDecays).where(eq(eloDecays.accountId, accountId)),
      // Bench runs, without their sealed prompt drafts (ciphertext is no use to the player).
      this.db
        .select({ id: skillBenchRuns.id, skillId: skillBenchRuns.skillId, version: skillBenchRuns.version, mapId: skillBenchRuns.mapId, difficulty: skillBenchRuns.difficulty, status: skillBenchRuns.status, brain: skillBenchRuns.brain, credits: skillBenchRuns.credits, result: skillBenchRuns.result, createdAt: skillBenchRuns.createdAt, finishedAt: skillBenchRuns.finishedAt })
        .from(skillBenchRuns)
        .where(eq(skillBenchRuns.accountId, accountId)),
      this.db.select().from(playbooks).where(eq(playbooks.ownerId, accountId)),
    ]);
    // A match's debriefs hold both crews' private numbers: keep only the player's own side.
    const ownMatches = matches.map((m) => {
      const side = m.teamAAccountId === accountId ? 'A' : 'B';
      return { ...m, debriefs: m.debriefs?.[side] ? { [side]: m.debriefs[side] } : null };
    });
    const quests = await this.db.select().from(questClaims).where(eq(questClaims.accountId, accountId));
    const achievements = await this.db.select().from(achievementsUnlocked).where(eq(achievementsUnlocked.accountId, accountId));
    const messages = agentIds.length ? await this.db.select().from(matchMessages).where(inArray(matchMessages.agentId, agentIds)) : [];
    const [campaign, campaignRewardRows] = await Promise.all([
      this.db.select().from(campaignProgress).where(eq(campaignProgress.accountId, accountId)),
      this.db.select().from(campaignRewards).where(eq(campaignRewards.accountId, accountId)),
    ]);
    const [puzzleRunRows, puzzleBestRows] = await Promise.all([
      this.db.select().from(puzzleRuns).where(eq(puzzleRuns.accountId, accountId)),
      this.db.select().from(puzzleBests).where(eq(puzzleBests.accountId, accountId)),
    ]);
    return {
      account: [account],
      agents: myAgents,
      agentSkills: agentSkillRows,
      unlockItems: unlockRows,
      skillsCreated: skillRows,
      skillOwnership: ownership,
      listings: listingRows,
      sales: saleRows,
      rentalOffers: offers,
      rentals: rentalRows,
      ledgerAccount: ledger,
      ledgerRows: ledgerRowsOut,
      matches: ownMatches,
      matchMessagesByYourAgents: messages,
      seasonStandings: standings,
      prizePayouts: payouts,
      skillTrials: trials,
      cosmetics,
      questClaims: quests,
      achievements,
      onboarding,
      eloDecays: decays,
      skillBenchRuns: benchRuns,
      playbooks: playbookRows,
      campaign,
      campaignRewards: campaignRewardRows,
      puzzleRuns: puzzleRunRows,
      puzzleBests: puzzleBestRows,
    };
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
