// Single-elimination tournaments of 4, 8 or 16 players, built from private lobbies. A player makes
// one (optionally funding a prize pool from their paid credits, spent at once), players join, and
// the bracket starts by itself when it is full: seeded by Elo (best first, earlier joiner on a tie),
// one lobby per first-round match. Each decided match (LobbiesRepo) moves its winner on; the next
// round's lobby is made once both of its feeders are decided. The final decides the places and pays
// the pool (tournamentPayouts) as paid credits, each prize credited once. Cancelling an open
// tournament gives the pool back to its creator. Everything runs offchain on the credits ledger.
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  bracketRounds,
  nextMatch,
  placeOfLoser,
  seedOrder,
  tournamentPayouts,
  type LobbyTalkRule,
  type TournamentSize,
} from '@skirm/shared';
import type { Executor } from '../client';
import { newId } from '../ids';
import { accounts, lobbies, tournamentEntries, tournaments } from '../schema';
import { RepoError } from '../types';
import { LedgerRepo, type LedgerRepoOptions } from './ledger';
import { insertLobby, type LobbyRow } from './lobby-codes';
import { tx, type Clock } from './util';

export type TournamentRow = typeof tournaments.$inferSelect;
export type TournamentEntryRow = typeof tournamentEntries.$inferSelect;
export type TournamentStatus = 'open' | 'running' | 'done' | 'cancelled';

export interface CreateTournamentInput {
  creatorId: string;
  name: string;
  size: TournamentSize;
  mapId: string;
  difficulty: string;
  talk: LobbyTalkRule;
  crewSize: number;
  /** Paid credits the creator puts up (0: no prizes). */
  prizePool: number;
  /** The creator plays in it too. */
  join: boolean;
}

export interface TournamentSummary {
  id: string;
  name: string;
  creator: { id: string; handle: string };
  size: number;
  entrants: number;
  mapId: string;
  difficulty: string;
  talk: LobbyTalkRule;
  crewSize: number;
  prizePool: number;
  status: TournamentStatus;
  champion: { id: string; handle: string } | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface TournamentDetail extends TournamentSummary {
  entries: { account: { id: string; handle: string }; seed: number | null; elo: number | null; place: number | null; prize: number }[];
  /** Every bracket match made so far (round 1 first). */
  matches: {
    lobbyId: string;
    code: string;
    round: number;
    slot: number;
    hostId: string;
    guestId: string | null;
    status: string;
    matchId: string | null;
    winnerId: string | null;
  }[];
  rounds: number;
}

export interface TournamentsRepoOptions {
  ledger?: LedgerRepoOptions;
  clock?: Clock;
}

export class TournamentsRepo {
  private readonly clock: Clock;

  constructor(
    private readonly db: Executor,
    private readonly opts: TournamentsRepoOptions = {},
  ) {
    this.clock = opts.clock ?? (() => Date.now());
  }

  private now(): Date {
    return new Date(this.clock());
  }

  private ledger(t: Executor): LedgerRepo {
    return new LedgerRepo(t, this.opts.ledger);
  }

  /** Makes a tournament; a prize pool is spent from the creator's paid credits in the same transaction. */
  async create(input: CreateTournamentInput): Promise<TournamentRow> {
    const { join, ...fields } = input;
    return tx(this.db, async (t) => {
      const id = newId('trn');
      const now = this.now();
      const [row] = await t
        .insert(tournaments)
        .values({ id, ...fields, createdAt: now })
        .returning();
      if (input.prizePool > 0) {
        const spent = await this.ledger(t).spend({ accountId: input.creatorId, amount: input.prizePool, ref: `tournament:${id}`, kind: 'prize_pool' });
        if (!spent.ok)
          throw new RepoError(spent.error, spent.message, spent.need !== undefined ? { need: spent.need, have: spent.have } : undefined);
      }
      if (join) await t.insert(tournamentEntries).values({ tournamentId: id, accountId: input.creatorId, joinedAt: now });
      return row!;
    });
  }

  async get(id: string): Promise<TournamentRow | undefined> {
    const [row] = await this.db.select().from(tournaments).where(eq(tournaments.id, id));
    return row;
  }

