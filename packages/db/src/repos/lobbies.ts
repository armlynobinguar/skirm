// Private lobbies: a friend challenge with a share code, or one tournament bracket match. The api
// makes, joins and edits them; realtime readies the players' crews and starts the match
// (`begin`); when the match ends, `settleMatch` writes the outcome. A friend lobby opens again for
// a rematch; a tournament lobby is decided (a draw goes to the better seed, a void to the crew not
// at fault) and the bracket moves on (TournamentsRepo.decide). The worker settles any lobby whose
// match ended without realtime settling it, and decides bracket matches nobody turned up for.
import { and, desc, eq, inArray, isNotNull, lt, ne, or } from 'drizzle-orm';
import type { LobbyTalkRule } from '@skirm/shared';
import type { Executor } from '../client';
import { accounts, lobbies, v2Matches } from '../schema';
import { RepoError } from '../types';
import type { LedgerRepoOptions } from './ledger';
import { insertLobby, type LobbyRow } from './lobby-codes';
import { TournamentsRepo } from './tournaments';
import { tx, type Clock } from './util';

export type { LobbyRow } from './lobby-codes';

export type LobbyStatus = 'open' | 'playing' | 'done' | 'cancelled';

export interface LobbySettings {
  mapId: string;
  difficulty: string;
  talk: LobbyTalkRule;
  crewSize: number;
}

/** A lobby as players see it: who is in, the host's settings and whether each side readied a crew. */
export interface LobbyView {
  id: string;
  code: string;
  host: { id: string; handle: string };
  guest: { id: string; handle: string } | null;
  mapId: string;
  difficulty: string;
  talk: LobbyTalkRule;
  crewSize: number;
  status: LobbyStatus;
  matchId: string | null;
  winnerId: string | null;
  tournamentId: string | null;
  round: number | null;
  slot: number | null;
  ready: { host: boolean; guest: boolean };
  openedAt: string;
  createdAt: string;
}

/** How a lobby's match ended, from its v2_matches row. */
export type LobbyOutcome =
  | { kind: 'won'; winnerId: string }
  | { kind: 'draw' }
  /** Void with nobody at fault (error, shutdown): the match is played again. */
  | { kind: 'replay' };

export interface LobbiesRepoOptions {
  ledger?: LedgerRepoOptions;
  clock?: Clock;
}

export class LobbiesRepo {
  private readonly clock: Clock;

  constructor(
    private readonly db: Executor,
    private readonly opts: LobbiesRepoOptions = {},
  ) {
    this.clock = opts.clock ?? (() => Date.now());
  }

  private now(): Date {
    return new Date(this.clock());
  }

  private tournaments(t: Executor): TournamentsRepo {
    return new TournamentsRepo(t, this.opts);
  }

  /** A friend lobby with the host in it, waiting for a guest. */
  async create(hostId: string, settings: LobbySettings): Promise<LobbyRow> {
    const now = this.now();
    return insertLobby(this.db, { hostId, ...settings, openedAt: now, createdAt: now, updatedAt: now });
  }

  async get(id: string): Promise<LobbyRow | undefined> {
    const [row] = await this.db.select().from(lobbies).where(eq(lobbies.id, id));
    return row;
  }

  async byCode(code: string): Promise<LobbyRow | undefined> {
    const [row] = await this.db.select().from(lobbies).where(eq(lobbies.code, code));
    return row;
  }

  async byMatch(matchId: string): Promise<LobbyRow | undefined> {
    const [row] = await this.db.select().from(lobbies).where(eq(lobbies.matchId, matchId)).orderBy(desc(lobbies.updatedAt)).limit(1);
    return row;
  }

  /** The account's lobbies still to play (open or playing), friend and bracket ones, newest first. */
  async active(accountId: string, limit = 20): Promise<LobbyRow[]> {
    return this.db
      .select()
      .from(lobbies)
      .where(and(or(eq(lobbies.hostId, accountId), eq(lobbies.guestId, accountId)), inArray(lobbies.status, ['open', 'playing'])))
      .orderBy(desc(lobbies.updatedAt))
      .limit(limit);
  }

  /** Lobbies with their players' handles. */
  async views(rows: readonly LobbyRow[]): Promise<LobbyView[]> {
    const ids = [...new Set(rows.flatMap((r) => [r.hostId, ...(r.guestId ? [r.guestId] : [])]))];
    const handles = await handlesOf(this.db, ids);
    return rows.map((r) => lobbyView(r, handles));
  }

  async view(row: LobbyRow): Promise<LobbyView> {
    return (await this.views([row]))[0]!;
  }

