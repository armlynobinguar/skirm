import { ROLES } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { mapById } from '@/features/arena/world';
import { agentFixture } from '@/test/fixtures';
import { TIER_INFO, TIER_ORDER, agentEditorHref, agentRole, agentVoice, fmtRate, headStartLine, ratePerTick, verbFit } from './agentView';
import { INNER, innerLine, plural, sampleContext, sampleInner, starterPersona } from './voice';

const copper = mapById('copper-hollow')!;

describe('inner voice', () => {
  it('fills a line from the context and adds the voice tail', () => {
    const c = sampleContext('Builder', copper);
    expect(c.item).toBe(copper.item.toLowerCase());
    const line = innerLine({ name: 'Wick', voice: 'Calm' }, 'collect', c, 0);
    expect(line).toMatch(new RegExp(`^I should go to the ${c.item} 4 tiles out\\.`));
    expect(line).not.toMatch(/\{\w+\}/);
  });

  it('cuts a Quiet agent to its first sentence', () => {
    const c = sampleContext('Digger', copper);
    expect(innerLine({ name: 'Pike', voice: 'Quiet' }, 'delivered', c, 0)).toBe('Delivered…');
  });

  it('sees through the bluff with sharp eyes and falls for it without', () => {
    const sharp = sampleInner({ name: 'Rook', voice: 'Cocky', role: 'Scout', vision: 5 }, copper, 0);
    const dim = sampleInner({ name: 'Pike', voice: 'Calm', role: 'Digger', vision: 2 }, copper, 0);
    expect(INNER.doubted.some((t) => sharp[1].startsWith(t.replace('{liar}', 'Juno').split('.')[0]!))).toBe(true);
    expect(INNER.fooled.some((t) => dim[1].startsWith(t.replace('{liar}', 'Juno').split('.')[0]!))).toBe(true);
    expect(sampleInner({ name: 'Rook', voice: 'Cocky', role: 'Scout', vision: 5 }, copper, 1)[0]).not.toBe(sharp[0]);
  });

  it('names the role verb of the map, and moves when the role has none here', () => {
    const fit = verbFit('Builder', copper);
    expect(sampleContext('Builder', copper).verb).toBe(fit.verb ? fit.verb.toLowerCase() : 'move');
    expect(sampleContext('Runner', copper).verb).toBe('move');
    expect(plural('Lamp oil', 2)).toBe('lamps');
    expect(plural('Crate', 1)).toBe('crate');
  });

  it('has a starter persona for every role, in the agent name', () => {
    for (const r of ROLES) expect(starterPersona('Nox', r)).toMatch(new RegExp(`^You are Nox, an? ${r}`));
    for (const r of ROLES) expect(starterPersona('Nox', r).length).toBeLessThanOrEqual(600);
  });
});

describe('agent view', () => {
  it('reads the role and takes the voice from the role', () => {
    expect(agentRole(agentFixture({ role: 'Hauler' }))).toBe('Hauler');
    expect(agentVoice(agentFixture({ role: 'Scout' }))).toBe('Cocky');
  });

  it('prices talk and words the head start', () => {
    expect(ratePerTick(['quiet', 'standard', 'open'])).toBe(0.8);
    expect(ratePerTick(['quiet'])).toBe(0.2);
    expect(ratePerTick(['open', 'open'])).toBe(0.8);
    expect(fmtRate(ratePerTick(['quiet', 'standard', 'open']))).toBe('0.80');
    expect(TIER_ORDER.map((t) => fmtRate(TIER_INFO[t].rate))).toEqual(['0.20', '0.20', '0.40']);
    expect(headStartLine(3, 2)).toEqual({ text: 'Rival fields 2 · they start 10 s ahead', tone: 'rival' });
    expect(headStartLine(1, 3)).toEqual({ text: 'Rival fields 3 · you start 20 s ahead', tone: 'you' });
    expect(headStartLine(2, 2).tone).toBeNull();
  });

  it('links the editor back to the crew screen it came from', () => {
    expect(agentEditorHref('agt_1')).toBe('/agents/agt_1');
    expect(agentEditorHref('agt_1', { mapId: 'copper-hollow', difficulty: 'hard' })).toBe('/agents/agt_1?map=copper-hollow&d=hard');
  });
});
