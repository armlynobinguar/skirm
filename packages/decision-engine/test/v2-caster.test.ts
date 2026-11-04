import type { ReplayHighlight } from '@skirm/engine/v2';
import { describe, expect, it, vi } from 'vitest';
import { CASTER_LINE_MAX, casterPrompt, createModelCaster, createTemplateCaster, parseCasterReply, templateLine } from '../src/v2';

const hl = (kind: ReplayHighlight['kind'], tick: number, title: string): ReplayHighlight => ({
  id: `${kind}-${tick}`,
  kind,
  tick,
  start: tick - 6,
  end: tick + 4,
  team: 'A',
  title,
  facts: `${title}. Score: ana 1, ben 0.`,
  weight: 5,
  score: { A: 1, B: 0 },
});

const input = { mapName: 'Copper Hollow', crews: { A: 'ana', B: 'ben' }, highlights: [hl('goal', 30, 'Rook delivers the goal'), hl('switch_flood', 12, "Rook floods ben's lane")] };

const reply = (content: string, cost?: number) =>
  vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 300, completion_tokens: 60, ...(cost !== undefined ? { cost } : {}) } }), { status: 200 }));

describe('replay caster', () => {
  it('template lines are deterministic, short and name the moment', async () => {
    const a = await createTemplateCaster().cast(input);
    const b = await createTemplateCaster().cast(input);
    expect(a).toEqual(b);
    expect(a.caster).toBe('template');
    expect(a.costUsd).toBe(0);
    expect(a.lines['goal-30']).toContain('Rook delivers the goal');
    for (const l of Object.values(a.lines)) expect(l.length).toBeLessThanOrEqual(CASTER_LINE_MAX);
    expect(templateLine(input.highlights[1]!, input.crews)).toBe(a.lines['switch_flood-12']);
  });

  it('the prompt carries only the public facts', () => {
    const { user } = casterPrompt(input);
    expect(user).toContain('goal-30 (tick 30): Rook delivers the goal');
    expect(user).toContain('Crew A: ana');
  });

  it('parses id lines and ignores unknown ids', () => {
    expect(parseCasterReply('goal-30: What a finish!\nfoo-1: nope\n- `switch_flood-12`: "Splash!"', ['goal-30', 'switch_flood-12'])).toEqual({ 'goal-30': 'What a finish!', 'switch_flood-12': 'Splash!' });
  });

  it('the model writes the lines; a missing one falls back to the template, and its cost is reported', async () => {
    const fetch = reply('goal-30: Rook slams it home, ana take it!', 0.00012);
    const usage = vi.fn();
    const r = await createModelCaster({ apiKey: 'k', fetch, onUsage: usage }).cast(input);
    expect(r.caster).toBe('model');
    expect(r.lines['goal-30']).toBe('Rook slams it home, ana take it!');
    expect(r.lines['switch_flood-12']).toBe(templateLine(input.highlights[1]!, input.crews));
    expect(r.costUsd).toBe(0.00012);
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({ ok: true, costUsd: 0.00012, billed: true }));
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.model).toBe('anthropic/claude-haiku-5.5');
  });

  it('a failed call casts the whole match from the template', async () => {
    const fetch = vi.fn(async () => new Response('down', { status: 500 }));
    const r = await createModelCaster({ apiKey: 'k', fetch, deadlineMs: 200 }).cast(input);
    expect(r.caster).toBe('template');
    expect(r.lines).toEqual((await createTemplateCaster().cast(input)).lines);
  });
});
