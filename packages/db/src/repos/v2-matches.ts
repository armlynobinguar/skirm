// v2 matches and per-player Elo (Formulas §7: start 1200, K 32 for the first 20 ranked matches then
// 16, floor 100). Elo moves only for ranked matches that end with a result, in the same transaction
// that closes the match; that transaction also adds the season standings and the skill versions'
// ranked records.
import { and, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { seasonPoints, updateMatch, type EloResult } from '@skirm/shared';
import type { Executor } from '../client';
import { newId } from '../ids';
import { accounts, agents, matchMessages, v2Matches, type V2CrewRecord, type V2CrewStatsRecord, type V2DebriefRecord, type V2EloDeltaRecord } from '../schema';
import { RepoError, type RegistryState } from '../types';
import { ProofRepo } from './proof';
import { RentalsRepo } from './rentals';
import { SeasonsRepo } from './seasons';
import { tx, type Clock } from './util';

export type V2MatchRow = typeof v2Matches.$inferSelect;

/** One agent's results over a set of ended v2 matches (practice against the bot left out). */
export interface V2AgentRecord {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  /** Items the agent delivered. */
  delivered: number;
  /** Bluffs it told, and how many the rival believed. */
  bluffsTold: number;
  bluffsLanded: number;
  /** Rival bluffs it heard and did not believe. */
  seenThrough: number;
}

export interface CreateV2MatchInput {
  id?: string;
  mapId: string;
  ranked: boolean;
  teamA: string;
  teamB: string;
  crews?: Record<'A' | 'B', V2CrewRecord[]>;
  /** Casual difficulty; leave it out for ranked (always Normal). */
  difficulty?: string | null;
  /** Practice vs the greedy bot (casual only). */
  practice?: boolean;
}

/** A line realtime saw delivered (engine `said` event), as stored in match_messages. */
export interface V2MatchMessageInput {
  tick: number;
  team: 'A' | 'B';
  agentId: string | null;
  agentName: string | null;
  channel: 'say' | 'team';
  text: string;
  heardBy: string[];
  overheardBy: string[];
}

/** match_messages.text is varchar(120): longer lines are cut (by code point) rather than failing the finish. */
const MESSAGE_MAX = 120;
/** Rows per insert statement (11 parameters each, well under Postgres' 65535). */
const MESSAGE_BATCH = 1000;

export interface FinishV2MatchInput {
  /** null: void. */
  winner: 'A' | 'B' | 'draw' | null;
  reason: string;
  decidedBy?: string | null;
  fault?: 'A' | 'B' | null;
  score?: { A: number; B: number } | null;
  ticks?: number | null;
  crews?: Record<'A' | 'B', V2CrewRecord[]>;
  stats?: Record<'A' | 'B', V2CrewStatsRecord> | null;
  log?: unknown;
  logHash?: string | null;
  /** Each crew's debrief; `eloDelta` and `registry` are overwritten from this result. */
  debriefs?: Partial<Record<'A' | 'B', V2DebriefRecord>> | null;
  /** Delivered lines only (never the log's says, which include lines the engine refused). */
  messages?: V2MatchMessageInput[];
}

/** The debrief's registry line for a match as it stands: null when it is never recorded. */
export function v2DebriefRegistry(m: Pick<V2MatchRow, 'ranked' | 'status' | 'registryStatus'>): V2DebriefRecord['registry'] {
  if (!m.ranked || m.status !== 'ended') return null;
  return m.registryStatus === 'recorded' || m.registryStatus === 'local' ? 'written' : 'pending';
}

/** A stored debrief with its Elo change and registry line taken from the match row. */
export function v2DebriefOf(m: V2MatchRow, team: 'A' | 'B'): V2DebriefRecord | null {
  const d = m.debriefs?.[team];
  if (!d) return null;
  const elo = m.eloDeltas?.find((e) => e.team === team);
  return { ...d, eloDelta: elo ? elo.delta : null, registry: v2DebriefRegistry(m) };
}

export class V2MatchesRepo {
  constructor(
    private readonly db: Executor,
    /** Picks the season a ranked result counts towards. */
    private readonly clock: Clock = () => Date.now(),
  ) {}

  async create(input: CreateV2MatchInput): Promise<V2MatchRow> {
    if (input.teamA === input.teamB) throw new RepoError('invalid_crew', 'a player cannot play themselves');
    if (input.practice && input.ranked) throw new RepoError('invalid_match', 'practice matches are casual');
    const [row] = await this.db
      .insert(v2Matches)
      .values({
        id: input.id ?? newId('mat'),
        mapId: input.mapId,
        ranked: input.ranked,
        practice: input.practice ?? false,
        difficulty: input.ranked ? null : (input.difficulty ?? null),
        teamAAccountId: input.teamA,
        teamBAccountId: input.teamB,
        crews: input.crews ?? null,
      })
      .returning();
    return row!;
  }

  async get(id: string): Promise<V2MatchRow | undefined> {
    const [row] = await this.db.select().from(v2Matches).where(eq(v2Matches.id, id));
    return row;
  }

  async listLive(limit = 50): Promise<V2MatchRow[]> {
    return this.db.select().from(v2Matches).where(eq(v2Matches.status, 'live')).orderBy(desc(v2Matches.createdAt)).limit(limit);
  }

  /** A player's latest matches, newest first. */
  async listForAccount(accountId: string, limit = 20): Promise<V2MatchRow[]> {
    return this.db
      .select()
      .from(v2Matches)
      .where(or(eq(v2Matches.teamAAccountId, accountId), eq(v2Matches.teamBAccountId, accountId)))
      .orderBy(desc(v2Matches.createdAt))
      .limit(limit);
  }

  /**
   * An agent's record from the matches it played: ended (not void), against players (practice
   * against the bot does not count), ended at or after `since` and before `until` when given. The
   * delivered and bluff counts come from the stored debriefs; a match stored before bluffs were
   * judged counts no bluffs.
   */
  async agentRecord(agentId: string, window: { since?: Date; until?: Date } = {}): Promise<V2AgentRecord> {
    const member = JSON.stringify([{ id: agentId }]);
    const rows = await this.db
      .select({ crews: v2Matches.crews, winner: v2Matches.winner, debriefs: v2Matches.debriefs })
      .from(v2Matches)
      .where(
        and(
          eq(v2Matches.status, 'ended'),
          eq(v2Matches.practice, false),
          or(sql`${v2Matches.crews} -> 'A' @> ${member}::jsonb`, sql`${v2Matches.crews} -> 'B' @> ${member}::jsonb`),
          window.since ? gte(v2Matches.endedAt, window.since) : undefined,
          window.until ? lt(v2Matches.endedAt, window.until) : undefined,
        ),
      );
    const out: V2AgentRecord = { matches: 0, wins: 0, losses: 0, draws: 0, delivered: 0, bluffsTold: 0, bluffsLanded: 0, seenThrough: 0 };
    for (const r of rows) {
      const team = (['A', 'B'] as const).find((T) => r.crews?.[T]?.some((a) => a.id === agentId));
      if (!team) continue;
      out.matches++;
      if (r.winner === 'draw') out.draws++;
      else if (r.winner === team) out.wins++;
      else out.losses++;
      const line = r.debriefs?.[team]?.agents.find((a) => a.agentId === agentId);
      out.delivered += line?.delivered ?? 0;
      out.bluffsTold += line?.bluffs?.told ?? 0;
      out.bluffsLanded += line?.bluffs?.landed ?? 0;
      out.seenThrough += line?.bluffs?.seenThrough ?? 0;
    }
    return out;
  }

  /**
   * Closes a match; ranked results move both players' Elo, count towards the current season and
   * the skill versions' ranked records, and the delivered lines are stored.
   * Idempotent: a closed match is returned as is (nothing is written twice).
   */
  async finish(id: string, input: FinishV2MatchInput): Promise<V2MatchRow> {
    return tx(this.db, async (t) => {
      const [m] = await t.select().from(v2Matches).where(eq(v2Matches.id, id)).for('update');
      if (!m) throw new RepoError('not_found', `match ${id} not found`);
      if (m.status !== 'live') return m;

      let deltas: V2EloDeltaRecord[] = [];
      if (m.ranked && input.winner) {
        const rows = await t
          .select()
          .from(accounts)
          .where(or(eq(accounts.id, m.teamAAccountId), eq(accounts.id, m.teamBAccountId)))
          .for('update');
        const a = rows.find((r) => r.id === m.teamAAccountId);
        const b = rows.find((r) => r.id === m.teamBAccountId);
        if (!a || !b) throw new RepoError('not_found', 'a player of this match was not found');
        const resultA: EloResult = input.winner === 'A' ? 1 : input.winner === 'B' ? 0 : 0.5;
        const upd = updateMatch([{ rating: a.elo, rankedMatches: a.rankedMatches }], [{ rating: b.elo, rankedMatches: b.rankedMatches }], resultA);
        deltas = [
          { accountId: a.id, team: 'A', ...upd.a[0]! },
          { accountId: b.id, team: 'B', ...upd.b[0]! },
        ];
        for (const [r, d] of [[a, deltas[0]!], [b, deltas[1]!]] as const) {
          const won = input.winner === d.team;
          const draw = input.winner === 'draw';
          await t
            .update(accounts)
            .set({
              elo: d.after,
              rankedMatches: r.rankedMatches + 1,
              wins: r.wins + (won ? 1 : 0),
              losses: r.losses + (!won && !draw ? 1 : 0),
              draws: r.draws + (draw ? 1 : 0),
            })
            .where(eq(accounts.id, r.id));
        }
      }

      const status = input.winner ? 'ended' : 'void';
      const registryStatus = input.winner && m.ranked ? 'pending' : 'none';
      let debriefs: V2MatchRow['debriefs'] = null;
      if (input.debriefs) {
        const registry = v2DebriefRegistry({ ranked: m.ranked, status, registryStatus });
        debriefs = {};
        for (const team of ['A', 'B'] as const) {
          const d = input.debriefs[team];
          if (d) debriefs[team] = { ...d, eloDelta: deltas.find((e) => e.team === team)?.delta ?? null, registry };
        }
      }
      const [row] = await t
        .update(v2Matches)
        .set({
          status,
          winner: input.winner,
          reason: input.reason,
          decidedBy: input.decidedBy ?? null,
          fault: input.fault ?? null,
          scoreA: input.score?.A ?? null,
          scoreB: input.score?.B ?? null,
          ticks: input.ticks ?? null,
          ...(input.crews ? { crews: input.crews } : {}),
          eloDeltas: deltas,
          stats: input.stats ?? null,
          log: input.log ?? null,
          logHash: input.logHash ?? null,
          debriefs,
          registryStatus,
          // The repo clock, as for the season this result counts towards.
          endedAt: new Date(this.clock()),
        })
        .where(and(eq(v2Matches.id, id), eq(v2Matches.status, 'live')))
        .returning();
      const lines = input.messages ?? [];
      for (let i = 0; i < lines.length; i += MESSAGE_BATCH)
        await t.insert(matchMessages).values(
          lines.slice(i, i + MESSAGE_BATCH).map((l) => ({
            matchId: id,
            tick: l.tick,
            team: l.team,
            agentId: l.agentId,
            agentName: l.agentName,
            channel: l.channel,
            text: Array.from(l.text).slice(0, MESSAGE_MAX).join(''),
            heardBy: l.heardBy,
            overheardBy: l.overheardBy,
          })),
        );
      // Each agent's own counters (the lobby and the agent record's fallback): ended matches
      // against players, so practice against the bot and void matches do not count.
      const played = input.crews ?? m.crews;
      if (status === 'ended' && !m.practice && played)
        for (const team of ['A', 'B'] as const) {
          const ids = played[team].map((a) => a.id);
          if (!ids.length) continue;
          const won = input.winner === team;
          const draw = input.winner === 'draw';
          await t
            .update(agents)
            .set({
              matchesPlayed: sql`${agents.matchesPlayed} + 1`,
              wins: sql`${agents.wins} + ${won ? 1 : 0}`,
              losses: sql`${agents.losses} + ${!won && !draw ? 1 : 0}`,
              draws: sql`${agents.draws} + ${draw ? 1 : 0}`,
            })
            .where(inArray(agents.id, ids));
        }
      // A rented agent in a crew uses up one of that player's passes when the match ends (a void
      // match uses none). A pass can only be missing if one was spent elsewhere meanwhile, which the
      // busy check prevents; then the match still stands.
      if (status === 'ended' && played) {
        const crewIds = [...played.A, ...played.B].map((a) => a.id);
        const owners = crewIds.length ? await t.select({ id: agents.id, ownerId: agents.ownerId }).from(agents).where(inArray(agents.id, crewIds)) : [];
        const rentals = new RentalsRepo(t);
        for (const team of ['A', 'B'] as const) {
          const account = team === 'A' ? m.teamAAccountId : m.teamBAccountId;
          const rented = played[team].map((a) => a.id).filter((id) => owners.some((o) => o.id === id && o.ownerId !== account));
          for (const agentId of rented)
            await rentals.consume(account, [agentId], id, new Date(this.clock())).catch((err: unknown) => {
              if (!(err instanceof RepoError && err.code === 'no_rental')) throw err;
            });
        }
      }
      const season = await new SeasonsRepo(t, this.clock).recordRanked(t, row!);
      await new ProofRepo(t).recordMatchStats(t, row!);
      if (!season) return row!;
      // Each crew's debrief says which season the result counted towards and the points it gave.
      let stored = row!.debriefs;
      if (stored) {
        stored = { ...stored };
        for (const team of ['A', 'B'] as const) {
          const d = stored[team];
          if (!d) continue;
          const outcome = input.winner === 'draw' ? 'draw' : input.winner === team ? 'win' : 'loss';
          stored[team] = { ...d, season: { number: season.number, points: seasonPoints(outcome) } };
        }
        await t.update(v2Matches).set({ debriefs: stored }).where(eq(v2Matches.id, id));
      }
      return { ...row!, seasonId: season.id, debriefs: stored };
    });
  }

  async setRegistry(id: string, status: RegistryState, txHash?: string | null): Promise<void> {
    await this.db
      .update(v2Matches)
      .set({ registryStatus: status, ...(txHash !== undefined ? { registryTx: txHash } : {}) })
      .where(eq(v2Matches.id, id));
  }
}
