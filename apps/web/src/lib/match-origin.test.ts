import { afterEach, describe, expect, it } from 'vitest';
import { safeNext } from '@/features/play/SignInScreen';
import { matchBack, matchOrigin, originLink } from './match-origin';
import { routes } from './routes';

const ORIGIN = 'https://playskirm.xyz';

describe('safeNext (sign-in ?next=)', () => {
  it('keeps same-origin paths with their query and hash', () => {
    expect(safeNext('/maps/copper-hollow/crew?opponent=bot', ORIGIN)).toBe('/maps/copper-hollow/crew?opponent=bot');
    expect(safeNext('/skills/bench?skill=skl_1#run', ORIGIN)).toBe('/skills/bench?skill=skl_1#run');
  });

  it('refuses anything that would leave the site', () => {
    // String.raw keeps the backslashes: `/\evil.com` is the form browsers read as `//evil.com`.
    for (const bad of ['//evil.com', String.raw`/\evil.com`, String.raw`/\/evil.com`, String.raw`/\\evil.com`, 'https://evil.com', 'evil.com', '', null])
      expect(safeNext(bad as string | null, ORIGIN)).toBeNull();
  });
});

describe('match origin', () => {
  afterEach(() => window.sessionStorage.clear());

  it('sends the debrief and Back to the screen the match came from', () => {
    matchOrigin.set('mat_c', { kind: 'campaign', missionId: 'm1' });
    matchOrigin.set('mat_t', { kind: 'tournament', tournamentId: 'trn_1' });
    matchOrigin.set('mat_q', { kind: 'command' });
    expect(originLink(matchOrigin.get('mat_c')!)).toEqual({ href: routes.campaign('m1'), label: 'Back to the campaign' });
    expect(matchBack(routes.match('mat_t'), routes.pvp())).toBe(routes.tournament('trn_1'));
    expect(matchBack(`${routes.match('mat_c')}/result`, routes.pvp())).toBe(routes.campaign('m1'));
    // Queued from the crew builder: the debrief keeps its own "Queue again", Back goes home.
    expect(originLink(matchOrigin.get('mat_q')!)).toBeNull();
    expect(matchBack(routes.match('mat_q'), routes.pvp())).toBe(routes.home());
  });

  it('falls back when the origin is unknown or the page is not a match', () => {
    expect(matchBack(routes.match('mat_unknown'), routes.pvp())).toBe(routes.pvp());
    expect(matchBack(routes.lobbies(), routes.pvp())).toBe(routes.pvp());
  });
});