  /** The guest takes the free seat of a friend lobby. Joining your own lobby, or again, is refused. */
  async join(code: string, accountId: string): Promise<LobbyRow> {
    return tx(this.db, async (t) => {
      const [row] = await t.select().from(lobbies).where(eq(lobbies.code, code)).for('update');
      if (!row) throw new RepoError('not_found', 'no lobby with this code');
      if (row.tournamentId) throw new RepoError('tournament_match', 'bracket matches are not joined by code');
      if (row.hostId === accountId) throw new RepoError('own_lobby', 'this is your lobby');
      if (row.guestId === accountId) return row;
      if (row.status !== 'open') throw new RepoError('lobby_closed', 'this lobby is closed');
      if (row.guestId) throw new RepoError('lobby_full', 'this lobby already has a guest');
      const [out] = await t
        .update(lobbies)
        .set({ guestId: accountId, guestReadyAt: null, updatedAt: this.now() })
        .where(eq(lobbies.id, row.id))
        .returning();
      return out!;
    });
  }

  /** The host changes the settings of an open friend lobby while nobody has a crew readied. */
  async update(id: string, hostId: string, patch: Partial<LobbySettings>): Promise<LobbyRow> {
    return tx(this.db, async (t) => {
      const row = await this.lockedFor(t, id, hostId);
      if (row.hostId !== hostId) throw new RepoError('forbidden', 'only the host changes the settings');
      if (row.tournamentId) throw new RepoError('tournament_match', 'a bracket match plays the tournament settings');
      if (row.status !== 'open') throw new RepoError('lobby_closed', 'the lobby is not open');
      if (row.hostReadyAt || row.guestReadyAt) throw new RepoError('lobby_ready', 'a crew is readied: step back first');
      const [out] = await t
        .update(lobbies)
        .set({ ...patch, updatedAt: this.now() })
        .where(eq(lobbies.id, id))
        .returning();
      return out!;
    });
  }

  /** A guest steps out (the seat opens again); the host closing the lobby cancels it. */
  async leave(id: string, accountId: string): Promise<LobbyRow> {
    return tx(this.db, async (t) => {
      const row = await this.lockedFor(t, id, accountId);
      if (row.tournamentId) throw new RepoError('tournament_match', 'a bracket match cannot be left');
      if (row.status === 'playing') throw new RepoError('match_live', 'the match is being played');
      if (row.status === 'cancelled') return row;
      const set =
        row.hostId === accountId
          ? { status: 'cancelled' as const, hostReadyAt: null, guestReadyAt: null }
          : { guestId: null, guestReadyAt: null };
      const [out] = await t
        .update(lobbies)
        .set({ ...set, updatedAt: this.now() })
        .where(eq(lobbies.id, id))
        .returning();
      return out!;
    });
  }

  /** Realtime: this player has (or no longer has) a crew readied in the lobby. */
  async setReady(id: string, accountId: string, ready: boolean): Promise<void> {
    const row = await this.get(id);
    if (!row || row.status !== 'open') return;
    const at = ready ? this.now() : null;
    const set = row.hostId === accountId ? { hostReadyAt: at } : row.guestId === accountId ? { guestReadyAt: at } : null;
    if (set) await this.db.update(lobbies).set(set).where(and(eq(lobbies.id, id), eq(lobbies.status, 'open')));
  }

  /** Realtime: the match starts. Only an open lobby with both players starts; false otherwise. */
  async begin(id: string, matchId: string): Promise<boolean> {
    const rows = await this.db
      .update(lobbies)
      .set({ status: 'playing', matchId, hostReadyAt: null, guestReadyAt: null, updatedAt: this.now() })
      .where(and(eq(lobbies.id, id), eq(lobbies.status, 'open'), isNotNull(lobbies.guestId)))
      .returning({ id: lobbies.id });
    return rows.length === 1;
  }

  /**
   * Writes the outcome of a lobby's match once its v2_matches row has ended (idempotent: only the
   * lobby still playing that match changes). Returns the lobby as it now stands, or null when there
   * was nothing to settle.
   */
  async settleMatch(matchId: string): Promise<LobbyRow | null> {
    return tx(this.db, async (t) => {
      const [row] = await t
        .select()
        .from(lobbies)
        .where(and(eq(lobbies.matchId, matchId), eq(lobbies.status, 'playing')))
        .for('update');
      if (!row) return null;
      const [m] = await t.select().from(v2Matches).where(eq(v2Matches.id, matchId));
      if (!m || m.status === 'live') return null;
      const side = (team: string | null) => (team === 'A' ? row.hostId : team === 'B' ? row.guestId : null);
      const outcome: LobbyOutcome =
        m.status === 'ended'
          ? m.winner === 'A' || m.winner === 'B'
            ? { kind: 'won', winnerId: side(m.winner)! }
            : { kind: 'draw' }
          : m.fault === 'A' || m.fault === 'B'
            ? { kind: 'won', winnerId: side(m.fault === 'A' ? 'B' : 'A')! }
            : { kind: 'replay' };
      return this.applyOutcome(t, row, outcome);
    });
  }

