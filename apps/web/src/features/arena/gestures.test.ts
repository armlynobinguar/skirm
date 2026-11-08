// Gestures that make the agents' thinking readable (live.ts socialOf, @skirm/ui poseAt, figure2d):
// saluting a live command, a skill kicking in, pointing at what a line names, sweating near a wave,
// huddles, the last-stretch run, the head turning toward the goal, and idle personas.
import { describe, expect, it } from 'vitest';
import { lookFor, personaOf, poseAt } from '@skirm/ui';
import { v2FrameFixture } from '@/test/fixtures';
import { glanceOf } from './figure2d';
import { calloutTarget, composeV2Arena, skillKicksOf, socialOf } from './live';

const ag = (id: string, team: 'A' | 'B', x: number, y: number, o: Record<string, unknown> = {}) =>
  ({ id, name: id, team, x, y, role: 'Builder', out: false, down: false, items: [], ...o }) as never;
const rows = ['#########', '#.......#', '#.V.....#', '#..~...*#', '#########'];
const exit: [number, number] = [7, 3];
const at = (tick: number, agents: { id: string; x: number; y: number; skillsOn?: string[] }[]) =>
  ({ tick, state: { grid: [], agents } }) as never;
const cmd = (tick: number, agents: string[], preset: string | null, text: string | null = null) => ({ tick, until: tick + 5, agents, preset, text });

describe('live commands', () => {
  it('salutes a command that just reached it and turns toward what the order is about', () => {
    const agents = [ag('a1', 'A', 5, 3), ag('a2', 'A', 1, 1), ag('a3', 'A', 2, 1)];
    const commands = { left: 1, log: [cmd(4, ['a3'], 'go_drop'), cmd(10, ['a1'], 'go_drop'), cmd(10, ['a2'], 'regroup'), cmd(10, ['a3'], null, 'stay low')] };
    const s = socialOf({ view: 'A', rows, agents, events: [], commands, tick: 10 } as never, at(9, []), exit);
    expect(s.get('a1')).toEqual({ social: { salute: true }, faceTo: [7, 3] });
    expect(s.get('a2')).toEqual({ social: { salute: true }, faceTo: [2, 1] });
    // Free text alone: a salute with nowhere in particular to turn.
    expect(s.get('a3')).toEqual({ social: { salute: true } });
    // An order from earlier in the match is not saluted again.
    const later = socialOf({ view: 'A', rows, agents, events: [], commands, tick: 11 } as never, at(10, []), exit);
    expect(later.get('a1')?.social.salute).toBeUndefined();
  });
});

describe('skills kicking in', () => {
  const skills = (active: boolean) => [{ name: 'Flood Warden', trigger: 'always', active }];

  it('takes a power stance when an equipped skill kicks in, once, and never for a rival', () => {
    const agents = [ag('a1', 'A', 1, 1, { skills: skills(true) }), ag('a2', 'A', 3, 1, { skills: skills(true) }), ag('b1', 'B', 6, 1)];
    const prev = at(4, [{ id: 'a1', x: 1, y: 1 }, { id: 'a2', x: 3, y: 1, skillsOn: ['Flood Warden'] }, { id: 'b1', x: 6, y: 1 }]);
    const frame = { view: 'A', rows, agents, events: [], tick: 5 } as never;
    expect([...skillKicksOf(frame, prev)]).toEqual([['a1', 'Flood Warden']]);
    const s = socialOf(frame, prev, exit);
    expect(s.get('a1')?.social.skill).toBe(true);
    expect(s.get('a2')?.social.skill).toBeUndefined();
    expect(s.get('b1')?.social.skill).toBeUndefined();
    // No previous frame: no flourish, never a guess.
    expect(skillKicksOf(frame, null).size).toBe(0);
  });

  it('carries the skill name for the chip and the active skills for the next frame', () => {
    const f = v2FrameFixture({ tick: 3 });
    const before = composeV2Arena({ ...f, tick: 2 })!;
    const withSkill = { ...f, agents: f.agents.map((g, i) => (i === 0 ? { ...g, skills: skills(true) } : g)) } as never;
    const now = composeV2Arena(withSkill, before)!;
    expect(now.state.agents[0]).toMatchObject({ skill: 'Flood Warden', skillsOn: ['Flood Warden'] });
    expect(now.state.agents[1]?.skill).toBeUndefined();
    expect(composeV2Arena(withSkill, now)!.state.agents[0]?.skill).toBeUndefined();
  });
});

