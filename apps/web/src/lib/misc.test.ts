import { describe, expect, it } from 'vitest';
import { errorFromBody, errorCopy } from './api/errors';
import { createCredentialsStore, normaliseDevHandle } from './auth/credentials';
import { formatNear, parseNear } from './constants';
import { navGroupOf, routes, screenOf } from './routes';

describe('routes', () => {
  it('maps paths to header groups', () => {
    expect(navGroupOf(routes.crew('flood-gate'))).toBe('play');
    expect(navGroupOf(routes.atlas())).toBe('play');
    expect(navGroupOf('/runs/run_1')).toBeNull();
    expect(navGroupOf(routes.editSkill('skl_1'))).toBe('skills');
    expect(navGroupOf(routes.marketSkill('skl_1'))).toBe('market');
    expect(navGroupOf(routes.match('mat_1'))).toBe('pvp');
    expect(navGroupOf(routes.credits())).toBe('account');
    expect(navGroupOf('/')).toBeNull();
    expect(navGroupOf('/playground')).toBeNull();
  });

  it('names each screen for the HUD crumb, Back and the wipe', () => {
    expect(screenOf(routes.home())).toEqual({ key: 'home', title: 'Command', sub: '// home', back: null });
    expect(screenOf(routes.crew('flood-gate'))).toMatchObject({ key: 'crew', title: 'Lock in', back: '/play' });
    expect(screenOf(routes.atlas())).toMatchObject({ key: 'maps', title: 'Atlas' });
    expect(screenOf(routes.matchResult('mat_1'))).toMatchObject({ key: 'match-result', back: '/pvp' });
    expect(screenOf(routes.match('mat_1'))).toMatchObject({ key: 'match', title: 'Live' });
    expect(screenOf(routes.marketSkill('skl_1'))).toMatchObject({ key: 'market', title: 'Exchange' });
    expect(screenOf(routes.credits())).toMatchObject({ key: 'credits', back: '/account' });
    expect(screenOf(routes.account())).toMatchObject({ key: 'account', title: 'Profile' });
    expect(screenOf(routes.agent('agt_1'))).toMatchObject({ key: 'agent', title: 'Agent', back: '/play' });
    expect(navGroupOf(routes.agent('agt_1'))).toBe('play');
    expect(routes.crew('copper-hollow', 'hard')).toBe('/maps/copper-hollow/crew?d=hard');
    expect(routes.match('mat_1')).toBe('/matches/mat_1');
    expect(routes.matchResult('mat_1')).toBe('/matches/mat_1/result');
    expect(screenOf('/')).toBeNull();
  });
});

describe('NEAR amounts', () => {
  it('formats and parses yoctoNEAR', () => {
    expect(formatNear('1250000000000000000000000')).toBe('1.25');
    expect(formatNear(10n ** 24n * 3n)).toBe('3');
    expect(parseNear('1.25')).toBe('1250000000000000000000000');
    expect(() => parseNear('1,5')).toThrow();
  });

  it('parseNear is strict', () => {
    expect(parseNear(' 2 ')).toBe('2000000000000000000000000');
    expect(parseNear('0.000000000000000000000001')).toBe('1');
    expect(parseNear('1.' + '9'.repeat(24))).toBe('1' + '9'.repeat(24));
    for (const bad of ['1.2.3', '-1', '1e3', '1E3', '1,5', '', '.', '.5', '1.', '+1', '0x10', '1 2', 'NaN'])
      expect(() => parseNear(bad), bad).toThrow();
    expect(() => parseNear('1.' + '0'.repeat(25))).toThrow();
  });
});

describe('credentials', () => {
  it('normalises dev handles like the server', () => {
    expect(normaliseDevHandle('  Ada ')).toBe('ada');
    expect(normaliseDevHandle('a')).toBeNull();
    expect(normaliseDevHandle('has space')).toBeNull();
  });

  it('persists the dev handle', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    createCredentialsStore({ storage }).set({ kind: 'dev', handle: 'ada' });
    expect(createCredentialsStore({ storage }).get()).toEqual({ kind: 'dev', handle: 'ada' });
    createCredentialsStore({ storage }).set(null);
    expect(createCredentialsStore({ storage }).get()).toBeNull();
  });
});

describe('errors', () => {
  it('gives spec copy with the shortfall', () => {
    const e = errorFromBody(402, { error: { code: 'insufficient_credits', message: 'x', need: 150, have: 80 } });
    expect(errorCopy(e)).toMatchObject({ title: 'Not enough credits', message: 'Need 150, have 80. Top up or remove an agent.' });
    expect(errorFromBody(500, null).code).toBe('http_500');
  });
});
