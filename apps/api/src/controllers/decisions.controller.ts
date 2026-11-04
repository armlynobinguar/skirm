// GET /v2/matches/:id/decisions: a player's decision timeline of an ended match (the debrief's "why
// did it do that?"). Needs a session; only the players of the match get anything (403 otherwise),
// and each only their own crew (practice adds the bot's). 409 `match_live` until the match ends.
import { Controller, Get, Inject, Param } from '@nestjs/common';
import type { AccountRow, SkillVersionView } from '@skirm/db';
import { CurrentAccount, mustAccount } from '../auth';
import { decisionsView, visibleTeams } from '../decisions';
import { DEPS, type ApiDeps } from '../deps';
import { ApiError, notFound } from '../errors';
import { matchId } from '../validation';
import { idOr404 } from './util';

@Controller()
export class DecisionsController {
  constructor(@Inject(DEPS) private readonly deps: ApiDeps) {}

  @Get('v2/matches/:id/decisions')
  async decisions(@Param('id') id: string, @CurrentAccount() acc?: AccountRow) {
    const account = mustAccount(acc);
    const { repos, vault } = this.deps;
    const m = await repos.v2Matches.get(idOr404(matchId, id, 'match'));
    if (!m) throw notFound('match');
    const teams = visibleTeams(m, account.id);
    if (!teams.length) throw new ApiError(403, 'forbidden', 'only a player of this match reads its decisions');
    if (m.status === 'live') throw new ApiError(409, 'match_live', 'the decision timeline is ready once the match ends');
    const timelines = await repos.matchTimelines.list(m.id, teams);
    const keys = timelines.flatMap((t) => (m.crews?.[t.team] ?? []).flatMap((a) => a.skills ?? []));
    const meta = await repos.skills.getMany(keys);
    const skills = new Map<string, SkillVersionView>(meta.map((v) => [`${v.id}:${v.version}`, v]));
    // Only the viewer's own skills are opened, and only for the viewer.
    const prompts = new Map<string, string>();
    for (const v of meta) {
      if (v.creatorId !== account.id) continue;
      const sealed = await repos.skills.loadSealed(v.id, v.version);
      if (sealed) prompts.set(`${v.id}:${v.version}`, (await vault.decryptSkill(sealed)).prompt);
    }
    return decisionsView({ match: m, viewerId: account.id, timelines, skills, prompts });
  }
}