describe('callouts', () => {
  const said = (text: string) => ({ kind: 'said', agent: 'a1', channel: 'team', text, heardBy: ['a2'], overheardBy: [] });
  const agents = [ag('a1', 'A', 1, 1), ag('a2', 'A', 3, 1)];
  const run = (text: string) => socialOf({ view: 'A', rows, agents, events: [said(text)], mapId: 'copper-hollow' } as never, null, exit).get('a1');

  it('points at what its line names: a coordinate, the exit, a switch or an item', () => {
    expect(run('Lamp at (6, 2), go!')).toEqual({ social: { talk: true, callout: true }, faceTo: [6, 2] });
    expect(run('Heading for the exit')).toEqual({ social: { talk: true, callout: true }, faceTo: [7, 3] });
    expect(run('I will pull the switch')).toEqual({ social: { talk: true, callout: true }, faceTo: [2, 2] });
    expect(run('Item on the right side')).toEqual({ social: { talk: true, callout: true }, faceTo: [7, 3] });
    // Naming nothing: it talks to the crewmate that heard it, as before.
    expect(run('Stay close')).toEqual({ social: { talk: true }, faceTo: [3, 1] });
  });

  it('never points off the board or at its own tile', () => {
    const board = { w: 9, h: 5, items: [], switches: [], hazards: [] };
    expect(calloutTarget('go to 40, 2', [1, 1], board, exit)).toBeUndefined();
    expect(calloutTarget('stay at 1,1', [1, 1], board, exit)).toBeUndefined();
  });
});

describe('hazards, races, kick-off and the last stretch', () => {
  it('a wave two tiles away makes it glance and sweat', () => {
    const wave = { kind: 'hazard', hazard: 'water', wave: 3, receding: false };
    const s = socialOf({ view: 'watch', rows, agents: [ag('a1', 'A', 3, 1), ag('b1', 'B', 6, 1)], events: [wave] } as never, null, exit);
    expect(s.get('a1')).toEqual({ social: { sweat: true }, faceTo: [3, 3] });
    expect(s.get('b1')).toBeUndefined();
  });

  it('a crew that lost a race to a middle item huddles around the loser', () => {
    const race = { kind: 'picked', agent: 'b1', at: [6, 2], stolen: false, origin: 'middle' };
    const agents = [ag('b1', 'B', 6, 2), ag('a1', 'A', 5, 2), ag('a2', 'A', 3, 1), ag('a3', 'A', 1, 1)];
    const s = socialOf({ view: 'watch', rows, agents, events: [race] } as never, null, exit);
    expect(s.get('a1')).toEqual({ social: { huddle: true }, faceTo: [3, 1] });
    expect(s.get('a2')).toEqual({ social: { huddle: true }, faceTo: [5, 2] });
    // Too far from the loser to join in; the winner does not huddle.
    expect(s.get('a3')?.social.huddle).toBeUndefined();
    expect(s.get('b1')?.social.huddle).toBeUndefined();
  });

  it('huddles at kick-off; in the last stretch everyone runs and each lead waves its crew on once', () => {
    const agents = [ag('a1', 'A', 1, 1), ag('a2', 'A', 2, 1), ag('b1', 'B', 6, 1), ag('b2', 'B', 6, 2)];
    const kick = socialOf({ view: 'watch', rows, agents, events: [], tick: 0, limit: 150 } as never, null, exit);
    expect(kick.get('a1')).toEqual({ social: { huddle: true }, faceTo: [2, 1] });
    expect(kick.get('b2')).toEqual({ social: { huddle: true }, faceTo: [6, 1] });
    const start = socialOf({ view: 'watch', rows, agents, events: [], tick: 135, limit: 150 } as never, at(134, []), exit);
    expect(start.get('a1')).toEqual({ social: { rally: true, hurry: true }, faceTo: [2, 1] });
    expect(start.get('b1')).toEqual({ social: { rally: true, hurry: true }, faceTo: [6, 2] });
    expect(start.get('a2')).toEqual({ social: { hurry: true } });
    const next = socialOf({ view: 'watch', rows, agents, events: [], tick: 140, limit: 150 } as never, at(139, []), exit);
    expect(next.get('a1')).toEqual({ social: { hurry: true } });
    // Mid-match, or once the result is in: no hurry.
    expect(socialOf({ view: 'watch', rows, agents, events: [], tick: 60, limit: 150 } as never, at(59, []), exit).get('a2')).toBeUndefined();
    expect(socialOf({ view: 'watch', rows, agents, events: [], tick: 145, limit: 150, result: {} } as never, at(144, []), exit).get('a2')).toBeUndefined();
  });
});

