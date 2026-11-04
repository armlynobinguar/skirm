// The debrief's decision timeline from the brain's side: the SKILL line (which equipped skill drove a
// move) and the one-line observation summary.
import { MAPS_V2, createMatch, observe, type AgentSpec } from '@skirm/engine/v2';
import { describe, expect, it, vi } from 'vitest';
import { MAX_OBSERVED_CHARS, createGreedyBrain, createHaikuBrain, observedSummary, parseReply, turnPrompt } from '../src/v2';

const map = MAPS_V2.find((m) => m.id === 'copper-hollow')!;
const spec = (id: string, role: AgentSpec['role']): AgentSpec => ({ id, name: id, role, vision: 3, comms: 3, tier: 'standard' });
const match = () => createMatch(map, { A: [spec('wick', 'Builder'), spec('moss', 'Digger')], B: [spec('wren', 'Digger'), spec('kes', 'Runner')] }, { ranked: true });

const reply = (content: string) =>
  vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 }));

describe('v2 skill attribution', () => {
  it('asks for a SKILL line only when the agent carries skills', () => {
    const o = observe(match(), 'wick');
    expect(turnPrompt(o, null, false)).not.toContain('SKILL:');
    expect(turnPrompt(o, null, false, [], null, 2)).toContain('"SKILL: <its number, 1 to 2>"');
  });

  it('parses the SKILL line within the numbered skills and ignores it otherwise', () => {
    const { legal } = observe(match(), 'wick');
    expect(parseReply('ACTION: 1\nSKILL: 2', legal, false, 2).skill).toBe(2);
    expect(parseReply('ACTION: 1\nSKILL: 3', legal, false, 2).skill).toBeUndefined();
    expect(parseReply('ACTION: 1\nSKILL: 1', legal, false).skill).toBeUndefined();
    expect(parseReply('ACTION: 1', legal, false, 2)).not.toHaveProperty('skill');
  });

  it('maps the SKILL number back to the context skills, skipping blank ones', async () => {
    const o = observe(match(), 'wick');
    const brain = createHaikuBrain({ apiKey: 'k', fetch: reply('ACTION: 1\nTHINK: Dam it.\nSKILL: 2') });
    // The system prompt numbers "Dam first." 1 and "Dig later." 2; the blank one is not numbered.
    const d = await brain.act(o, { skills: ['Dam first.', '  ', 'Dig later.'], plan: null, canSpeak: false });
    expect(d.skill).toBe(2);
    const none = await createHaikuBrain({ apiKey: 'k', fetch: reply('ACTION: 400\nSKILL: 1') }).act(o, { skills: ['Dam first.'], plan: null, canSpeak: false });
    expect(none.reason).toBe('illegal');
    expect(none.skill).toBeUndefined();
  });

  it('greedy never names a skill (it plays without them)', async () => {
    const d = await createGreedyBrain().act(observe(match(), 'wick'), { skills: ['Dam first.'], plan: null, canSpeak: false });
    expect(d.skill).toBeUndefined();
  });
});

describe('v2 observation summary', () => {
  it('says where the agent stands, what it carries, the score and nothing of its skills', () => {
    const o = observe(match(), 'wick');
    const line = observedSummary(o);
    expect(line).toContain(`At ${o.me.x},${o.me.y} carrying 0/${o.me.capacity}`);
    expect(line).toContain('score 0–0');
    expect([...line].length).toBeLessThanOrEqual(MAX_OBSERVED_CHARS);
  });

  it('adds the last line heard, cut short', () => {
    const o = observe(match(), 'wick');
    o.heard = [{ tick: 0, from: 'kes', fromName: 'Kes', team: 'B', channel: 'say', text: 'x'.repeat(100), overheard: false }];
    const line = observedSummary(o);
    expect(line).toContain('heard Kes: "');
    expect(line).toContain('…"');
  });
});
