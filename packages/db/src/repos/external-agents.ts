// External agents (bring your own agent, docs/external-agents.md): a player's own program bound to
// one of their agents. The signing secret is sealed by the caller (the vault) before it gets here,
// and only the sealed form and its sha256 are stored. Usage counters are added at the end of each
// match that asked it for moves.
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../client';
import { newId } from '../ids';
import { agents, externalAgents } from '../schema';
import { RepoError, type SealedSkill } from '../types';
import { isUniqueViolation } from './util';

export type ExternalAgentRow = typeof externalAgents.$inferSelect;

export interface CreateExternalAgentInput {
  name: string;
  agentId: string | null;
  webhookUrl: string | null;
}

export interface ExternalAgentUsage {
  calls: number;
  misses: number;
  /** The latest miss's reason, if this match had one. */
  lastError?: string | null;
  /** The program answered at least once (a pull or a webhook reply). */
  seen?: boolean;
}

/** The vault's sealed form as columns (the secret is sealed like a skill prompt). */
const sealedColumns = (s: SealedSkill) => ({
  secretSha256: s.promptSha256,
  secretCiphertext: s.ciphertext,
  secretIv: s.iv,
  secretAuthTag: s.authTag,
  secretWrappedKey: s.wrappedKey,
  secretKeyId: s.keyId,
});

/** A row's sealed secret, for the vault to open (realtime signs with it). */
export function sealedSecretOf(row: ExternalAgentRow): SealedSkill {
  return {
    promptSha256: row.secretSha256,
    ciphertext: row.secretCiphertext,
    iv: row.secretIv,
    authTag: row.secretAuthTag,
    wrappedKey: row.secretWrappedKey,
    keyId: row.secretKeyId,
  };
}

const agentBound = () => new RepoError('agent_bound', 'that agent is already played by another external agent');

export class ExternalAgentsRepo {
  constructor(private readonly db: Executor) {}

  async get(id: string): Promise<ExternalAgentRow | undefined> {
    const [row] = await this.db.select().from(externalAgents).where(eq(externalAgents.id, id));
    return row;
  }

  async listFor(accountId: string): Promise<ExternalAgentRow[]> {
    return this.db.select().from(externalAgents).where(eq(externalAgents.accountId, accountId)).orderBy(asc(externalAgents.createdAt), asc(externalAgents.id));
  }

  async countFor(accountId: string): Promise<number> {
    const [r] = await this.db.select({ n: count() }).from(externalAgents).where(eq(externalAgents.accountId, accountId));
    return Number(r?.n ?? 0);
  }

  /** The external agents bound to any of these agents, owned by `accountId` (another owner's binding never plays). */
  async boundTo(accountId: string, agentIds: string[]): Promise<ExternalAgentRow[]> {
    if (!agentIds.length) return [];
    return this.db
      .select()
      .from(externalAgents)
      .where(and(eq(externalAgents.accountId, accountId), inArray(externalAgents.agentId, agentIds)));
  }

  /** `agentId` must be the account's own agent. 409 `agent_bound` when another external agent plays it. */
  async create(accountId: string, input: CreateExternalAgentInput, sealed: SealedSkill): Promise<ExternalAgentRow> {
    if (input.agentId) await this.ownAgent(accountId, input.agentId);
    try {
      const [row] = await this.db
        .insert(externalAgents)
        .values({ id: newId('ext'), accountId, name: input.name, agentId: input.agentId, webhookUrl: input.webhookUrl, ...sealedColumns(sealed) })
        .returning();
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) throw agentBound();
      throw err;
    }
  }

  async update(accountId: string, id: string, patch: Partial<CreateExternalAgentInput>): Promise<ExternalAgentRow> {
    const cur = await this.mine(accountId, id);
    if (patch.agentId) await this.ownAgent(accountId, patch.agentId);
    const set: Partial<typeof externalAgents.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.agentId !== undefined) set.agentId = patch.agentId;
    if (patch.webhookUrl !== undefined) set.webhookUrl = patch.webhookUrl;
    if (!Object.keys(set).length) return cur;
    try {
      const [row] = await this.db.update(externalAgents).set(set).where(eq(externalAgents.id, id)).returning();
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) throw agentBound();
      throw err;
    }
  }

  /** A new secret: the old one stops signing and its token stops working at once. */
  async rotate(accountId: string, id: string, sealed: SealedSkill, now = new Date()): Promise<ExternalAgentRow> {
    await this.mine(accountId, id);
    const [row] = await this.db
      .update(externalAgents)
      .set({ ...sealedColumns(sealed), rotatedAt: now })
      .where(eq(externalAgents.id, id))
      .returning();
    return row!;
  }

  async remove(accountId: string, id: string): Promise<void> {
    await this.mine(accountId, id);
    await this.db.delete(externalAgents).where(eq(externalAgents.id, id));
  }

  /** Adds one match's numbers to the counters. */
  async recordUsage(id: string, u: ExternalAgentUsage, now = new Date()): Promise<void> {
    if (!u.calls && !u.misses && !u.seen) return;
    await this.db
      .update(externalAgents)
      .set({
        calls: sql`${externalAgents.calls} + ${u.calls}`,
        misses: sql`${externalAgents.misses} + ${u.misses}`,
        ...(u.lastError ? { lastError: u.lastError.slice(0, 200) } : {}),
        ...(u.seen ? { lastSeenAt: now } : {}),
      })
      .where(eq(externalAgents.id, id));
  }

  /** The program reached the pull api with its token. */
  async touch(id: string, now = new Date()): Promise<void> {
    await this.db.update(externalAgents).set({ lastSeenAt: now }).where(eq(externalAgents.id, id));
  }

  private async mine(accountId: string, id: string): Promise<ExternalAgentRow> {
    const row = await this.get(id);
    if (!row || row.accountId !== accountId) throw new RepoError('not_found', 'external agent not found');
    return row;
  }

  private async ownAgent(accountId: string, agentId: string): Promise<void> {
    const [a] = await this.db.select({ ownerId: agents.ownerId }).from(agents).where(eq(agents.id, agentId));
    if (!a || a.ownerId !== accountId) throw new RepoError('not_found', 'agent not found');
  }
}
