import { afterEach, describe, expect, it } from 'vitest';
import { v2FrameFixture } from '@/test/fixtures';
import { alignPrev, matchLayer, rivalFade, softFog, type MatchLayer } from './ArenaCanvas';
import { agentColours, composeV2Arena, liveFx, setLiveFx, softLight } from './live';

afterEach(() => setLiveFx(null));

describe('soft fog', () => {
  it('lights every tile in sight fully and blurs the sight edge over about two tiles', () => {
    expect(softLight(new Array(25).fill(true), 5, 5)).toEqual(new Array(25).fill(1));
    // One row of 9 tiles: the left 4 seen.
    const row = softLight([true, true, true, true, false, false, false, false, false], 9, 1);
    expect(row.slice(0, 3)).toEqual([1, 1, 1]);
    expect(row[3]).toBeGreaterThan(row[4]!);
    expect(row[4]).toBeGreaterThan(0);
    expect(row[5]).toBeGreaterThan(row[6]!);
    expect(row.slice(6)).toEqual([0, 0, 0]);
  });

  it("emits a v2 frame's light map, its viewer, tick and this tick's talk as bubbles", () => {
    const f = v2FrameFixture({
      tick: 7,
      comms: [
        { tick: 7, from: 'wick', fromName: 'Wick', team: 'A', channel: 'team', text: 'Left tunnel.', overheard: false, overheardBy: ['Wren', 'Kai'] },
        { tick: 7, from: 'moss', fromName: 'Moss', team: 'A', channel: 'say', text: 'Here!', overheard: false },
      ],
    });
    const a = composeV2Arena(f)!;
    expect(a.team).toBe('A');
    expect(a.tick).toBe(7);
    expect(a.light).toHaveLength(a.A.w * a.A.h);
    // Unseen tiles are dark, seen ones lit; the hard sight stays for the 3D cam.
    const unseen = a.vis!.findIndex((v) => !v);
    const seen = a.vis!.findIndex((v) => v);
    expect(a.light![unseen]).toBeLessThan(a.light![seen]!);
    expect(a.barks).toEqual({ wick: { text: 'Left tunnel.', ch: 'team', heard: 'Wren, Kai' }, moss: { text: 'Here!', ch: 'say' } });
    expect(composeV2Arena(v2FrameFixture())?.barks).toBeNull();
    expect(composeV2Arena({ ...f, mapId: 'nowhere' })).toBeNull();
  });

  it('eases toward the light, keeps explored tiles dimly lit, and fades rivals in as they come into sight', () => {
    const f = v2FrameFixture();
    const a = composeV2Arena(f)!;
    const holder = { layer: null as MatchLayer | null };
    const layer = matchLayer(holder, a, 'copper-hollow');
    const seen = a.light!.findIndex((v) => v === 1);
    const unseen = a.light!.findIndex((v) => v === 0);
    // The first frame is lit at once; light stays above 0.1 everywhere.
    const first = softFog(layer, a, 0.016, false)!;
    expect(first[seen]).toBe(1);
    expect(first[unseen]).toBeCloseTo(0.1);
    // Out of sight on the next frame: the tile eases down and stays at its explored floor.
    const dark = { ...a, light: a.light!.map(() => 0) };
    const eased = softFog(layer, dark, 0.05, false)!;
    expect(eased[seen]).toBeLessThan(1);
    expect(eased[seen]).toBeGreaterThan(0.5);
    expect(softFog(layer, dark, 0, true)![seen]).toBeCloseTo(0.1 + 0.9 * 0.26);
    expect(matchLayer(holder, a, 'copper-hollow')).toBe(layer);
    expect(matchLayer(holder, a, 'saltmarsh-weir')).not.toBe(layer);

    const wren = { id: 'wren', name: 'Wren', team: 'B' as const, slot: 0, x: seen % a.A.w, y: Math.floor(seen / a.A.w), inv: [] };
    const withRival = { ...a, state: { ...a.state, agents: [...a.state.agents, wren] } };
    const fade = rivalFade(layer, withRival, 0.05, false);
    expect(fade.wick).toBe(1);
    expect(fade.wren).toBeGreaterThan(0);
    expect(fade.wren).toBeLessThan(1);

    // Tweens pair agents by id, not by position in the list.
    const prev = { grid: a.state.grid, agents: [wren, ...a.state.agents] };
    expect(alignPrev(prev, withRival.state).agents.map((x) => x.id)).toEqual(['wick', 'moss', 'wren']);
  });

  it('colours agents by crew and slot, and keeps the intro cues', () => {
    expect(agentColours('A', 0)).toEqual({ body: '#34e0c8', head: '#ece8e1' });
    expect(agentColours('B', 4).body).toBe('#ff8db0');
    setLiveFx({ intro: true });
    setLiveFx({ revealAt: 5 });
    expect(liveFx()).toEqual({ intro: true, revealAt: 5, deployAt: null, shakeAt: null });
    setLiveFx(null);
    expect(liveFx().intro).toBe(false);
  });
});

