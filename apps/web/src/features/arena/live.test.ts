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
