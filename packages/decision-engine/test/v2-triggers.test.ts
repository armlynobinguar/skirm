import { MAPS_V2, createMatch, observe, type AgentSpec } from '@skirm/engine/v2';
import { describe, expect, it, vi } from 'vitest';
import { activeSkills, createGreedyBrain, createModelBrain, playHeadless } from '../src/v2';

const map = MAPS_V2.find((m) => m.id === 'copper-hollow')!;
const spec = (id: string, role: AgentSpec['role']): AgentSpec => ({ id, name: id, role, vision: 3, comms: 3, tier: 'standard' });
const match = () => createMatch(map, { A: [spec('wick', 'Builder')], B: [spec('wren', 'Digger')] }, { ranked: true });

function fakeFetch(reply: string) {
  return vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }), { status: 200 }));
}
const systemOf = (fetch: ReturnType<typeof fakeFetch>, call = 0) => String(JSON.parse(String(fetch.mock.calls[call]![1].body)).messages[0].content);

describe('skill triggers in the decision engine', () => {
  it('activeSkills keeps the skills whose triggers hold, in order', () => {
    const o = observe(match(), 'wick');
    // Tick 1: nothing carried, score level, the full clock left.
    expect(activeSkills(o, { skills: ['A', 'B', 'C', 'D'], skillTriggers: [null, { kind: 'carrying_item' }, { kind: 'always' }, { kind: 'time_left_under', seconds: 300 }] })).toEqual(['A', 'C']);
    expect(activeSkills(o, { skills: ['A', 'B'] })).toEqual(['A', 'B']);
  });

  it('the model actor and planner get only the active skills', async () => {
    const fetch = fakeFetch('ACTION: 1');
    const brain = createModelBrain({ apiKey: 'k', fetch });
    const o = observe(match(), 'wick');
    const ctx = { skills: ['ALWAYS-ON plan', 'BEHIND-ONLY rally'], skillTriggers: [null, { kind: 'behind_on_score' as const }], plan: null, canSpeak: false };
    await brain.act(o, ctx);
    expect(systemOf(fetch)).toContain('ALWAYS-ON plan');
    expect(systemOf(fetch)).not.toContain('BEHIND-ONLY rally');
    await brain.act({ ...o, score: { mine: 0, rival: 2 } }, ctx);
    expect(systemOf(fetch, 1)).toContain('BEHIND-ONLY rally');
    await brain.plan(o, ctx);
    expect(systemOf(fetch, 2)).not.toContain('BEHIND-ONLY rally');
  });

  it('with every skill inactive the prompt has no skills section', async () => {
    const fetch = fakeFetch('ACTION: 1');
    await createModelBrain({ apiKey: 'k', fetch }).act(observe(match(), 'wick'), { skills: ['Carry rule'], skillTriggers: [{ kind: 'carrying_item' }], plan: null, canSpeak: false });
    expect(systemOf(fetch)).not.toContain('Your skills');
  });

  it('the speech filter still guards an inactive skill', async () => {
    const brain = createModelBrain({ apiKey: 'k', fetch: fakeFetch('ACTION: 1\nSAY: team dam the left tunnel before the pump starts') });
    const d = await brain.act(observe(match(), 'wick'), {
      skills: ['Dam the left tunnel before the pump starts.'],
      skillTriggers: [{ kind: 'carrying_item' }],
      plan: null,
      canSpeak: true,
    });
    expect(d).toMatchObject({ say: null, refusedSay: 'leak' });
  });

  it('the greedy brain plays the same with or without triggers', async () => {
    const run = (skillTriggers?: [{ kind: 'carrying_item' }]) =>
      playHeadless({
        def: map,
        difficulty: 'normal',
        crews: { A: [spec('wick', 'Builder')], B: [spec('wren', 'Digger')] },
        brains: { A: createGreedyBrain(), B: createGreedyBrain() },
        contexts: { wick: { skills: ['x'], ...(skillTriggers ? { skillTriggers } : {}) } },
      });
    const [a, b] = await Promise.all([run(), run([{ kind: 'carrying_item' }])]);
    expect(b.result).toEqual(a.result);
    expect(b.logHash).toBe(a.logHash);
  });
});
