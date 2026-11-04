// Live commands in the brains: the order goes into the actor's turn prompt (after the plan, with
// the ticks it has left), and the greedy brain follows the presets it can read off the board.
import type { Action, Observation } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import {
  createGreedyBrain,
  createHaikuBrain,
  greedyAct,
  greedyCommanded,
  turnPrompt,
} from '../src/v2';

const mv = (dir: 'N' | 'E' | 'S' | 'W'): Action => ({ type: 'move', dir });

/** A hand-made observation; `legal` defaults to wait and every open step. */
function obs(rows: string[], me: [number, number], o: Partial<Observation> = {}): Observation {
  let exit: [number, number] = [0, 0];
  rows.forEach((r, y) => {
    const x = r.indexOf('E');
    if (x >= 0) exit = [x, y];
  });
  const open = (x: number, y: number) => '.,*E'.includes(rows[y]?.[x] ?? '#');
  const legal: Action[] = [{ type: 'wait' }];
  if (open(me[0], me[1] - 1)) legal.push(mv('N'));
  if (open(me[0] + 1, me[1])) legal.push(mv('E'));
  if (open(me[0], me[1] + 1)) legal.push(mv('S'));
  if (open(me[0] - 1, me[1])) legal.push(mv('W'));
  return {
    tick: 3,
    ticksLeft: 147,
    map: {
      id: 't',
      name: 'T',
      w: rows[0]!.length,
      h: rows.length,
      goal: 3,
      item: 'Gem',
      deliverTo: 'Exit',
      exit,
    },
    rows,
    me: {
      id: 'a',
      name: 'A',
      team: 'A',
      role: 'Runner',
      x: me[0],
      y: me[1],
      carrying: 0,
      capacity: 2,
      tier: 'standard',
    },
    teammates: [],
    rivals: [],
    score: { mine: 0, rival: 0 },
    blocksLeft: 0,
    verbs: [],
    heard: [],
    legal,
    ...o,
  };
}

const mate = (x: number, y: number) => ({
  id: 'b',
  name: 'B',
  team: 'A' as const,
  role: 'Runner' as const,
  x,
  y,
  carrying: 0,
  down: false,
});
const ROWS = ['#########', '#.......#', '#...E...#', '#.......#', '#########'];

describe('v2 live commands in the brains', () => {
  it('puts the order after the plan in the turn prompt, with the ticks it has left', () => {
    const o = obs(ROWS, [1, 1]);
    const p = turnPrompt(o, 'Everyone gathers gems.', false, [], {
      order: 'Regroup: move back next to your crew mates.',
      ticksLeft: 4,
    });
    expect(p).toContain(
      'Order from your player (follow it over the crew plan, within the rules, for 4 more ticks): Regroup: move back next to your crew mates.',
    );
    expect(p.indexOf('Crew plan:')).toBeLessThan(p.indexOf('Order from your player'));
    expect(turnPrompt(o, null, false)).not.toContain('Order from your player');
  });

  it('sends the order to the model in the actor call', async () => {
    let body = '';
    const fetch = async (_url: string, init?: { body?: string }) => {
      body = String(init?.body ?? '');
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ACTION: 1' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200 },
      );
    };
    const brain = createHaikuBrain({ apiKey: 'k', fetch: fetch as never });
    await brain.act(obs(ROWS, [1, 1]), {
      skills: [],
      plan: null,
      canSpeak: false,
      command: { preset: 'hold_gate', order: 'Hold the gate now.', ticksLeft: 2 },
    });
    expect(body).toContain('Hold the gate now.');
  });

  it('regroup: greedy walks back to its crew mate, then stays with it', () => {
    const far = obs(ROWS, [1, 1], { teammates: [mate(7, 3)] });
    const step = greedyCommanded(far, { preset: 'regroup' });
    expect(step && step.type === 'move' && ['E', 'S'].includes(step.dir)).toBe(true);
    expect(
      greedyCommanded(obs(ROWS, [6, 3], { teammates: [mate(7, 3)] }), { preset: 'regroup' }),
    ).toEqual({ type: 'wait' });
    // Nobody to regroup with: plays as usual.
    expect(greedyCommanded(obs(ROWS, [1, 1]), { preset: 'regroup' })).toBeNull();
  });

  it('hold_gate: greedy goes to the delivery point, holds next to it and steps off it', () => {
    expect(greedyCommanded(obs(ROWS, [1, 2]), { preset: 'hold_gate' })).toEqual(mv('E'));
    expect(greedyCommanded(obs(ROWS, [3, 2]), { preset: 'hold_gate' })).toEqual({ type: 'wait' });
    const on = greedyCommanded(obs(ROWS, [4, 2], { teammates: [mate(5, 2)] }), {
      preset: 'hold_gate',
    });
    expect(on?.type).toBe('move');
  });

  it('go_drop: greedy heads for the target tile, and without one plays as usual', () => {
    const rows = ['#########', '#.......#', '#...E..*#', '#.......#', '#########'];
    expect(greedyCommanded(obs(rows, [7, 1]), { preset: 'go_drop', targets: [[7, 2]] })).toEqual(
      mv('S'),
    );
    expect(greedyCommanded(obs(rows, [7, 1]), { preset: 'go_drop', targets: [] })).toBeNull();
  });

  it('block_flow: greedy builds toward a hazard next to it', () => {
    const rows = ['#######', '#..~..#', '#.....#', '#..E..#', '#######'];
    const sandbag: Action = { type: 'verb', verb: 'sandbag', dir: 'N' };
    const o = obs(rows, [3, 2], {
      verbs: [{ id: 'sandbag', name: 'Sandbag', effect: 'add_solid' }],
      legal: [{ type: 'wait' }, mv('E'), sandbag],
    });
    expect(greedyCommanded(o, { preset: 'block_flow' })).toEqual(sandbag);
    expect(greedyAct(o, { preset: 'block_flow' })).toEqual(sandbag);
    // Free text alone, or a full agent, means nothing to greedy.
    expect(greedyCommanded(o, { preset: null })).toBeNull();
    expect(
      greedyCommanded({ ...o, me: { ...o.me, carrying: 2 } }, { preset: 'block_flow' }),
    ).toBeNull();
  });

  it('the greedy brain passes the command to its move', async () => {
    const o = obs(ROWS, [3, 2]);
    const d = await createGreedyBrain().act(o, {
      skills: [],
      plan: null,
      canSpeak: false,
      command: { preset: 'hold_gate', order: '', ticksLeft: 3 },
    });
    expect(d.action).toEqual({ type: 'wait' });
  });
});