describe('owner looks on live agents', () => {
  it('draws an agent in its owner look and the rest in crew colours', () => {
    const frame = v2FrameFixture();
    const [first, ...rest] = frame.agents;
    const look = { skin: 1, hair: 'long', hairColor: 4, outfit: 3, pants: 2, build: 'slim', headgear: 'beanie' };
    const arena = composeV2Arena({ ...frame, agents: [{ ...first!, look }, ...rest] })!;
    const a = arena.state.agents.find((g) => g.id === first!.id)!;
    expect(a.c).toBe('#4cae6e');
    expect(a.bone).toBe('#eec39a');
    expect(a.dress).toEqual({ hair: 'long', hairColor: '#d9b26b', pants: '#2e4a3a', build: 'slim', headgear: 'beanie' });
    const b = arena.state.agents.find((g) => g.id === rest[0]?.id);
    if (b) expect(b.dress).toBeUndefined();
  });
});

describe('walking between tiles', () => {
  it('walks a step over most of the tick, within bounds, and 400 ms before the second frame', async () => {
    const { walkMs } = await import('./live');
    expect(walkMs(null)).toBe(400);
    expect(walkMs(2000)).toBe(1800);
    expect(walkMs(700)).toBe(630);
    expect(walkMs(100)).toBe(300);
    expect(walkMs(60_000)).toBe(1800);
  });

  it('bobs twice a tile and lands flat at both ends, never a hop', async () => {
    const { walkBob } = await import('./live');
    expect(walkBob(0)).toBeCloseTo(0);
    expect(walkBob(0.5)).toBeCloseTo(0);
    expect(walkBob(1)).toBeCloseTo(0);
    expect(walkBob(0.25)).toBeCloseTo(1);
    expect(walkBob(0.75)).toBeCloseTo(1);
  });
});

describe('agents reacting to each other (socialOf)', () => {
  const ag = (id: string, team: 'A' | 'B', x: number, y: number, o: Record<string, unknown> = {}) =>
    ({ id, name: id, team, x, y, role: 'Builder', out: false, down: false, items: [], ...o }) as never;
  const rows = ['#########', '#.......#', '#.......#', '#......*#', '#########'];
  const prevAt = (pos: Record<string, [number, number]>) =>
    ({ state: { grid: [], agents: Object.entries(pos).map(([id, [x, y]]) => ({ id, x, y })) } }) as never;

  it('a speaker turns to the nearest crewmate that heard it, and they nod back toward it', async () => {
    const { socialOf } = await import('./live');
    const frame = {
      view: 'A',
      rows,
      agents: [ag('a1', 'A', 1, 1), ag('a2', 'A', 3, 1), ag('a3', 'A', 6, 2)],
      events: [{ kind: 'said', agent: 'a1', channel: 'team', text: 'lamp east', heardBy: ['a3', 'a2'], overheardBy: [] }],
    } as never;
    const s = socialOf(frame, null, [7, 3]);
    expect(s.get('a1')).toEqual({ social: { talk: true }, faceTo: [3, 1] });
    expect(s.get('a2')).toEqual({ social: { listen: true }, faceTo: [1, 1] });
    expect(s.get('a3')).toEqual({ social: { listen: true }, faceTo: [1, 1] });
  });

  it('crewmates near a delivery pump their fists; rivals side by side square up', async () => {
    const { socialOf } = await import('./live');
    const frame = {
      view: 'watch',
      rows,
      agents: [ag('a1', 'A', 1, 1), ag('a2', 'A', 2, 2), ag('b1', 'B', 6, 3), ag('a3', 'A', 6, 2)],
      events: [{ kind: 'delivered', agent: 'a1', team: 'A', count: 1, score: 1 }],
    } as never;
    const s = socialOf(frame, null, [7, 3]);
    expect(s.get('a2')).toEqual({ social: { hype: true }, faceTo: [1, 1] });
    expect(s.get('a1')).toBeUndefined();
    expect(s.get('b1')).toEqual({ social: { square: true }, faceTo: [6, 2] });
    expect(s.get('a3')).toEqual({ social: { square: true }, faceTo: [6, 3] });
  });

  it('points at the item it is getting closer to, and an own agent standing still thinks (a rival never)', async () => {
    const { socialOf } = await import('./live');
    const frame = {
      view: 'A',
      rows,
      agents: [ag('a1', 'A', 5, 3), ag('a2', 'A', 2, 1), ag('b1', 'B', 1, 3)],
      events: [{ kind: 'blocked', agent: 'b1' }],
    } as never;
    const s = socialOf(frame, prevAt({ a1: [4, 3], a2: [2, 1], b1: [1, 3] }), [7, 3]);
    expect(s.get('a1')).toEqual({ social: { point: true }, faceTo: [7, 3] });
    expect(s.get('a2')).toEqual({ social: { think: true } });
    expect(s.get('b1')).toEqual({ social: { bump: true } });
  });
});

