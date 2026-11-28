import { describe, expect, it } from 'vitest';
import { innerVoiceOf, type VoiceContext } from './visorVoice';

const ctx: VoiceContext = { team: 'A', item: 'Lamp oil', deliverTo: 'Cage lift', dist: 7 };
const base = { name: 'Wick', team: 'A' as const, items: [], down: false, out: false };

describe('visor inner voice', () => {
  it('speaks the agent’s own inner voice first, then its plan', () => {
    expect(innerVoiceOf({ ...base, thought: 'The middle is open.', plan: 'Take the oil' }, ctx)).toEqual({ kick: 'Inner voice', text: 'The middle is open.' });
    expect(innerVoiceOf({ ...base, plan: 'Take the oil in the west hall' }, ctx)).toEqual({ kick: 'Intent', text: 'Take the oil in the west hall' });
  });

  it('falls back to what it is doing', () => {
    expect(innerVoiceOf({ ...base, items: [{ kind: 'item', origin: 'own' }] }, ctx).text).toBe('Lamp oil in hand. The cage lift is 7 tiles out.');
    expect(innerVoiceOf({ ...base, items: [{ kind: 'item', origin: 'own' }, { kind: 'item', origin: 'drop' }] }, ctx).text).toBe('2 × lamp oil in hand. The cage lift is 7 tiles out.');
    expect(innerVoiceOf(base, ctx).text).toBe('Hands empty. Looking for lamp oil.');
    expect(innerVoiceOf({ ...base, down: true, thought: 'x' }, ctx).text).toMatch(/Swept/);
    expect(innerVoiceOf({ ...base, out: true }, ctx).text).toMatch(/Out of the match/);
  });

  it('keeps a bought skill’s reasons and a rival’s mind private', () => {
    expect(innerVoiceOf({ ...base, planHidden: true }, ctx).text).toMatch(/bought skill/);
    expect(innerVoiceOf({ ...base, team: 'B' }, ctx)).toEqual({ kick: 'Sealed mind', text: 'You hear only what Wick says aloud.' });
    // Practice ships the bot’s mind: then it is shown.
    expect(innerVoiceOf({ ...base, team: 'B', plan: 'Block the lift' }, ctx).text).toBe('Block the lift');
  });
});
