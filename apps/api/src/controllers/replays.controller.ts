// Shareable replays and highlights.
//
//   GET    /v2/matches/:id/highlights   public: the ended match's highlight moments with caster lines
//   POST   /v2/matches/:id/shares       a player of the match makes a public link (optionally a clip)
//   GET    /v2/matches/:id/shares       the caller's live links to that match
//   GET    /replays/:shareId            public: the link's match, highlights and whole-board frames
//   DELETE /replays/:shareId            its creator ends the link
//
// A link is opt-in: only a player of the match can make one. What it shows is what a spectator saw
// (the watch view): never a crew's plans, inner voice or live commands, never skill text. Frames
// are kept 6 h today, so a link to an older match shows the result and highlights without playback
// (`framesKept: false`), and a new link needs the frames still stored (409 `replay_expired`).
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { REPLAY_SHARES_PER_MATCH, SHARE_ID_RE, type AccountRow, type ReplayShareRow, type V2MatchRow } from '@skirm/db';
import { z } from 'zod';
import { CurrentAccount, Public, mustAccount } from '../auth';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError, notFound } from '../errors';
import { ReplayService } from '../replays';
import { matchId, parse } from '../validation';
import { v2MatchView } from '../views';
import { idOr404 } from './util';

const shareId = z.string().regex(SHARE_ID_RE);
const tick = z.number().int().min(0).max(10_000);
const shareBody = z.object({ clip: z.object({ start: tick, end: tick }).nullable().optional() });
const replayQuery = z.object({ frames: z.enum(['0', '1']).optional() });

const shareView = (s: ReplayShareRow) => ({
  id: s.id,
  matchId: s.matchId,
  clip: s.startTick !== null && s.endTick !== null ? { start: s.startTick, end: s.endTick } : null,
  createdAt: s.createdAt.toISOString(),
  path: `/replays/${s.id}`,
});

@Controller()
export class ReplaysController {
  private readonly service: ReplayService;

  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {
    this.service = new ReplayService(deps.repos, deps.replayFrames, deps.caster);
  }

  private async ended(id: string): Promise<V2MatchRow> {
    const m = await this.deps.repos.v2Matches.get(idOr404(matchId, id, 'match'));
    if (!m) throw notFound('match');
    if (m.status === 'live') throw new ApiError(409, 'match_live', 'replays are public once the match ends');
    return m;
  }

  /** The match's highlights (cached after the first ask) and whether its frames are still kept. */
  @Public()
  @Get('v2/matches/:id/highlights')
  async highlights(@Param('id') id: string) {
    const m = await this.ended(id);
    if (m.status === 'void') return { matchId: m.id, highlights: [], caster: null, framesKept: false };
    const frames = await this.service.framesOf(m.id);
    return { matchId: m.id, ...(await this.service.highlights(m, frames)) };
  }

  @Post('v2/matches/:id/shares')
  async createShare(@Param('id') id: string, @Body() body: unknown, @CurrentAccount() account?: AccountRow) {
    const me = mustAccount(account);
    const { clip } = parse(shareBody, body);
    const m = await this.ended(id);
    if (me.id !== m.teamAAccountId && me.id !== m.teamBAccountId) throw new ApiError(403, 'forbidden', 'only a player of the match can share its replay');
    if (m.status !== 'ended') throw new ApiError(409, 'not_ended', 'a void match has no replay');
    if (clip && (clip.end <= clip.start || (m.ticks !== null && clip.end > m.ticks)))
      throw new ApiError(422, 'bad_clip', `a clip needs 0 ≤ start < end ≤ ${m.ticks ?? 'the last tick'}`);
    const frames = await this.service.framesOf(m.id);
    if (!frames?.length) throw new ApiError(409, 'replay_expired', 'the frames of this match are no longer kept');
    const { replays } = this.deps.repos;
    if ((await replays.countShares(m.id, me.id)) >= REPLAY_SHARES_PER_MATCH)
      throw new ApiError(409, 'share_limit', `at most ${REPLAY_SHARES_PER_MATCH} links per match; end one first`);
    const row = await replays.createShare({ matchId: m.id, accountId: me.id, clip: clip ?? null });
    // Work the highlights out now, so the link's preview and first view do not wait on the caster.
    void this.service.highlights(m, frames).catch(() => undefined);
    return { share: shareView(row) };
  }

  @Get('v2/matches/:id/shares')
  async myShares(@Param('id') id: string, @CurrentAccount() account?: AccountRow) {
    const me = mustAccount(account);
    const m = await this.deps.repos.v2Matches.get(idOr404(matchId, id, 'match'));
    if (!m) throw notFound('match');
    return { shares: (await this.deps.repos.replays.sharesOf(m.id, me.id)).map(shareView) };
  }

  /**
   * A shared replay: the match as anyone sees it (no `you`, no debrief, even for a signed-in
   * player), the highlights inside the clip, and the whole-board frames of the clip
   * (`?frames=0` leaves them out, for link previews).
   */
  @Public()
  @Get('replays/:shareId')
  async replay(@Param('shareId') sid: string, @Query() query: unknown) {
    const { frames: wantFrames } = parse(replayQuery, query);
    const share = await this.deps.repos.replays.getShare(idOr404(shareId, sid, 'replay'));
    if (!share) throw notFound('replay');
    const { repos } = this.deps;
    const m = await repos.v2Matches.get(share.matchId);
    if (!m) throw notFound('replay');
    const [a, b, by] = await Promise.all([repos.accounts.get(m.teamAAccountId), repos.accounts.get(m.teamBAccountId), repos.accounts.get(share.accountId)]);
    const all = await this.service.framesOf(m.id);
    const hl = await this.service.highlights(m, all);
    const s = shareView(share);
    const inClip = (t: number) => !s.clip || (t >= s.clip.start && t <= s.clip.end);
    return {
      share: { ...s, by: by && !by.deletedAt ? by.handle : null },
      match: v2MatchView(m, { A: a?.handle ?? null, B: b?.handle ?? null }),
      highlights: hl.highlights.filter((h) => inClip(h.tick)),
      caster: hl.caster,
      framesKept: !!all?.length,
      ...(wantFrames === '0' ? {} : { frames: all ? all.filter((f) => inClip(f.tick)) : null }),
    };
  }

  @Delete('replays/:shareId')
  @HttpCode(200)
  async revoke(@Param('shareId') sid: string, @CurrentAccount() account?: AccountRow) {
    const me = mustAccount(account);
    const ok = await this.deps.repos.replays.revokeShare(idOr404(shareId, sid, 'replay'), me.id);
    if (!ok) throw notFound('replay');
    return { revoked: true };
  }
}