  /** Newest first; `status` narrows it. */
  async list(opts: { status?: TournamentStatus[]; limit?: number } = {}): Promise<TournamentSummary[]> {
    const rows = await this.db
      .select()
      .from(tournaments)
      .where(opts.status?.length ? inArray(tournaments.status, opts.status) : undefined)
      .orderBy(desc(tournaments.createdAt))
      .limit(opts.limit ?? 50);
    if (!rows.length) return [];
    const counts = await this.db
      .select({ id: tournamentEntries.tournamentId, n: sql<number>`count(*)::int` })
      .from(tournamentEntries)
      .where(inArray(tournamentEntries.tournamentId, rows.map((r) => r.id)))
      .groupBy(tournamentEntries.tournamentId);
    const n = new Map(counts.map((c) => [c.id, Number(c.n)]));
    const handles = await this.handles(rows.flatMap((r) => [r.creatorId, ...(r.championId ? [r.championId] : [])]));
    return rows.map((r) => summary(r, n.get(r.id) ?? 0, handles));
  }

  /** Ids of the tournaments this account is entered in. */
  async joinedBy(accountId: string): Promise<string[]> {
    const rows = await this.db.select({ id: tournamentEntries.tournamentId }).from(tournamentEntries).where(eq(tournamentEntries.accountId, accountId));
    return rows.map((r) => r.id);
  }

  /** The bracket: entries (by seed, then join order) and every match made so far. */
  async detail(id: string): Promise<TournamentDetail | undefined> {
    const row = await this.get(id);
    if (!row) return undefined;
    const entries = await this.db
      .select()
      .from(tournamentEntries)
      .where(eq(tournamentEntries.tournamentId, id))
      .orderBy(asc(sql`coalesce(${tournamentEntries.seed}, 999)`), asc(tournamentEntries.joinedAt));
    const matches = await this.db
      .select()
      .from(lobbies)
      .where(eq(lobbies.tournamentId, id))
      .orderBy(asc(lobbies.round), asc(lobbies.slot));
    const handles = await this.handles([row.creatorId, ...(row.championId ? [row.championId] : []), ...entries.map((e) => e.accountId)]);
    const who = (a: string) => ({ id: a, handle: handles.get(a) ?? 'player' });
    return {
      ...summary(row, entries.length, handles),
      rounds: bracketRounds(row.size),
      entries: entries.map((e) => ({ account: who(e.accountId), seed: e.seed, elo: e.elo, place: e.place, prize: e.prize })),
      matches: matches.map((m) => ({
        lobbyId: m.id,
        code: m.code,
        round: m.round!,
        slot: m.slot!,
        hostId: m.hostId,
        guestId: m.guestId,
        status: m.status,
        matchId: m.matchId,
        winnerId: m.winnerId,
      })),
    };
  }

  /** Enters a player; the last free place starts the bracket. Joining twice is a no-op. */
  async join(id: string, accountId: string): Promise<TournamentRow> {
    return tx(this.db, async (t) => {
      const row = await this.locked(t, id);
      const [have] = await t
        .select()
        .from(tournamentEntries)
        .where(and(eq(tournamentEntries.tournamentId, id), eq(tournamentEntries.accountId, accountId)));
      if (have) return row;
      if (row.status !== 'open') throw new RepoError('not_open', 'this tournament is not taking players');
      const n = await this.count(t, id);
      if (n >= row.size) throw new RepoError('tournament_full', 'this tournament is full');
      await t.insert(tournamentEntries).values({ tournamentId: id, accountId, joinedAt: this.now() });
      if (n + 1 < row.size) return row;
      return this.start(t, row);
    });
  }

  /** Leaves a tournament that has not started. */
  async leave(id: string, accountId: string): Promise<TournamentRow> {
    return tx(this.db, async (t) => {
      const row = await this.locked(t, id);
      if (row.status !== 'open') throw new RepoError('not_open', 'the bracket has started');
      await t.delete(tournamentEntries).where(and(eq(tournamentEntries.tournamentId, id), eq(tournamentEntries.accountId, accountId)));
      return row;
    });
  }

