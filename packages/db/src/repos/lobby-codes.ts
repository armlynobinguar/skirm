// Inserting a lobby with a fresh share code (LOBBY_CODE_ALPHABET), retried on the rare collision.
import { randomBytes } from 'node:crypto';
import { LOBBY_CODE_LENGTH, lobbyCodeFrom } from '@skirm/shared';
import type { Executor } from '../client';
import { newId } from '../ids';
import { lobbies } from '../schema';
import { isUniqueViolation, tx } from './util';

export type LobbyRow = typeof lobbies.$inferSelect;
export type LobbyInsert = Omit<typeof lobbies.$inferInsert, 'id' | 'code'>;

const ATTEMPTS = 8;

/** Inserts a lobby (`lby_` id, a new code). Each try is a savepoint, so a collision never poisons the caller's transaction. */
export async function insertLobby(db: Executor, values: LobbyInsert): Promise<LobbyRow> {
  for (let i = 0; ; i++) {
    const code = lobbyCodeFrom(randomBytes(LOBBY_CODE_LENGTH));
    try {
      return await tx(db, async (t) => {
        const [row] = await t
          .insert(lobbies)
          .values({ ...values, id: newId('lby'), code })
          .returning();
        return row!;
      });
    } catch (err) {
      if (i + 1 < ATTEMPTS && isUniqueViolation(err)) continue;
      throw err;
    }
  }
}
