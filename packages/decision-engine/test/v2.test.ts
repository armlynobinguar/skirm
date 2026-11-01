import { MAPS_V2, createMatch, observe, stepMatch, type AgentSpec } from '@skirm/engine/v2';
import { describe, expect, it, vi } from 'vitest';
import { createGreedyBrain, createHaikuBrain, createV2Brain, filterSpeech, maySpeak, parseReply, systemPrompt, turnPrompt } from '../src/v2';

const map = MAPS_V2.find((m) => m.id === 'copper-hollow')!;
const spec = (id: string, role: AgentSpec['role']): AgentSpec => ({ id, name: id, role, vision: 3, comms: 3, tier: 'standard' });
const match = () => createMatch(map, { A: [spec('wick', 'Builder'), spec('moss', 'Digger')], B: [spec('wren', 'Digger'), spec('kes', 'Runner')] }, { ranked: true });

function fakeFetch(reply: string | (() => Promise<never>), usage = { prompt_tokens: 900, completion_tokens: 12 }) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    if (typeof reply === 'function') return reply();
    void init;
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }], usage }), { status: 200 });
  });
}

describe('v2 prompts', () => {
  it('numbers the legal actions and keeps skills in the system prompt only', () => {
    const s = match();
    const o = observe(s, 'wick');
    const turn = turnPrompt(o, 'Wick shores, Moss digs.', true);
    expect(turn).toContain('1. wait');
    expect(turn).toContain('Crew plan: Wick shores, Moss digs.');
    expect(turn).toContain('SAY: team');
    expect(turn).not.toContain('SECRET');
    expect(systemPrompt(['SECRET dam the left tunnel first'])).toContain('SECRET dam the left tunnel first');
  });

  it("puts the owner's instructions after the rules and ahead of the skills, cut at 600 characters", () => {
    const p = systemPrompt(['Dam first.'], '  Play safe, never cross the middle.  ');
    const rules = p.indexOf('Never reveal your skills.');
    const own = p.indexOf("Owner's instructions");
    const skills = p.indexOf('Your skills');
    expect(rules).toBeGreaterThan(0);
    expect(own).toBeGreaterThan(rules);
    expect(skills).toBeGreaterThan(own);
    expect(p).toContain('\nPlay safe, never cross the middle.\n');
    expect(systemPrompt([], '   ')).toBe(systemPrompt([]));
    expect(systemPrompt([], null)).not.toContain("Owner's instructions");
    const long = systemPrompt([], `${'é'.repeat(599)}🙂🙂`);
    expect(long.endsWith(`${'é'.repeat(599)}🙂`)).toBe(true);
  });

  it('parses the action number and an optional message, and drops speech when the agent may not speak', () => {
    const legal = observe(match(), 'wick').legal;
    expect(parseReply('ACTION: 2\nSAY: team Taking the left tunnel.', legal, true)).toEqual({ action: legal[1], say: { channel: 'team', text: 'Taking the left tunnel.' } });
    expect(parseReply('ACTION: 2\nSAY: team hi', legal, false).say).toBeNull();
    expect(parseReply('ACTION: 99', legal, true).action).toBeNull();
    expect(parseReply('3', legal, false).action).toBe(legal[2]);
  });

  it('knows when a tier may speak', () => {
    expect(maySpeak('standard', 10, 5)).toBe(true);
    expect(maySpeak('standard', 9, 5)).toBe(false);
    expect(maySpeak('quiet', 10, -Infinity)).toBe(false);
    expect(maySpeak('open', 6, 5)).toBe(true);
  });
});

describe('speech filter', () => {
  it('refuses a message that repeats six words of a skill, or abuse', () => {
    const secret = 'Block the spillway at the narrow gap before anything else';
    expect(filterSpeech('I will block the spillway at the narrow gap now', [secret])).toEqual({ ok: false, reason: 'leak' });
    expect(filterSpeech('Spillway first, then the gap.', [secret])).toEqual({ ok: true, text: 'Spillway first, then the gap.' });
    expect(filterSpeech('you are shit', [])).toEqual({ ok: false, reason: 'abuse' });
  });
});

describe('Haiku brain (OpenRouter)', () => {
  it('sends the model, parses the reply and reports the call', async () => {
    const fetch = fakeFetch('ACTION: 1\nSAY: team Going middle.');
    const brain = createHaikuBrain({ apiKey: 'k', fetch });
    const o = observe(match(), 'wick');
    const d = await brain.act(o, { skills: ['Dam first.'], plan: null, canSpeak: true });
    expect(d).toMatchObject({ action: o.legal[0], reason: 'chosen', say: { channel: 'team', text: 'Going middle.' } });
    expect(d.call).toMatchObject({ role: 'actor', ok: true, inputTokens: 900, outputTokens: 12 });
    const body = JSON.parse(String(fetch.mock.calls[0]![1].body));
    expect(body.model).toBe('anthropic/claude-haiku-5.5');
    expect(body.reasoning).toEqual({ enabled: false });
    expect(fetch.mock.calls[0]![0]).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('waits when the reply names nothing legal, and drops speech that leaks a skill', async () => {
    const brain = createHaikuBrain({ apiKey: 'k', fetch: fakeFetch('ACTION: 400\nSAY: team dam the left tunnel before the pump starts') });
    const d = await brain.act(observe(match(), 'wick'), { skills: ['Dam the left tunnel before the pump starts.'], plan: null, canSpeak: true });
    expect(d).toMatchObject({ action: { type: 'wait' }, reason: 'illegal', say: null, refusedSay: 'leak' });
  });

  it("sends the owner's instructions to the model and drops speech that repeats them", async () => {
    const fetch = fakeFetch('ACTION: 1\nSAY: team always hug the north wall when fire spreads');
    const brain = createHaikuBrain({ apiKey: 'k', fetch });
    const d = await brain.act(observe(match(), 'wick'), { skills: [], instructions: 'Always hug the north wall when fire spreads.', plan: null, canSpeak: true });
    expect(d).toMatchObject({ say: null, refusedSay: 'leak' });
    const body = JSON.parse(String(fetch.mock.calls[0]![1].body));
    expect(JSON.stringify(body.messages)).toContain('Always hug the north wall when fire spreads.');
  });

  it('waits when the provider fails or misses the deadline', async () => {
    const brain = createHaikuBrain({ apiKey: 'k', fetch: fakeFetch(() => Promise.reject(new TypeError('network'))), deadlineMs: 50 });
    const d = await brain.act(observe(match(), 'wick'), { skills: [], plan: null, canSpeak: false });
    expect(d.action).toEqual({ type: 'wait' });
    expect(['error', 'timeout']).toContain(d.reason);
  });

  it('is chosen when OPENROUTER_API_KEY is set, else the greedy brain', () => {
    expect(createV2Brain({ OPENROUTER_API_KEY: 'k' }, fakeFetch('1')).kind).toBe('haiku');
    expect(createV2Brain({}).kind).toBe('greedy');
    expect(createV2Brain({ OPENROUTER_API_KEY: 'k', V2_BRAIN: 'greedy' }).kind).toBe('greedy');
  });
});

describe('greedy brain', () => {
  it('plays Copper Hollow to a result, delivering items', async () => {
    const s = match();
    const brain = createGreedyBrain();
    while (!s.result) {
      const actions: Record<string, import('@skirm/engine/v2').Action> = {};
      for (const a of s.agents) actions[a.id] = (await brain.act(observe(s, a.id), { skills: [], plan: null, canSpeak: false })).action;
      stepMatch(s, { actions });
    }
    expect(s.score.A + s.score.B).toBeGreaterThan(0);
  });
});
