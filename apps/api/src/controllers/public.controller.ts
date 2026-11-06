// Public reads: /leaderboards/players, /v2/models, /v2/matches/live, /v2/matches/:id(/messages, /log).
// A signed-in caller also gets their own rows.
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { MATCH_MESSAGES_MAX_LIMIT, type AccountRow, type PlayerLadderRow } from '@skirm/db';
import { DEFAULT_LLM_MODEL } from '@skirm/decision-engine/v2';
import { parseModelCatalog, playerTier, rankTitle } from '@skirm/shared';
import { z } from 'zod';
import { CurrentAccount, Public } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError, notFound } from '../errors';
import { intQuery, matchId, optIntQuery, parse } from '../validation';
import { messageView, v2LiveView, v2MatchView } from '../views';
import { idOr404 } from './util';

const messagesQuery = z.object({
  afterTick: optIntQuery(0, 1_000_000),
  limit: intQuery(1, MATCH_MESSAGES_MAX_LIMIT, 200),
});

/** A v2 ladder row with its rank title and ranked tier (@skirm/shared rankTitle, playerTier). */
const playerView = (r: PlayerLadderRow) => ({ ...r, title: rankTitle(r.elo).title, tier: playerTier(r.elo, r.rankedMatches) });

@Public()
@Controller()
export class PublicController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  /**
   * The v2 player ladder: accounts with a ranked v2 match by Elo, with their rank title; `you` is the
   * signed-in caller's row (it may be outside `rows`).
   */
  @Get('leaderboards/players')
  async players(@Query() query: unknown, @CurrentAccount() account?: AccountRow) {
    const { limit } = parse(z.object({ limit: intQuery(1, 200, 100) }), query);
    const { leaderboards } = this.deps.repos;
    const [rows, you] = await Promise.all([
      leaderboards.playerLadder(limit),
      account ? leaderboards.playerRowFor(account.id) : Promise.resolve(undefined),
    ]);
    return { rows: rows.map(playerView), ...(you ? { you: playerView(you) } : {}) };
  }

  /**
   * The models a crew may pick per agent outside ranked (LLM_MODELS), the default first at 1.0x;
   * ranked always plays `default`. Display only: realtime prices every pick from its own catalog.
   */
  @Get('v2/models')
  models() {
    const { llmModels, LLM_MODEL } = this.deps.config;
    const models = llmModels?.length ? llmModels : parseModelCatalog(undefined, LLM_MODEL ?? DEFAULT_LLM_MODEL);
    return { default: models[0]!.id, models: models.map((m) => ({ id: m.id, label: m.label, rateMultiplierBps: m.rateMultiplierBps })) };
  }

  /**
   * v2 matches being played now, newest first: players' handles (the bot of a practice match as the
   * greedy bot) and crew sizes, never the crews. Declared before `v2/matches/:id` so `live` is not
   * read as a match id.
   */
  @Get('v2/matches/live')
  async v2Live() {
    const { repos } = this.deps;
    const rows = await repos.v2Matches.listLive();
    const ids = new Set<string>();
    for (const m of rows) {
      ids.add(m.teamAAccountId);
      if (!m.practice) ids.add(m.teamBAccountId);
    }
    const accounts = await Promise.all([...ids].map((id) => repos.accounts.get(id)));
    const handle = new Map(accounts.flatMap((a) => (a ? [[a.id, a.handle] as const] : [])));
    return rows.map((m) =>
      v2LiveView(m, {
        A: handle.get(m.teamAAccountId) ?? null,
        B: handle.get(m.teamBAccountId) ?? null,
      }),
    );
  }

  /**
   * What was said in a v2 match: the lines realtime saw delivered, with who heard and overheard them.
   * Public once the match is over (409 `match_live` until then, so the rival's talk never leaks
   * mid-match). Page with `next` as the following `afterTick`.
   */
  @Get('v2/matches/:id/messages')
  async v2Messages(@Param('id') id: string, @Query() query: unknown) {
    const { afterTick, limit } = parse(messagesQuery, query);
    const { repos } = this.deps;
    const m = await repos.v2Matches.get(idOr404(matchId, id, 'match'));
    if (!m) throw notFound('match');
    if (m.status === 'live') throw new ApiError(409, 'match_live', 'messages are public once the match ends');
    const page = await repos.matchMessages.list(m.id, { ...(afterTick !== undefined ? { afterTick } : {}), limit });
    return { messages: page.messages.map(messageView), ...(page.next !== undefined ? { next: page.next } : {}) };
  }

  /**
   * The match log, so anyone can re-check its hash chain (the web's "Verify on NEAR"). Public once
   * the match is over (409 `match_live` until then); 404 `log` when none was kept (a void match).
   * Live crew commands are a player's private orders (shared replays strip them too), so a tick
   * that carries any is served without them and marked `redacted`: the verifier takes that one link
   * of the chain on the logged hash.
   */
  @Get('v2/matches/:id/log')
  async v2Log(@Param('id') id: string) {
    const { repos } = this.deps;
    const m = await repos.v2Matches.get(idOr404(matchId, id, 'match'));
    if (!m) throw notFound('match');
    if (m.status === 'live') throw new ApiError(409, 'match_live', 'the log is public once the match ends');
    const log = publicLog(m.log);
    if (!log) throw notFound('log');
    return { matchId: m.id, logHash: m.logHash ?? null, log };
  }

  /** A v2 match (the result screen); a player of it also gets `you` and their crew's debrief. */
  @Get('v2/matches/:id')
  async v2Match(@Param('id') id: string, @CurrentAccount() account?: AccountRow) {
    const { repos } = this.deps;
    const m = await repos.v2Matches.get(idOr404(matchId, id, 'match'));
    if (!m) throw notFound('match');
    const [a, b] = await Promise.all([repos.accounts.get(m.teamAAccountId), repos.accounts.get(m.teamBAccountId)]);
    return v2MatchView(m, { A: a?.handle ?? null, B: b?.handle ?? null }, account?.id);
  }
}

interface StoredLog {
  header: unknown;
  ticks: { tick: number; commands?: unknown[] }[];
  hashes: string[];
  result: unknown;
}

/** The stored log with each tick's live commands removed (that tick marked `redacted`); null without a usable log. */
export function publicLog(raw: unknown) {
  const log = raw as Partial<StoredLog> | null | undefined;
  if (!log || typeof log !== 'object' || !log.header || !Array.isArray(log.ticks) || !Array.isArray(log.hashes)) return null;
  return {
    header: log.header,
    ticks: log.ticks.map((t) => {
      if (!t.commands?.length) return t;
      const { commands: _hidden, ...rest } = t;
      return { ...rest, redacted: true as const };
    }),
    hashes: log.hashes,
    result: log.result ?? null,
  };
}