describe('personas, glances and the new poses', () => {
  it('gives the starter crew their characters and anyone else a stable one', () => {
    expect(personaOf('Rook', 'x')).toBe('stoic');
    expect(personaOf('wren', 'x')).toBe('fidget');
    expect(personaOf(' MOSS ', 'x')).toBe('calm');
    expect(personaOf('Kai', 'agt_123')).toBe(personaOf('Renamed', 'agt_123'));
    expect(['stoic', 'fidget', 'calm']).toContain(personaOf(undefined, 'agt_9'));
  });

  it('turns the head toward the goal on the side it lies, from the way the figure faces', () => {
    // Facing lower right, its right hand is on +y tiles.
    expect(glanceOf({ x: 2, y: 2, gaze: [2, 5], face: 1 })).toBe(1);
    expect(glanceOf({ x: 2, y: 2, gaze: [2, 1], face: 1 })).toBeCloseTo(-1 / 3);
    // Facing lower left, on +x tiles.
    expect(glanceOf({ x: 2, y: 2, gaze: [4, 2], face: -1 })).toBeCloseTo(2 / 3);
    expect(glanceOf({ x: 2, y: 2, face: 1 })).toBe(0);
  });

  it('poses a salute, a skill stance, a run, a glance and a stoic idle', () => {
    const look = lookFor('Builder');
    const o = { time: 1, age: 0.2 };
    expect(poseAt('idle', look, { ...o, social: { salute: true } }).off.hand?.[1]).toBeCloseTo(0.3);
    const stance = poseAt('idle', look, { ...o, social: { skill: true } });
    expect(stance.off.footL?.[0]).toBeLessThan(0);
    expect(stance.off.footR?.[0]).toBeGreaterThan(0);
    const walk = poseAt('walk', look, { ...o, walk: 0.3 });
    const run = poseAt('walk', look, { ...o, walk: 0.3, social: { hurry: true } });
    expect(run.lean).toBeGreaterThan(walk.lean);
    expect(poseAt('idle', look, { ...o, gaze: 1 }).off.head?.[0]).toBeGreaterThan(0);
    expect(poseAt('idle', look, { ...o, gaze: -1 }).off.head?.[0]).toBeLessThan(0);
    // A scout's idle leaves its hands free, so the stoic one folds its arms.
    expect(poseAt('idle', lookFor('Scout'), { ...o, persona: 'stoic' }).off.hand).toEqual([0, 0.13, 0.11]);
    // Reduced motion keeps the plain stance.
    expect(poseAt('idle', lookFor('Scout'), { ...o, still: true, persona: 'stoic' }).off.hand).toBeUndefined();
  });
});
