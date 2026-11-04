// Private lobbies and tournaments (docs/backend-contract.md, Lobbies and tournaments).
//
//   POST   /lobbies              { mapId, difficulty, talk, crewSize }  a friend lobby, host = caller
//   GET    /lobbies                                                     the caller's lobbies still to play
//   GET    /lobbies/code/:code                                          a lobby by its share code (invite preview)
//   POST   /lobbies/join         { code }                               take the guest seat
//   GET    /lobbies/:id                                                 one of the caller's lobbies
//   PATCH  /lobbies/:id          settings                               the host changes them (nobody readied)
//   DELETE /lobbies/:id                                                 a guest leaves; the host closes it
//
//   GET    /tournaments          ?status=open|running|done|cancelled    newest first (public)
//   POST   /tournaments          { name, size, mapId, difficulty, talk, crewSize, prizePool, join }
//   GET    /tournaments/:id                                             the bracket (public)
//   POST   /tournaments/:id/join | /leave | /cancel
//
// The match itself is played over realtime (`v2_lobby_ready`, then accept and lock-in as usual). It
// is unranked: no Elo, season or registry; both crews hold credits as in a casual match. A prize
// pool is paid credits only, spent when the tournament is made and paid to the top finishers.
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { RepoError, type AccountRow, type LobbyRow } from '@skirm/db';
import { DIFFICULTIES, MAPS_V2 } from '@skirm/engine/v2';
import { LOBBY_CODE_ALPHABET, LOBBY_CODE_LENGTH, LOBBY_TALK_RULES, TOURNAMENT, TOURNAMENT_SIZES } from '@skirm/shared';
import { z } from 'zod';
import { CurrentAccount, Public, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError, notFound } from '../errors';
import { parse } from '../validation';
import { idOr404 } from './util';

const lobbyId = z.string().regex(/^lby_[0-9A-HJKMNP-TV-Z]{26}$/);
const tournamentId = z.string().regex(/^trn_[0-9A-HJKMNP-TV-Z]{26}$/);
const code = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().length(LOBBY_CODE_LENGTH).regex(new RegExp(`^[${LOBBY_CODE_ALPHABET}]+$`)));
const mapId = z.enum(MAPS_V2.map((m) => m.id) as [string, ...string[]]);
const difficulty = z.enum(DIFFICULTIES as unknown as [string, ...string[]]);
const talk = z.enum(LOBBY_TALK_RULES);
const crewSize = z.number().int().min(1).max(3);

const settings = z.object({ mapId, difficulty: difficulty.default('normal'), talk: talk.default('any'), crewSize: crewSize.default(3) }).strict();
const settingsPatch = z.object({ mapId, difficulty, talk, crewSize }).partial().strict();
const joinBody = z.object({ code }).strict();
const tournamentBody = z
  .object({
    name: z.string().trim().min(1).max(TOURNAMENT.nameMax),
    size: z.union(TOURNAMENT_SIZES.map((n) => z.literal(n)) as unknown as [z.ZodLiteral<4>, z.ZodLiteral<8>, z.ZodLiteral<16>]),
    mapId,
    difficulty: difficulty.default('normal'),
    talk: talk.default('any'),
    crewSize: crewSize.default(3),
    prizePool: z.number().int().min(0).max(TOURNAMENT.maxPrizePool).default(0),
    join: z.boolean().default(true),
  })
  .strict();
const listQuery = z.object({ status: z.enum(['open', 'running', 'done', 'cancelled']).optional() });

/** Lobby and tournament refusals as HTTP. */
const STATUS: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  insufficient_credits: 402,
  own_lobby: 409,
  lobby_full: 409,
  lobby_closed: 409,
  lobby_ready: 409,
  match_live: 409,
  tournament_match: 409,
  tournament_full: 409,
  not_open: 409,
};

function refusal(err: unknown): never {
  if (err instanceof RepoError && STATUS[err.code]) {
    if (err.code === 'insufficient_credits')
      throw new ApiError(402, err.code, err.message, undefined, { need: err.details?.need, have: err.details?.have });
    throw new ApiError(STATUS[err.code]!, err.code, err.message);
  }
  throw err;
}

