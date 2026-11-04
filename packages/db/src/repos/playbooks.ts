// Crew playbooks: one crew-level strategy per player, sealed like a skill prompt. Only the owner's
// own calls reach a row (every query is by owner); the public view never carries ciphertext, and
// `loadSealed` is for the vault (owner read-back, the match runner) only.
import { and, asc, count, eq } from 'drizzle-orm';
import { DEFAULTS } from '@skirm/shared';
import type { Executor } from '../client';
import { newId } from '../ids';
import { accounts, playbooks } from '../schema';
import { RepoError, type SealedPlaybook } from '../types';
import { tx } from './util';

/** A playbook without its text. */
export interface PlaybookView {
  id: string;
  name: string;
  selected: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const viewColumns = {
  id: playbooks.id,
  name: playbooks.name,
  selected: playbooks.selected,
  createdAt: playbooks.createdAt,
  updatedAt: playbooks.updatedAt,
};

const sealedValues = (s: SealedPlaybook) => ({
  textSha256: s.promptSha256,
  ciphertext: s.ciphertext,
  iv: s.iv,
  authTag: s.authTag,
  wrappedKey: s.wrappedKey,
  keyId: s.keyId,
});

export class PlaybooksRepo {
  constructor(private readonly db: Executor) {}

  /** The player's playbooks, oldest first. */
  async list(ownerId: string): Promise<PlaybookView[]> {
    return this.db.select(viewColumns).from(playbooks).where(eq(playbooks.ownerId, ownerId)).orderBy(asc(playbooks.createdAt), asc(playbooks.id));
  }

  /** One of the player's playbooks (undefined when it is not theirs). */
  async get(ownerId: string, id: string): Promise<PlaybookView | undefined> {
    const [row] = await this.db.select(viewColumns).from(playbooks).where(and(eq(playbooks.id, id), eq(playbooks.ownerId, ownerId)));
    return row;
  }

  /** The playbook lock-in starts with, if the player selected one. */
  async selected(ownerId: string): Promise<PlaybookView | undefined> {
    const [row] = await this.db.select(viewColumns).from(playbooks).where(and(eq(playbooks.ownerId, ownerId), eq(playbooks.selected, true)));
    return row;
  }

  /** The sealed text of one of the player's playbooks, for the vault only. */
  async loadSealed(ownerId: string, id: string): Promise<SealedPlaybook | undefined> {
    const [row] = await this.db
      .select({ ciphertext: playbooks.ciphertext, iv: playbooks.iv, authTag: playbooks.authTag, wrappedKey: playbooks.wrappedKey, keyId: playbooks.keyId, promptSha256: playbooks.textSha256 })
      .from(playbooks)
      .where(and(eq(playbooks.id, id), eq(playbooks.ownerId, ownerId)));
    return row;
  }

  /**
   * Saves a new playbook. Refused with `playbook_limit` once the player holds `max` already. The
   * player's first playbook is selected.
   */
  async create(ownerId: string, name: string, sealed: SealedPlaybook, max = DEFAULTS.playbooks.maxSaved): Promise<PlaybookView> {
    const id = newId('pbk');
    await tx(this.db, async (t) => {
      // One writer per player at a time (the account row), so two saves cannot both pass the cap.
      await t.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, ownerId)).for('update');
      const [{ n } = { n: 0 }] = await t.select({ n: count() }).from(playbooks).where(eq(playbooks.ownerId, ownerId));
      if (n >= max) throw new RepoError('playbook_limit', `at most ${max} playbooks`, { max });
      await t.insert(playbooks).values({ id, ownerId, name, ...sealedValues(sealed), selected: n === 0 });
    });
    return (await this.get(ownerId, id))!;
  }

  /** Renames and/or re-seals one of the player's playbooks; undefined when it is not theirs. */
  async update(ownerId: string, id: string, patch: { name?: string; sealed?: SealedPlaybook }): Promise<PlaybookView | undefined> {
    const rows = await this.db
      .update(playbooks)
      .set({ ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.sealed ? sealedValues(patch.sealed) : {}), updatedAt: new Date() })
      .where(and(eq(playbooks.id, id), eq(playbooks.ownerId, ownerId)))
      .returning({ id: playbooks.id });
    return rows.length ? this.get(ownerId, id) : undefined;
  }

  /** Deletes one of the player's playbooks; false when it is not theirs. */
  async delete(ownerId: string, id: string): Promise<boolean> {
    const rows = await this.db.delete(playbooks).where(and(eq(playbooks.id, id), eq(playbooks.ownerId, ownerId))).returning({ id: playbooks.id });
    return rows.length > 0;
  }

  /** Makes `id` the one lock-in starts with (null: none). False when `id` is not the player's. */
  async select(ownerId: string, id: string | null): Promise<boolean> {
    return tx(this.db, async (t) => {
      if (id !== null) {
        const [row] = await t.select({ id: playbooks.id }).from(playbooks).where(and(eq(playbooks.id, id), eq(playbooks.ownerId, ownerId))).for('update');
        if (!row) return false;
      }
      await t.update(playbooks).set({ selected: false }).where(and(eq(playbooks.ownerId, ownerId), eq(playbooks.selected, true)));
      if (id !== null) await t.update(playbooks).set({ selected: true }).where(eq(playbooks.id, id));
      return true;
    });
  }
}
