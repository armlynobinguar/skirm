import { describe, expect, it, vi } from 'vitest';
import { MAPS_V2, createMatch, observe, type AgentSpec } from '@skirm/engine/v2';
import { PLAYBOOK_LINE_CHARS, PLAYBOOK_MAX_CHARS, createGreedyBrain, createHaikuBrain, playbookText, systemPrompt } from '../src/v2';

const map = MAPS_V2.find((m) => m.id === 'copper-hollow')!;
const spec = (id: string, role: AgentSpec['role']): AgentSpec => ({ id, name: id, role, vision: 3, comms: 3, tier: 'standard' });
const match = () => createMatch(map, { A: [spec('wick', 'Builder'), spec('moss', 'Digger')], B: [spec('wren', 'Digger'), spec('kes', 'Runner')] }, { ranked: true });

function fakeFetch(reply: string) {
  return vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 900, completion_tokens: 12 } }), { status: 200 }));
}
const systemOf = (fetch: ReturnType<typeof fakeFetch>) => String(JSON.parse(String(fetch.mock.calls[0]![1].body)).messages[0].content);

const BOOK = 'Wick hauls every item to E.\nMoss scouts and calls hazards on team.\nRegroup at E when two are knocked down; deny the rival middle only when we lead.';

describe('crew playbook prompts', () => {
  it('puts the whole playbook after the rules and the owner instructions, ahead of the skills', () => {
    const p = systemPrompt(['Dam first.'], 'Play safe.', { text: BOOK });
    const book = p.indexOf('Crew playbook');
    expect(book).toBeGreaterThan(p.indexOf("Owner's instructions"));
    expect(book).toBeLessThan(p.indexOf('Your skills'));
    expect(p).toContain(BOOK);
    expect(systemPrompt([], null, { text: '   ' })).toBe(systemPrompt([]));
    expect(systemPrompt([], null, null)).not.toContain('Crew playbook');
  });

  it('gives an actor one short line, and cuts text over the limits', () => {
    const line = playbookText(BOOK, true)!;
    expect(line).not.toContain('\n');
    expect([...line].length).toBeLessThanOrEqual(PLAYBOOK_LINE_CHARS);
    expect(systemPrompt([], null, { text: BOOK, short: true })).toContain(`Crew playbook (your player's strategy for the whole crew; the crew plan follows it): ${line}`);
    expect([...playbookText('é'.repeat(PLAYBOOK_MAX_CHARS + 50))!].length).toBe(PLAYBOOK_MAX_CHARS);
  });

  it('sends it to the planner whole and to the actor as a line, and drops speech that repeats it', async () => {
    const planFetch = fakeFetch('Wick hauls, Moss scouts.\nWHY: the playbook says so.');
    await createHaikuBrain({ apiKey: 'k', fetch: planFetch }).plan(observe(match(), 'wick'), { skills: [], playbook: BOOK });
    expect(systemOf(planFetch)).toContain(BOOK);

    const actFetch = fakeFetch('ACTION: 1\nSAY: team moss scouts and calls hazards on team now');
    const d = await createHaikuBrain({ apiKey: 'k', fetch: actFetch }).act(observe(match(), 'wick'), { skills: [], playbook: BOOK, plan: null, canSpeak: true });
    expect(systemOf(actFetch)).toContain(playbookText(BOOK, true)!);
    expect(systemOf(actFetch)).not.toContain(BOOK);
    expect(d).toMatchObject({ say: null, refusedSay: 'leak' });
  });

  it('leaves the greedy brain unchanged', async () => {
    const brain = createGreedyBrain();
    const o = observe(match(), 'wick');
    expect(await brain.act(o, { skills: [], playbook: BOOK, plan: null, canSpeak: true })).toEqual(await brain.act(o, { skills: [], plan: null, canSpeak: true }));
    expect(await brain.plan(o, { skills: [], playbook: BOOK })).toEqual(await brain.plan(o, { skills: [] }));
  });
});