@Controller()
export class LobbiesController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  // ---------- Lobbies ----------

  @Post('lobbies')
  async create(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const s = parse(settings, body);
    const row = await this.deps.repos.lobbies.create(account.id, { ...s, crewSize: this.fitCrew(s.mapId, s.crewSize) });
    return this.deps.repos.lobbies.view(row);
  }

  @Get('lobbies')
  async mine(@CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { lobbies } = this.deps.repos;
    return lobbies.views(await lobbies.active(account.id));
  }

  @Get('lobbies/code/:code')
  async byCode(@Param('code') raw: string, @CurrentAccount() acc?: AccountRow) {
    mustAccount(acc);
    const c = code.safeParse(raw);
    const row = c.success ? await this.deps.repos.lobbies.byCode(c.data) : undefined;
    if (!row || row.tournamentId) throw notFound('lobby');
    return this.deps.repos.lobbies.view(row);
  }

  @Post('lobbies/join')
  @HttpCode(200)
  async join(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { code: c } = parse(joinBody, body);
    const row = await this.deps.repos.lobbies.join(c, account.id).catch(refusal);
    return this.deps.repos.lobbies.view(row);
  }

  @Get('lobbies/:id')
  async get(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const row = await this.mineOr404(idOr404(lobbyId, id, 'lobby'), account.id);
    return this.deps.repos.lobbies.view(row);
  }

  @Patch('lobbies/:id')
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const lid = idOr404(lobbyId, id, 'lobby');
    const patch = parse(settingsPatch, body);
    const current = await this.mineOr404(lid, account.id);
    const map = patch.mapId ?? current.mapId;
    const size = patch.crewSize ?? current.crewSize;
    const fitted = { ...patch, ...(patch.mapId !== undefined || patch.crewSize !== undefined ? { crewSize: this.fitCrew(map, size) } : {}) };
    const row = await this.deps.repos.lobbies.update(lid, account.id, fitted as typeof patch).catch(refusal);
    return this.deps.repos.lobbies.view(row);
  }

  @Delete('lobbies/:id')
  async leave(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const row = await this.deps.repos.lobbies.leave(idOr404(lobbyId, id, 'lobby'), account.id).catch(refusal);
    return this.deps.repos.lobbies.view(row);
  }

  // ---------- Tournaments ----------

  @Public()
  @Get('tournaments')
  async list(@Query() query: unknown, @CurrentAccount() account?: AccountRow) {
    const { status } = parse(listQuery, query);
    const { tournaments } = this.deps.repos;
    const [rows, joined] = await Promise.all([
      tournaments.list(status ? { status: [status] } : {}),
      account ? tournaments.joinedBy(account.id) : Promise.resolve([] as string[]),
    ]);
    const mine = new Set(joined);
    return rows.map((r) => ({ ...r, joined: mine.has(r.id) }));
  }

  @Post('tournaments')
  async createTournament(@Body() body: unknown, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const b = parse(tournamentBody, body);
    const row = await this.deps.repos.tournaments
      .create({ ...b, creatorId: account.id, crewSize: this.fitCrew(b.mapId, b.crewSize), talk: b.talk })
      .catch(refusal);
    return this.detail(row.id, account);
  }

  @Public()
  @Get('tournaments/:id')
  async getTournament(@Param('id') id: string, @CurrentAccount() account?: AccountRow) {
    return this.detail(idOr404(tournamentId, id, 'tournament'), account);
  }

  @Post('tournaments/:id/join')
  @HttpCode(200)
  async joinTournament(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const tid = idOr404(tournamentId, id, 'tournament');
    await this.deps.repos.tournaments.join(tid, account.id).catch(refusal);
    return this.detail(tid, account);
  }

  @Post('tournaments/:id/leave')
  @HttpCode(200)
  async leaveTournament(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const tid = idOr404(tournamentId, id, 'tournament');
    await this.deps.repos.tournaments.leave(tid, account.id).catch(refusal);
    return this.detail(tid, account);
  }

  @Post('tournaments/:id/cancel')
  @HttpCode(200)
  async cancelTournament(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const tid = idOr404(tournamentId, id, 'tournament');
    await this.deps.repos.tournaments.cancel(tid, account.id).catch(refusal);
    return this.detail(tid, account);
  }

  // ---------- Helpers ----------

  /** The bracket, with the caller's entry and their lobby to play (when there is one). */
  private async detail(id: string, account?: AccountRow) {
    const d = await this.deps.repos.tournaments.detail(id);
    if (!d) throw notFound('tournament');
    const you = account ? d.entries.find((e) => e.account.id === account.id) : undefined;
    const next = account
      ? d.matches.find((m) => (m.status === 'open' || m.status === 'playing') && (m.hostId === account.id || m.guestId === account.id))
      : undefined;
    return { ...d, ...(account ? { you: { joined: !!you, creator: d.creator.id === account!.id, place: you?.place ?? null, prize: you?.prize ?? 0, lobbyId: next?.lobbyId ?? null } } : {}) };
  }

  /** A crew size the map takes (its start tiles cap it). */
  private fitCrew(id: string, size: number): number {
    const map = MAPS_V2.find((m) => m.id === id);
    const limit = map ? Math.min(3, map.starts.A.length, map.starts.B.length) : 3;
    return Math.min(size, limit);
  }

  private async mineOr404(id: string, accountId: string): Promise<LobbyRow> {
    const row = await this.deps.repos.lobbies.get(id);
    if (!row || (row.hostId !== accountId && row.guestId !== accountId)) throw notFound('lobby');
    return row;
  }
}
