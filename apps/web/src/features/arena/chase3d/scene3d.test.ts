import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { v2FrameFixture } from '@/test/fixtures';
import { composeV2Arena, type LiveArena } from '../live';
import type { ArenaState } from '../world';
import { mountChaseCam, type ChaseCamState } from './index';
import { DIST_START } from './math';
import { buildWorld, newRig, startChaseCam, stepWorld, worldKey, type FrameInput, type RendererLike } from './scene3d';

const LOOK = 'copper-hollow';

/** Copper Hollow at tick 0 as crew A sees it: wick (1,1) and moss (2,1), fogged. */
function arena(): LiveArena {
  return composeV2Arena(v2FrameFixture())!;
}

function moved(a: LiveArena, id: string, dx: number, dy: number): LiveArena {
  const agents = a.state.agents.map((g) => (g.id === id ? { ...g, x: g.x + dx, y: g.y + dy } : g));
  return { ...a, state: { ...a.state, agents } };
}

function cam() {
  return new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 160);
}

function input(state: ChaseCamState, o: Partial<FrameInput> = {}): FrameInput {
  return { state, dt: 0.016, time: 1, now: state.at + 1000, still: true, dragging: false, ...o };
}

describe('chase cam world', () => {
  it('builds the map once: a floor slab per tile, the walls, a valve wheel per valve', () => {
    const a = arena();
    const w = buildWorld(a, LOOK);
    expect(w.key).toBe(worldKey(a, LOOK));
    expect(w.floor.count).toBe(a.A.w * a.A.h);
    expect(w.walls.count).toBe(a.A.grid.filter((t) => t === 'wall').length);
    expect(w.wheels).toHaveLength(a.A.valves.length);
    expect(w.scene.fog).toBeInstanceOf(THREE.Fog);
  });

  it('puts the camera behind the watched agent, raised, and builds every agent once', () => {
    const a = arena();
    const w = buildWorld(a, LOOK);
    const rig = newRig();
    const c = cam();
    const state: ChaseCamState = { arena: a, prev: null, at: 0, focus: 'wick', look: LOOK };
    stepWorld(w, rig, c, input(state));
    expect([...w.agents.keys()].sort()).toEqual(['moss', 'wick']);
    const wick = w.agents.get('wick')!;
    expect(wick.g.position.x).toBe(1);
    expect(wick.g.position.z).toBe(1);
    expect(c.position.y).toBeCloseTo(DIST_START * 0.66 + 0.4);
    // Crew A starts facing the middle (+x), so the camera sits on the -x side.
    expect(c.position.x).toBeLessThan(1);
    stepWorld(w, rig, c, input(state));
    expect(w.agents.size).toBe(2);
  });

  it('turns the camera the way the watched agent walks and tweens the step', () => {
    const a0 = arena();
    const w = buildWorld(a0, LOOK);
    const rig = newRig();
    const c = cam();
    // Frames 400 ms apart: the step walks over most of that (walkMs), turning on the spot first.
    stepWorld(w, rig, c, input({ arena: a0, prev: null, at: 9_600, focus: 'wick', look: LOOK }));
    // wick steps down (+z on the ground plane).
    const a1 = moved(a0, 'wick', 0, 1);
    const st: ChaseCamState = { arena: a1, prev: a0.state, at: 10_000, focus: 'wick', look: LOOK };
    stepWorld(w, rig, c, input(st, { now: 10_200, still: false, dt: 0.016 }));
    const wick = w.agents.get('wick')!;
    expect(wick.face).toBeCloseTo(0);
    expect(rig.tyaw).toBeCloseTo(0);
    expect(wick.g.position.z).toBeGreaterThan(1);
    expect(wick.g.position.z).toBeLessThan(2);
    // Reduced motion snaps: the camera is straight behind the new heading.
    stepWorld(w, rig, c, input(st, { now: 10_400 }));
    expect(wick.g.position.z).toBe(2);
    expect(c.position.z).toBeLessThan(2);
    expect(Math.abs(c.position.x - 1)).toBeLessThan(1);
  });

  it('switches the chase to another agent', () => {
    const a = arena();
    const w = buildWorld(a, LOOK);
    const rig = newRig();
    const c = cam();
    stepWorld(w, rig, c, input({ arena: a, prev: null, at: 0, focus: 'wick', look: LOOK }));
    stepWorld(w, rig, c, input({ arena: a, prev: null, at: 0, focus: 'moss', look: LOOK }));
    expect(rig.target).toBe('moss');
    expect(rig.focusAt).toEqual({ x: 2, z: 1 });
  });

  it('lights the floor from the crew sight: unseen tiles stay dark', () => {
    const a = arena();
    const w = buildWorld(a, LOOK);
    stepWorld(w, newRig(), cam(), input({ arena: a, prev: null, at: 0, focus: 'wick', look: LOOK }));
    const seen = a.vis!.indexOf(true);
    const unseen = a.vis!.lastIndexOf(false);
    const lit = new THREE.Color();
    const dark = new THREE.Color();
    w.floor.getColorAt(seen, lit);
    w.floor.getColorAt(unseen, dark);
    const sum = (c: THREE.Color) => c.r + c.g + c.b;
    expect(sum(dark)).toBeLessThan(sum(lit) * 0.5);
  });

  it('shows a rival only while the crew can see it', () => {
    const a = arena();
    const unseen = a.vis!.lastIndexOf(false);
    const rival = { id: 'wren', name: 'Wren', team: 'B' as const, slot: 0, x: unseen % a.A.w, y: Math.floor(unseen / a.A.w), inv: [] };
    const withRival: LiveArena = { ...a, state: { ...a.state, agents: [...a.state.agents, rival] } };
    const w = buildWorld(a, LOOK);
    const rig = newRig();
    const c = cam();
    stepWorld(w, rig, c, input({ arena: withRival, prev: null, at: 0, focus: 'wick', look: LOOK }));
    expect(w.agents.get('wren')!.g.visible).toBe(false);
    // Out of the frame entirely (left sight): hidden too.
    stepWorld(w, rig, c, input({ arena: a, prev: null, at: 0, focus: 'wick', look: LOOK }));
    expect(w.agents.get('wren')!.g.visible).toBe(false);
    // In sight.
    const seenAt: ArenaState['agents'][number] = { ...rival, x: 2, y: 2 };
    const inSight: LiveArena = { ...a, vis: null, state: { ...a.state, agents: [...a.state.agents, seenAt] } };
    stepWorld(w, rig, c, input({ arena: inSight, prev: null, at: 0, focus: 'wick', look: LOOK }));
    expect(w.agents.get('wren')!.g.visible).toBe(true);
  });

  it('draws arenas without valve lanes or fog', () => {
    const a = arena();
    const plain: LiveArena = { ...a, A: { ...a.A, valves: [] }, vis: undefined };
    const w = buildWorld(plain, 'saltmarsh-weir');
    expect(() => stepWorld(w, newRig(), cam(), input({ arena: plain, prev: null, at: 0, focus: 'nobody', look: 'saltmarsh-weir' }))).not.toThrow();
  });

  it('builds each agent in its role look and poses it from the frame (tipped over when knocked down)', () => {
    const f = v2FrameFixture();
    f.agents[1]!.down = true;
    const a = composeV2Arena(f)!;
    const w = buildWorld(a, LOOK);
    const c = cam();
    stepWorld(w, newRig(), c, input({ arena: a, prev: null, at: 0, focus: 'wick', look: LOOK }));
    const wick = w.agents.get('wick')!;
    const moss = w.agents.get('moss')!;
    expect(wick.look.verb).toBe('build');
    expect(moss.look.verb).toBe('dig');
    // Every look part is a mesh in its pose group.
    const meshes = Object.values(wick.parts).reduce((n, g) => n + g.children.length, 0);
    expect(meshes).toBeGreaterThan(8);
    expect(moss.g.visible).toBe(true);
    expect(moss.body.rotation.z).toBeGreaterThan(1.2);
    expect(wick.body.rotation.z).toBe(0);
  });

  it('dresses agents in their owner look, draws what they wear, and rebuilds a figure when that changes', () => {
    const f = v2FrameFixture();
    f.agents[0]!.look = { skin: 1, hair: 'ponytail', hairColor: 6, outfit: 3, pants: 2, build: 'sturdy', headgear: 'cap' };
    f.agents[0]!.cosmetics = { skin: 'skin_ember', trail: 'trail_spark', nameplate: 'plate_gold' };
    const a = composeV2Arena(f)!;
    const w = buildWorld(a, LOOK);
    const c = cam();
    stepWorld(w, newRig(), c, input({ arena: a, prev: null, at: 0, focus: 'wick', look: LOOK }));
    const wick = w.agents.get('wick')!;
    // Sturdy build, the hard hat swapped for a cap.
    expect(wick.look.torso[0]).toBeGreaterThan(0.4);
    expect(wick.look.parts.some((q) => q.fill === '#fff1a8')).toBe(false);
    // Stripes as a ring of marks, plus the spark trail's marks waiting in the scene.
    expect(wick.g.children.filter((o) => o instanceof THREE.Mesh && o.geometry instanceof THREE.PlaneGeometry)).toHaveLength(10);
    expect(wick.trail).toHaveLength(15);
    const first = wick;
    // Same look next frame: the same figure.
    stepWorld(w, newRig(), c, input({ arena: a, prev: null, at: 0, focus: 'wick', look: LOOK }));
    expect(w.agents.get('wick')).toBe(first);
    // A new skin mid-match: rebuilt, the old figure out of the scene.
    const b = composeV2Arena({ ...f, agents: [{ ...f.agents[0]!, cosmetics: { skin: 'skin_glacier' } }, ...f.agents.slice(1)] })!;
    stepWorld(w, newRig(), c, input({ arena: b, prev: null, at: 0, focus: 'wick', look: LOOK }));
    const again = w.agents.get('wick')!;
    expect(again).not.toBe(first);
    expect(w.scene.children).not.toContain(first.g);
    expect(again.trail).toHaveLength(0);
  });
});

