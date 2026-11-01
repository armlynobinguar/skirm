import { describe, expect, it } from 'vitest';
import { DEFAULTS, rankTitle } from '../src/index';

describe('rank titles', () => {
  it('starts a new player at Breach Runner II', () => {
    expect(rankTitle(DEFAULTS.elo.start).title).toBe('Breach Runner II');
    expect(rankTitle(1240)).toEqual({ title: 'Breach Runner II', tier: 'Breach Runner', division: 2, nextAt: 1300 });
  });

  it('walks the bands and divisions at their edges', () => {
    expect(rankTitle(100).title).toBe('Recruit');
    expect(rankTitle(799)).toEqual({ title: 'Recruit', tier: 'Recruit', division: null, nextAt: 800 });
    expect(rankTitle(800).title).toBe('Lane Scout I');
    expect(rankTitle(1099).title).toBe('Lane Scout III');
    expect(rankTitle(1399)).toEqual({ title: 'Breach Runner III', tier: 'Breach Runner', division: 3, nextAt: 1400 });
    expect(rankTitle(1400).title).toBe('Hazard Warden I');
    expect(rankTitle(2400)).toEqual({ title: 'Storm Marshal', tier: 'Storm Marshal', division: null, nextAt: null });
  });
});