  /** The creator calls off a tournament that has not started; the prize pool goes back to them. */
  async cancel(id: string, accountId: string): Promise<TournamentRow> {
    return tx(this.db, async (t) => {
      const row = await this.locked(t, id);
      if (row.creatorId !== accountId) throw new RepoError('forbidden', 'only its creator cancels a tournament');
      if (row.status === 'cancelled') return row;
      if (row.status !== 'open') throw new RepoError('not_open', 'the bracket has started');
      const [out] = await t
        .update(tournaments)
        .set({ status: 'cancelled', endedAt: this.now() })
        .where(eq(tournaments.id, id))
        .returning();
      if (row.prizePool > 0) await this.credit(t, row.creatorId, row.prizePool, `tournament:${id}:refund`, 'prize_pool');
      return out!;
    });
  }

  /** The better-seeded player of a bracket match (the host when seeds are missing). */
  async betterSeed(lobby: LobbyRow): Promise<string> {
    if (!lobby.tournamentId || !lobby.guestId) return lobby.hostId;
    const rows = await this.db
      .select({ accountId: tournamentEntries.accountId, seed: tournamentEntries.seed })
      .from(tournamentEntries)
      .where(and(eq(tournamentEntries.tournamentId, lobby.tournamentId), inArray(tournamentEntries.accountId, [lobby.hostId, lobby.guestId])));
    const seed = (a: string) => rows.find((r) => r.accountId === a)?.seed ?? 999;
    return seed(lobby.guestId) < seed(lobby.hostId) ? lobby.guestId : lobby.hostId;
  }

  /**
   * A bracket match was decided (`lobby.winnerId`): the loser's place is written, and the winner
   * goes on. The next round's match is made once both of its feeders are decided; the final ends
   * the tournament and pays the prizes.
   */
  async decide(lobby: LobbyRow): Promise<void> {
    if (!lobby.tournamentId || lobby.round === null || lobby.slot === null || !lobby.winnerId || !lobby.guestId) return;
    // Its own transaction (a savepoint inside the caller's), so the tournament row lock below holds
    // until the bracket and prizes are written even when a caller forgets to open one.
    await tx(this.db, (t) => this.decideIn(t, lobby));
  }