  /** Lobbies still `playing` a match that has ended (realtime died before it settled them). */
  async unsettled(limit = 100): Promise<string[]> {
    const rows = await this.db
      .select({ matchId: lobbies.matchId })
      .from(lobbies)
      .innerJoin(v2Matches, eq(v2Matches.id, lobbies.matchId))
      .where(and(eq(lobbies.status, 'playing'), ne(v2Matches.status, 'live')))
      .limit(limit);
    return rows.map((r) => r.matchId!);
  }

  /** Bracket matches open since before `cutoff` (nobody started them). */
  async staleBracket(cutoff: Date, limit = 100): Promise<LobbyRow[]> {
    return this.db
      .select()
      .from(lobbies)
      .where(and(isNotNull(lobbies.tournamentId), eq(lobbies.status, 'open'), lt(lobbies.openedAt, cutoff)))
      .limit(limit);
  }

  /**
   * Decides a bracket match nobody played: a player who readied beats one who did not; otherwise
   * the better seed goes through. Only a lobby still open changes.
   */
  async forfeit(id: string): Promise<LobbyRow | null> {
    return tx(this.db, async (t) => {
      const [row] = await t
        .select()
        .from(lobbies)
        .where(and(eq(lobbies.id, id), eq(lobbies.status, 'open'), isNotNull(lobbies.tournamentId)))
        .for('update');
      if (!row || !row.guestId) return null;
      const winnerId =
        row.hostReadyAt && !row.guestReadyAt ? row.hostId : row.guestReadyAt && !row.hostReadyAt ? row.guestId : await this.tournaments(t).betterSeed(row);
      return this.applyOutcome(t, row, { kind: 'won', winnerId });
    });
  }

  private async applyOutcome(t: Executor, row: LobbyRow, outcome: LobbyOutcome): Promise<LobbyRow> {
    const now = this.now();
    const reopen = { status: 'open' as const, openedAt: now, hostReadyAt: null, guestReadyAt: null, updatedAt: now };
    if (!row.tournamentId) {
      // A friend lobby is ready for a rematch whatever happened.
      const [out] = await t
        .update(lobbies)
        .set({ ...reopen, winnerId: outcome.kind === 'won' ? outcome.winnerId : null })
        .where(eq(lobbies.id, row.id))
        .returning();
      return out!;
    }
    if (outcome.kind === 'replay') {
      const [out] = await t.update(lobbies).set(reopen).where(eq(lobbies.id, row.id)).returning();
      return out!;
    }
    // A bracket match always has a winner: a draw goes to the better seed.
    const winnerId = outcome.kind === 'won' ? outcome.winnerId : await this.tournaments(t).betterSeed(row);
    const [out] = await t
      .update(lobbies)
      .set({ status: 'done', winnerId, hostReadyAt: null, guestReadyAt: null, updatedAt: now })
      .where(eq(lobbies.id, row.id))
      .returning();
    await this.tournaments(t).decide(out!);
    return out!;
  }

  private async lockedFor(t: Executor, id: string, accountId: string): Promise<LobbyRow> {
    const [row] = await t.select().from(lobbies).where(eq(lobbies.id, id)).for('update');
    if (!row || (row.hostId !== accountId && row.guestId !== accountId)) throw new RepoError('not_found', 'lobby not found');
    return row;
  }
}

/** Handles of these accounts, by id. */
export async function handlesOf(db: Executor, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: accounts.id, handle: accounts.handle }).from(accounts).where(inArray(accounts.id, [...ids]));
  return new Map(rows.map((r) => [r.id, r.handle]));
}

export function lobbyView(r: LobbyRow, handles: Map<string, string>): LobbyView {
  const who = (id: string) => ({ id, handle: handles.get(id) ?? 'player' });
  return {
    id: r.id,
    code: r.code,
    host: who(r.hostId),
    guest: r.guestId ? who(r.guestId) : null,
    mapId: r.mapId,
    difficulty: r.difficulty,
    talk: r.talk as LobbyTalkRule,
    crewSize: r.crewSize,
    status: r.status as LobbyStatus,
    matchId: r.matchId,
    winnerId: r.winnerId,
    tournamentId: r.tournamentId,
    round: r.round,
    slot: r.slot,
    ready: { host: !!r.hostReadyAt, guest: !!r.guestReadyAt },
    openedAt: r.openedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}
