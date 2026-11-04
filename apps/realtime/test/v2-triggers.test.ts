// Skill triggers in a live match: each agent's brain gets its skills' triggers, and its own crew's
// frames show each skill by name and trigger with whether it was active that tick (never the prompt,
// never to the rival or watchers).
import { createGreedyBrain, type V2AgentContext, type V2Brain } from '@skirm/decision-engine/v2';
import { MAPS_V2, createMatch, frameFor, type AgentSpec, type Team, type V2Frame } from '@skirm/engine/v2';
import type { V2ServerMessage } from '@skirm/server';
import { describe, expect, it } from 'vitest';
import { silentLogger } from '../src/deps';
import { realScheduler } from '../src/timing';
import { V2Match, withOwnCrew, type V2Credits, type V2Setup } from '../src/v2/match';

const map = MAPS_V2.find((m) => m.id === 'copper-hollow')!;
const spec = (id: string, role: AgentSpec['role']): AgentSpec => ({ id, name: id, role, vision: 3, comms: 3, tier: 'standard' });
const FAST = { acceptMs: 60, lockMs: 60, tickMs: 1, actionMs: 40, planMs: 40, replanEvery: 25 };

const credits: V2Credits = {
  hold: async () => ({ ok: true as const }),
  charge: async () => undefined,
  settle: async () => undefined,
  release: async () => undefined,
};

function setup(): V2Setup {
  return {
    matchId: 'mat_v2triggers',
    map,
    ranked: false,
    sides: {
      A: {
        accountId: 'acc_a',
        handle: 'ana',
        crew: [spec('wick', 'Builder'), spec('moss', 'Digger')],
        skills: [['SECRET dam first.', 'SECRET late push.'], []],
        skillMeta: [
          [
            { name: 'Dam First', trigger: null },
            { name: 'Late Push', trigger: { kind: 'time_left_under', seconds: 60 } },
          ],
          [],
        ],
      },
      B: { accountId: 'acc_b', handle: 'ben', crew: [spec('wren', 'Digger'), spec('kes', 'Runner')], skills: [[], []] },
    },
  };
}

const frames = (msgs: V2ServerMessage[]): V2Frame[] => msgs.flatMap((m) => (m.type === 'v2_frame' ? [m.frame] : []));

describe('skill triggers in a v2 match', () => {
  it('passes triggers to the brain and shows the owner which skills were active each tick', async () => {
    const inbox: Record<Team | 'watch', V2ServerMessage[]> = { A: [], B: [], watch: [] };
    const seen: Pick<V2AgentContext, 'skills' | 'skillTriggers'>[] = [];
    const greedy = createGreedyBrain();
    const spy: V2Brain = {
      ...greedy,
      act: (o, ctx) => {
        if (o.me.id === 'wick') seen.push({ skills: ctx.skills, ...(ctx.skillTriggers ? { skillTriggers: ctx.skillTriggers } : {}) });
        return greedy.act(o, ctx);
      },
    };
    const m: V2Match = new V2Match(setup(), {
      brains: { A: spy, B: greedy },
      scheduler: realScheduler,
      timing: FAST,
      credits,
      send: (t, msg) => {
        inbox[t].push(msg);
        if (msg.type === 'v2_found') queueMicrotask(() => m.accept(t));
        if (msg.type === 'v2_lockin') queueMicrotask(() => m.lockIn(t, []));
      },
      watch: (msg) => inbox.watch.push(msg),
      log: silentLogger,
    });
    await m.play();

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toEqual({ skills: ['SECRET dam first.', 'SECRET late push.'], skillTriggers: [null, { kind: 'time_left_under', seconds: 60 }] });

    const wick = frames(inbox.A).flatMap((f) => f.agents.filter((a) => a.id === 'wick' && a.skills));
    expect(wick.length).toBeGreaterThan(0);
    expect(wick[0]!.skills).toEqual([
      { name: 'Dam First', trigger: { kind: 'always' }, active: true },
      { name: 'Late Push', trigger: { kind: 'time_left_under', seconds: 60 }, active: false },
    ]);
    expect(wick.every((a) => a.skills![0]!.active)).toBe(true);
    // Moss has no skills: no list.
    expect(frames(inbox.A).some((f) => f.agents.some((a) => a.id === 'moss' && a.skills))).toBe(false);
    // The rival crew and watchers never get the list, and nobody gets the prompt.
    expect(JSON.stringify(inbox.B)).not.toContain('Dam First');
    expect(JSON.stringify(inbox.watch)).not.toContain('Dam First');
    expect(JSON.stringify(inbox)).not.toContain('SECRET');
  });

  it('withOwnCrew shows skills on its own agents only, bought skills included', () => {
    const s = createMatch(map, { A: setup().sides.A.crew, B: setup().sides.B.crew });
    const skills = new Map([
      ['wick', [{ name: 'Dam First', trigger: { kind: 'always' as const }, active: true }]],
      ['wren', [{ name: 'Rival Skill', trigger: { kind: 'carrying_item' as const }, active: false }]],
    ]);
    const f = withOwnCrew(frameFor(s, 'A', []), s, 'A', [], null, [true, false], { skills });
    expect(f.agents.find((a) => a.id === 'wick')!.skills).toEqual([{ name: 'Dam First', trigger: { kind: 'always' }, active: true }]);
    expect(f.agents.find((a) => a.id === 'moss')!.skills).toBeUndefined();
    expect(f.agents.filter((a) => a.team === 'B').some((a) => a.skills)).toBe(false);
  });
});