describe('bluffs, overhearing and hazards (socialOf)', () => {
  const ag = (id: string, team: 'A' | 'B', x: number, y: number) =>
    ({ id, name: id, team, x, y, role: 'Builder', out: false, down: false, items: [] }) as never;
  const rows = ['#########', '#..~....#', '#.......#', '#.......#', '#########'];
  const bluff = { kind: 'bluff', agent: 'a1', victim: 'b1', at: [5, 2], believed: true };

  it('shows a landed bluff to the liar crew and spectators, never to the fooled crew', async () => {
    const { socialOf } = await import('./live');
    const agents = [ag('a1', 'A', 1, 3), ag('b1', 'B', 6, 3)];
    const liar = socialOf({ view: 'A', rows, agents, events: [bluff] } as never, null, [7, 3]);
    expect(liar.get('a1')).toEqual({ social: { scheme: true }, faceTo: [6, 3] });
    expect(liar.get('b1')).toEqual({ social: { fooled: true }, faceTo: [1, 3] });
    expect(socialOf({ view: 'watch', rows, agents, events: [bluff] } as never, null, [7, 3]).get('b1')?.social).toEqual({ fooled: true });
    const victim = socialOf({ view: 'B', rows, agents, events: [bluff] } as never, null, [7, 3]);
    expect(victim.get('b1')?.social.fooled).toBeUndefined();
    expect(victim.get('a1')?.social.scheme).toBeUndefined();
  });

  it('a rival that overheard cups an ear toward the speaker; gas coughs, ice slips, a hazard next door flinches', async () => {
    const { socialOf } = await import('./live');
    const agents = [ag('a1', 'A', 1, 3), ag('a2', 'A', 2, 3), ag('b1', 'B', 4, 3), ag('b2', 'B', 6, 2), ag('a3', 'A', 2, 1)];
    const events = [
      { kind: 'said', agent: 'a1', channel: 'team', text: 'east', heardBy: ['a2'], overheardBy: ['b1'] },
      { kind: 'choked', agent: 'b2' },
      { kind: 'hazard', hazard: 'water', wave: 2, receding: false },
    ];
    const s = socialOf({ view: 'watch', rows, agents, events } as never, null, [7, 3]);
    expect(s.get('b1')).toEqual({ social: { overhear: true }, faceTo: [1, 3] });
    expect(s.get('b2')).toEqual({ social: { cough: true } });
    expect(s.get('a3')).toEqual({ social: { flinch: true, wave: true }, faceTo: [3, 1] });
  });
});

describe('match sounds (frameSounds)', () => {
  it('babbles a syllable a word for a speaker, two footfalls for a walker, a cough and a bluff sting', async () => {
    const { frameSounds, voicePitch } = await import('./live');
    const arena = {
      tick: 4,
      barks: { a1: { text: 'lamp oil east of the lift', ch: 'team' } },
      state: {
        grid: [],
        agents: [
          { id: 'a1', team: 'A', slot: 0, x: 1, y: 1, social: { talk: true } },
          { id: 'a2', team: 'A', slot: 1, x: 3, y: 2 },
          { id: 'b1', team: 'B', slot: 0, x: 5, y: 2, social: { cough: true } },
          { id: 'b2', team: 'B', slot: 1, x: 6, y: 2, social: { fooled: true } },
        ],
      },
    } as never;
    const prev = { grid: [], agents: [{ id: 'a2', x: 2, y: 2 }] } as never;
    const s = frameSounds(arena, prev, 1000);
    expect(s).toContainEqual({ delay: 0, sound: { kind: 'voice', syllables: 6, pitch: voicePitch('A', 0), seed: 28 } });
    expect(s.filter((x) => x.sound.kind === 'step').map((x) => x.delay)).toEqual([300, 800]);
    expect(s).toContainEqual({ delay: 0, sound: { kind: 'cough' } });
    expect(s).toContainEqual({ delay: 120, sound: { kind: 'fooled' } });
  });
});
