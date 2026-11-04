import { MAPS_V2, createMatch, observe, stepMatch, type AgentSpec, type Observation } from '@skirm/engine/v2';
import { describe, expect, it, vi } from 'vitest';
import { MAX_THOUGHT_CHARS, createGreedyBrain, greedyThought, createModelBrain, createV2Brain, filterSpeech, maySpeak, parsePlan, parseReply, planPrompt, systemPrompt, turnPrompt } from '../src/v2';

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
    expect(parseReply('ACTION: 2\nSAY: team Taking the left tunnel.', legal, true)).toEqual({ action: legal[1], say: { channel: 'team', text: 'Taking the left tunnel.' }, thought: null });
    expect(parseReply('ACTION: 2\nSAY: team hi', legal, false).say).toBeNull();
    expect(parseReply('ACTION: 99', legal, true).action).toBeNull();
    expect(parseReply('3', legal, false).action).toBe(legal[2]);
  });

  it('explains bluffs in the rules and tells a fooled agent what it believes', () => {
    expect(systemPrompt([])).toContain('What you can see is never a lie');
    const s = match();
    const wick = s.agents.find((a) => a.id === 'wick')!;
    const tile = 3 * s.map.w + 20;
    wick.heardBluff = { by: 'Wren', tile, tick: s.tick, believed: true };
    wick.avoid = { tile, until: s.tick + 5 };
    expect(observe(s, 'wick').bluff).toEqual({ by: 'Wren', at: [20, 3], believed: true, ticksLeft: 5 });
    expect(turnPrompt(observe(s, 'wick'), null, false)).toContain('You believe Wren: the lamp oil at 20,3 is gone. You cannot see it, so you treat it as gone for 5 more ticks.');
    wick.heardBluff = { by: 'Wren', tile, tick: s.tick, believed: false };
    wick.avoid = null;
    expect(turnPrompt(observe(s, 'wick'), null, false)).toContain('you did not believe it');
    // A doubted bluff is news for one turn only; a believed one lasts as long as the belief.
    s.tick++;
    expect(observe(s, 'wick').bluff).toBeUndefined();
  });

  it('asks for an inner voice and a plan reason, and reads them apart from the action and plan', () => {
    const o = observe(match(), 'wick');
    expect(turnPrompt(o, null, false)).toContain('THINK:');
    expect(turnPrompt(o, null, true)).toContain('THINK:');
    const r = parseReply('ACTION: 2\nSAY: team Left tunnel.\nTHINK: "Kes is slow, I can beat him to the lamp."', o.legal, true);
    expect(r).toMatchObject({ action: o.legal[1], say: { text: 'Left tunnel.' }, thought: 'Kes is slow, I can beat him to the lamp.' });
    expect(parseReply('ACTION: 1', o.legal, false).thought).toBeNull();
    expect(parseReply(`ACTION: 1\nTHINK: ${'x'.repeat(200)}`, o.legal, false).thought).toHaveLength(MAX_THOUGHT_CHARS);

    expect(planPrompt(o)).toContain('WHY:');
    expect(parsePlan('Wick shores the left.\nMoss digs.\nWHY: the pump floods the right first.')).toEqual({
      plan: 'Wick shores the left.\nMoss digs.',
      why: 'the pump floods the right first.',
    });
    expect(parsePlan('Just go.')).toEqual({ plan: 'Just go.', why: null });
    expect(parsePlan('WHY: only a reason')).toEqual({ plan: null, why: 'only a reason' });
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

describe('model brain (OpenRouter default)', () => {
  it('sends the model, parses the reply and reports the call', async () => {
    const fetch = fakeFetch('ACTION: 1\nSAY: team Going middle.');
    const brain = createModelBrain({ apiKey: 'k', fetch });
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
    const brain = createModelBrain({ apiKey: 'k', fetch: fakeFetch('ACTION: 400\nSAY: team dam the left tunnel before the pump starts') });
    const d = await brain.act(observe(match(), 'wick'), { skills: ['Dam the left tunnel before the pump starts.'], plan: null, canSpeak: true });
    expect(d).toMatchObject({ action: { type: 'wait' }, reason: 'illegal', say: null, refusedSay: 'leak' });
  });

  it("sends the owner's instructions to the model and drops speech that repeats them", async () => {
    const fetch = fakeFetch('ACTION: 1\nSAY: team always hug the north wall when fire spreads');
    const brain = createModelBrain({ apiKey: 'k', fetch });
    const d = await brain.act(observe(match(), 'wick'), { skills: [], instructions: 'Always hug the north wall when fire spreads.', plan: null, canSpeak: true });
    expect(d).toMatchObject({ say: null, refusedSay: 'leak' });
    const body = JSON.parse(String(fetch.mock.calls[0]![1].body));
    expect(JSON.stringify(body.messages)).toContain('Always hug the north wall when fire spreads.');
  });

  it('returns the inner voice with the action, and the planner reason with the plan', async () => {
    const actor = createModelBrain({ apiKey: 'k', fetch: fakeFetch('ACTION: 1\nTHINK: Nobody near the lift. Go now.') });
    const d = await actor.act(observe(match(), 'wick'), { skills: [], plan: null, canSpeak: false });
    expect(d).toMatchObject({ reason: 'chosen', thought: 'Nobody near the lift. Go now.' });
    const planner = createModelBrain({ apiKey: 'k', fetch: fakeFetch('Wick shores, Moss digs.\nWHY: the pump floods our side first.') });
    expect(await planner.plan(observe(match(), 'wick'), { skills: [] })).toMatchObject({ text: 'Wick shores, Moss digs.', why: 'the pump floods our side first.' });
  });

  it('waits when the provider fails or misses the deadline', async () => {
    const brain = createModelBrain({ apiKey: 'k', fetch: fakeFetch(() => Promise.reject(new TypeError('network'))), deadlineMs: 50 });
    const d = await brain.act(observe(match(), 'wick'), { skills: [], plan: null, canSpeak: false });
    expect(d.action).toEqual({ type: 'wait' });
    expect(['error', 'timeout']).toContain(d.reason);
  });

  it('is chosen when a model key (OPENROUTER_API_KEY alias) is set, else the greedy brain', () => {
    expect(createV2Brain({ OPENROUTER_API_KEY: 'k' }, fakeFetch('1')).kind).toBe('model');
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

  it('reads a plan, its reason and an inner voice off what greedy does, the same every time', async () => {
    const s = match();
    const o = observe(s, 'wick');
    const brain = createGreedyBrain();
    const p = await brain.plan(o, { skills: [] });
    expect(p.text).toMatch(/to go\.$/);
    expect(p.why).toMatch(/rival has 0 of 4/);
    const d = await brain.act(o, { skills: [], plan: null, canSpeak: false });
    expect(d.thought).toBeTruthy();
    expect([...d.thought!].length).toBeLessThanOrEqual(80);
    expect(await brain.act(o, { skills: [], plan: null, canSpeak: false })).toEqual(d);
    expect(greedyThought(o, { type: 'switch' })).toBe('Switch is ready. Flooding their lane.');
  });

  /** A hand-made view: `rows` with `@` where the agent stands, legal moves onto open tiles. */
  function view(rows: string[], o: { carrying?: number; others?: [number, number][]; exit?: [number, number] } = {}): Observation {
    const y = rows.findIndex((r) => r.includes('@'));
    const x = rows[y]!.indexOf('@');
    const clean = rows.map((r) => r.replace('@', '.'));
    const ey = clean.findIndex((r) => r.includes('E'));
    const ex: [number, number] = o.exit ?? [ey >= 0 ? clean[ey]!.indexOf('E') : -1, ey];
    const step = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] } as const;
    const legal: Observation['legal'] = [{ type: 'wait' }];
    for (const d of ['N', 'E', 'S', 'W'] as const) if ('.*E,'.includes(clean[y + step[d][1]]![x + step[d][0]]!)) legal.push({ type: 'move', dir: d });
    const other = (p: [number, number], i: number) => ({ id: `o${i}`, name: `O${i}`, team: 'B' as const, role: 'Runner' as const, x: p[0], y: p[1], carrying: 0, down: false });
    return {
      tick: 10,
      ticksLeft: 100,
      map: { id: 'm', name: 'M', w: clean[0]!.length, h: clean.length, goal: 3, item: 'Lamp oil', deliverTo: 'Lift', exit: ex },
      rows: clean,
      me: { id: 'me', name: 'Me', team: 'A', role: 'Runner', x, y, carrying: o.carrying ?? 0, capacity: 2, tier: 'standard' },
      teammates: [],
      rivals: (o.others ?? []).map(other),
      score: { mine: 0, rival: 0 },
      blocksLeft: 2,
      verbs: [],
      heard: [],
      legal,
    };
  }
  const act = async (o: Observation) => (await createGreedyBrain().act(o, { skills: [], plan: null, canSpeak: false })).action;

  it('steps off the delivery point when it has nothing left to do', async () => {
    expect(await act(view(['#####', '#.@.#', '#####'], { exit: [2, 1] }))).toMatchObject({ type: 'move' });
    // Elsewhere, alone and idle, it waits.
    expect(await act(view(['#####', '#@.E#', '#####']))).toEqual({ type: 'wait' });
  });

  it('steps aside for an agent next to it when idle, but not onto the delivery point', async () => {
    // A corridor: the rival below needs the tile; the only free sides are W and E (N is the delivery point).
    const o = view(['#######', '###E###', '##.@.##', '###.###', '#######'], { others: [[3, 3]] });
    const a = await act(o);
    expect(a.type).toBe('move');
    expect(a.type === 'move' && ['W', 'E']).toContain(a.type === 'move' && a.dir);
  });

  it('routes around tiles next to lava when there is another way', async () => {
    // Item to the south-east; the straight row runs along the lava, the row below does not, and the
    // item itself may sit next to lava (the last step is allowed).
    expect(await act(view(['#######', '#LLLLL#', '#@....#', '#....*#', '#######']))).toEqual({ type: 'move', dir: 'S' });
    expect(await act(view(['#######', '#LLLLL#', '#@...*#', '#.....#', '#######']))).toEqual({ type: 'move', dir: 'S' });
    // With no other way it still goes.
    expect(await act(view(['#######', '#LLLLL#', '#@...*#', '#######']))).toEqual({ type: 'move', dir: 'E' });
  });
});