describe('startChaseCam', () => {
  let queue: FrameRequestCallback[] = [];
  const tick = (t: number) => {
    const q = queue;
    queue = [];
    for (const cb of q) cb(t);
  };
  beforeEach(() => {
    queue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {
      queue = [];
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  function fakeRenderer() {
    const r = {
      domElement: document.createElement('canvas'),
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      render: vi.fn((_scene: THREE.Scene, c: THREE.Camera) => {
        r.camX.push(c.position.x);
      }),
      dispose: vi.fn(),
      camX: [] as number[],
    };
    return r;
  }

  it('fills the element with a canvas, renders each frame and cleans up on unmount', () => {
    const el = document.createElement('div');
    const r = fakeRenderer();
    let state: ChaseCamState | null = null;
    const stop = startChaseCam(el, () => state, {}, { renderer: () => r as RendererLike });
    expect(el.querySelector('canvas')).toBe(r.domElement);
    tick(16);
    // Nothing to chase yet: no render, canvas hidden.
    expect(r.render).not.toHaveBeenCalled();
    expect(r.domElement.style.visibility).toBe('hidden');
    state = { arena: arena(), prev: null, at: Date.now(), focus: 'wick', look: LOOK };
    tick(32);
    expect(r.render).toHaveBeenCalledTimes(1);
    expect(r.domElement.style.visibility).toBe('visible');
    stop();
    expect(r.dispose).toHaveBeenCalled();
    expect(el.querySelector('canvas')).toBeNull();
    expect(queue).toHaveLength(0);
  });

  it('holds the picture while paused and catches up on resume', () => {
    const el = document.createElement('div');
    const r = fakeRenderer();
    const a0 = arena();
    let state: ChaseCamState = { arena: a0, prev: null, at: 0, focus: 'wick', look: LOOK };
    startChaseCam(el, () => state, { still: () => true }, { renderer: () => r as RendererLike });
    tick(16);
    const a1 = moved(a0, 'wick', 3, 0);
    state = { arena: a1, prev: a0.state, at: 1, focus: 'wick', look: LOOK, paused: true };
    tick(32);
    expect(r.camX[1]).toBeCloseTo(r.camX[0]!);
    state = { ...state, paused: false };
    tick(48);
    expect(r.camX[2]).toBeGreaterThan(r.camX[0]! + 2);
  });

  it('zooms with the wheel within limits', () => {
    const el = document.createElement('div');
    const r = fakeRenderer();
    const state: ChaseCamState = { arena: arena(), prev: null, at: 0, focus: 'wick', look: LOOK };
    startChaseCam(el, () => state, { still: () => true }, { renderer: () => r as RendererLike });
    tick(16);
    const wheel = new WheelEvent('wheel', { deltaY: -100, cancelable: true });
    r.domElement.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    tick(32);
    // Closer: the camera drops towards the agent.
    expect(r.render.mock.calls[1]![1].position.y).toBeLessThan(DIST_START * 0.66 + 0.4);
  });

  it('stops and reports when a frame fails or the GPU context is lost', () => {
    const r = fakeRenderer();
    const onFail = vi.fn();
    const el = document.createElement('div');
    startChaseCam(
      el,
      () => {
        throw new Error('bad frame');
      },
      { onFail },
      { renderer: () => r as RendererLike },
    );
    tick(16);
    expect(onFail).toHaveBeenCalledWith(new Error('bad frame'));
    expect(el.querySelector('canvas')).toBeNull();
    expect(queue).toHaveLength(0);

    const r2 = fakeRenderer();
    const onFail2 = vi.fn();
    startChaseCam(document.createElement('div'), () => null, { onFail: onFail2 }, { renderer: () => r2 as RendererLike });
    r2.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(onFail2).toHaveBeenCalledTimes(1);
    expect(r2.dispose).toHaveBeenCalled();
  });
});

describe('mountChaseCam without WebGL', () => {
  it('reports the failure so the live screen keeps the 2D third person', async () => {
    // three logs the failed context before throwing.
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onFail = vi.fn();
    const el = document.createElement('div');
    const unmount = mountChaseCam(el, () => null, { onFail });
    await vi.waitFor(() => expect(onFail).toHaveBeenCalledTimes(1));
    expect(el.querySelector('canvas')).toBeNull();
    unmount();
    log.mockRestore();
  });
});