  private async decideIn(t: Executor, lobby: LobbyRow): Promise<void> {
    if (!lobby.tournamentId || lobby.round === null || lobby.slot === null || !lobby.winnerId || !lobby.guestId) return;
    const row = await this.locked(t, lobby.tournamentId);
    if (row.status !== 'running') return;
    const winnerId = lobby.winnerId;
    const loserId = winnerId === lobby.hostId ? lobby.guestId : lobby.hostId;
    await this.place(t, row.id, loserId, placeOfLoser(row.size, lobby.round));
    if (lobby.round >= bracketRounds(row.size)) {
      await this.place(t, row.id, winnerId, 1);
      await t.update(tournaments).set({ status: 'done', championId: winnerId, endedAt: this.now() }).where(eq(tournaments.id, row.id));
      await this.payPrizes(t, row);
      return;
    }
    const [sibling] = await t
      .select()
      .from(lobbies)
      .where(and(eq(lobbies.tournamentId, row.id), eq(lobbies.round, lobby.round), eq(lobbies.slot, lobby.slot ^ 1)));
    if (!sibling || sibling.status !== 'done' || !sibling.winnerId) return;
    const next = nextMatch(lobby.round, lobby.slot);
    const [even, odd] = lobby.slot % 2 === 0 ? [winnerId, sibling.winnerId] : [sibling.winnerId, winnerId];
    const now = this.now();
    await insertLobby(t, {
      hostId: even,
      guestId: odd,
      mapId: row.mapId,
      difficulty: row.difficulty,
      talk: row.talk,
      crewSize: row.crewSize,
      tournamentId: row.id,
      round: next.round,
      slot: next.slot,
      openedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Seeds the full field by Elo and makes the first round's lobbies. */
  private async start(t: Executor, row: TournamentRow): Promise<TournamentRow> {
    const field = await t
      .select({ accountId: tournamentEntries.accountId, elo: accounts.elo, joinedAt: tournamentEntries.joinedAt })
      .from(tournamentEntries)
      .innerJoin(accounts, eq(accounts.id, tournamentEntries.accountId))
      .where(eq(tournamentEntries.tournamentId, row.id))
      .orderBy(desc(accounts.elo), asc(tournamentEntries.joinedAt), asc(tournamentEntries.accountId));
    const bySeed = new Map<number, string>();
    for (const [i, e] of field.entries()) {
      bySeed.set(i + 1, e.accountId);
      await t
        .update(tournamentEntries)
        .set({ seed: i + 1, elo: e.elo })
        .where(and(eq(tournamentEntries.tournamentId, row.id), eq(tournamentEntries.accountId, e.accountId)));
    }
    const order = seedOrder(row.size);
    const now = this.now();
    for (let slot = 0; slot < row.size / 2; slot++) {
      await insertLobby(t, {
        hostId: bySeed.get(order[slot * 2]!)!,
        guestId: bySeed.get(order[slot * 2 + 1]!)!,
        mapId: row.mapId,
        difficulty: row.difficulty,
        talk: row.talk,
        crewSize: row.crewSize,
        tournamentId: row.id,
        round: 1,
        slot,
        openedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    const [out] = await t.update(tournaments).set({ status: 'running', startedAt: now }).where(eq(tournaments.id, row.id)).returning();
    return out!;
  }

  private async payPrizes(t: Executor, row: TournamentRow): Promise<void> {
    if (row.prizePool <= 0) return;
    const finishers = await t
      .select({ accountId: tournamentEntries.accountId, place: tournamentEntries.place })
      .from(tournamentEntries)
      .where(eq(tournamentEntries.tournamentId, row.id));
    const paid = tournamentPayouts(
      row.prizePool,
      finishers.filter((f): f is { accountId: string; place: number } => f.place !== null),
    );
    for (const p of paid) {
      await this.credit(t, p.accountId, p.credits, `tournament:${row.id}:${p.accountId}`, 'prize');
      await t
        .update(tournamentEntries)
        .set({ prize: p.credits })
        .where(and(eq(tournamentEntries.tournamentId, row.id), eq(tournamentEntries.accountId, p.accountId)));
    }
  }

  /** Paid credits in, credited once per `ref` (a repeat is skipped). */
  private async credit(t: Executor, accountId: string, credits: number, ref: string, note: 'prize' | 'prize_pool'): Promise<void> {
    const r = await this.ledger(t).topUp({ accountId, credits, receipt: ref, note });
    if (!r.ok && r.error !== 'duplicate_topup') throw new RepoError(r.error, r.message);
  }

  private async place(t: Executor, tournamentId: string, accountId: string, place: number): Promise<void> {
    await t
      .update(tournamentEntries)
      .set({ place })
      .where(and(eq(tournamentEntries.tournamentId, tournamentId), eq(tournamentEntries.accountId, accountId)));
  }

  private async count(t: Executor, id: string): Promise<number> {
    const [c] = await t
      .select({ n: sql<number>`count(*)::int` })
      .from(tournamentEntries)
      .where(eq(tournamentEntries.tournamentId, id));
    return Number(c?.n ?? 0);
  }

  private async locked(t: Executor, id: string): Promise<TournamentRow> {
    const [row] = await t.select().from(tournaments).where(eq(tournaments.id, id)).for('update');
    if (!row) throw new RepoError('not_found', 'tournament not found');
    return row;
  }

  private async handles(ids: readonly string[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids)];
    if (!uniq.length) return new Map();
    const rows = await this.db.select({ id: accounts.id, handle: accounts.handle }).from(accounts).where(inArray(accounts.id, uniq));
    return new Map(rows.map((r) => [r.id, r.handle]));
  }
}

function summary(r: TournamentRow, entrants: number, handles: Map<string, string>): TournamentSummary {
  const who = (a: string) => ({ id: a, handle: handles.get(a) ?? 'player' });
  return {
    id: r.id,
    name: r.name,
    creator: who(r.creatorId),
    size: r.size,
    entrants,
    mapId: r.mapId,
    difficulty: r.difficulty,
    talk: r.talk as LobbyTalkRule,
    crewSize: r.crewSize,
    prizePool: r.prizePool,
    status: r.status as TournamentStatus,
    champion: r.championId ? who(r.championId) : null,
    createdAt: r.createdAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    endedAt: r.endedAt?.toISOString() ?? null,
  };
}
