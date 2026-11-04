// Onboarding progress (@skirm/shared TUTORIAL_STEPS, FIRST_STEPS): the tips a player has seen, the
// tutorial's end (finished or skipped) and whether the home checklist was dismissed. The checklist
// items other than the tutorial are facts read from the player's own rows, never stored twice.
import { and, eq, or, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { agentSkills, agents, onboardingProgress, skills, v2Matches } from '../schema';

export type OnboardingRow = typeof onboardingProgress.$inferSelect;

/** What the checklist reads from the player's matches, skills and agents. */
export interface OnboardingFacts {
  /** An ended practice match against the bot (the guided match counts). */
  practiced: boolean;
  /** A skill this player wrote (a draft is enough). */
  wroteSkill: boolean;
  /** One of their agents carries a skill they wrote. */
  equippedOwnSkill: boolean;
  /** An ended casual or ranked match against another player. */
  playedPvp: boolean;
}

export class OnboardingRepo {
  constructor(private readonly db: Executor) {}

  /** The player's row, or the defaults of a player who has seen nothing (not stored). */
  async get(accountId: string): Promise<OnboardingRow> {
    const [row] = await this.db
      .select()
      .from(onboardingProgress)
      .where(eq(onboardingProgress.accountId, accountId));
    return (
      row ?? {
        accountId,
        tutorialStep: 0,
        tutorialCompletedAt: null,
        tutorialSkippedAt: null,
        checklistDismissedAt: null,
        updatedAt: new Date(0),
      }
    );
  }

  /** Records tips seen: the step only grows, so a stale tab cannot move it back. */
  async seen(accountId: string, step: number, now = new Date()): Promise<OnboardingRow> {
    return this.upsert(accountId, { tutorialStep: step }, now, {
      tutorialStep: sql`greatest(${onboardingProgress.tutorialStep}, ${step})`,
    });
  }

  /** The tutorial ended: finished (`done`, every tip seen) or skipped. The first end sticks. */
  async end(accountId: string, how: 'done' | 'skipped', totalSteps: number, now = new Date()): Promise<OnboardingRow> {
    if (how === 'done')
      return this.upsert(accountId, { tutorialStep: totalSteps, tutorialCompletedAt: now }, now, {
        tutorialStep: sql`greatest(${onboardingProgress.tutorialStep}, ${totalSteps})`,
        tutorialCompletedAt: sql`coalesce(${onboardingProgress.tutorialCompletedAt}, ${now.toISOString()}::timestamptz)`,
      });
    return this.upsert(accountId, { tutorialSkippedAt: now }, now, {
      tutorialSkippedAt: sql`coalesce(${onboardingProgress.tutorialSkippedAt}, ${now.toISOString()}::timestamptz)`,
    });
  }

  /** Plays the tutorial again from the first tip (a finished one stays finished). */
  async restart(accountId: string, now = new Date()): Promise<OnboardingRow> {
    return this.upsert(accountId, { tutorialStep: 0 }, now, { tutorialStep: 0, tutorialSkippedAt: null });
  }

  /** Hides the home checklist for good. */
  async dismissChecklist(accountId: string, now = new Date()): Promise<OnboardingRow> {
    return this.upsert(accountId, { checklistDismissedAt: now }, now, {
      checklistDismissedAt: sql`coalesce(${onboardingProgress.checklistDismissedAt}, ${now.toISOString()}::timestamptz)`,
    });
  }

  async facts(accountId: string): Promise<OnboardingFacts> {
    const exists = async (q: Promise<unknown[]>) => (await q).length > 0;
    const ended = (practice: boolean) =>
      this.db
        .select({ id: v2Matches.id })
        .from(v2Matches)
        .where(
          and(
            eq(v2Matches.status, 'ended'),
            eq(v2Matches.practice, practice),
            or(eq(v2Matches.teamAAccountId, accountId), eq(v2Matches.teamBAccountId, accountId)),
          ),
        )
        .limit(1);
    const [practiced, wroteSkill, equippedOwnSkill, playedPvp] = await Promise.all([
      exists(ended(true)),
      exists(
        this.db
          .select({ id: skills.id })
          .from(skills)
          .where(and(eq(skills.creatorId, accountId), eq(skills.accountBound, false)))
          .limit(1),
      ),
      exists(
        this.db
          .select({ id: agentSkills.agentId })
          .from(agentSkills)
          .innerJoin(agents, eq(agents.id, agentSkills.agentId))
          .innerJoin(skills, eq(skills.id, agentSkills.skillId))
          .where(and(eq(agents.ownerId, accountId), eq(skills.creatorId, accountId)))
          .limit(1),
      ),
      exists(ended(false)),
    ]);
    return { practiced, wroteSkill, equippedOwnSkill, playedPvp };
  }

  private async upsert(
    accountId: string,
    insert: Partial<Omit<OnboardingRow, 'accountId' | 'updatedAt'>>,
    now: Date,
    set: Record<string, unknown>,
  ): Promise<OnboardingRow> {
    const [row] = await this.db
      .insert(onboardingProgress)
      .values({ accountId, ...insert, updatedAt: now })
      .onConflictDoUpdate({ target: onboardingProgress.accountId, set: { ...set, updatedAt: now } })
      .returning();
    return row!;
  }
}
