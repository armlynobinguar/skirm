'use client';
// The persistent isometric arena behind every screen (the prototype's #world canvas, #dim and
// frame loop). Mounted once by AppShell; the current screen picks the scene, which moves the camera
// and the ink dimming, and the arena store picks the map. The tiles drop in on first show and on a
// map change. With reduced motion the arena still shows, drawn once per change with no animation.
// A live match adds the prototype's match layer: soft fog that eases and remembers explored tiles,
// rivals fading in as they come into sight, the camera following one agent (or tilted in close for
// third person), name tags and speech bubbles, and the intro's hazard reveal and crew drop-in.
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { usePreferences } from '@/lib/preferences';
import { screenOf } from '@/lib/routes';
import { drawEmotes } from './emotes';
import { drawCosmetics2D, type CosmeticDrawOpts } from './cosmetics';
import { drawGear2D } from './gear';
import * as proto from './proto/world';
import { cameraFor, easeRateFor, fitBox, sceneForMatchView, sceneForScreen, stepCamera, type ArenaScene, type Camera } from './scene';
import { liveFx, type LiveArena } from './live';
import { setArenaProjection } from './pick';
import { useArena, type ArenaStateSnapshot } from './store';
import { MAPS, mapById, restingState, type ArenaState, type V2Map } from './world';

type ArenaSnapshotLive = ArenaStateSnapshot['live'];

/** The match layer's own state across frames: fog memory, rival fades and the follow offset. */
export interface MatchLayer {
  /** Arena the fog arrays belong to (size and look); a new match starts them over. */
  key: string;
  /** The light each tile is easing toward, and the last arena it was taken from. */
  target: number[] | null;
  from: LiveArena | null;
  /** Eased light, and the brightest each tile has been (explored tiles stay dimly lit). */
  L: Float32Array;
  E: Float32Array;
  fade: Record<string, number>;
  /** Eased board origin while following an agent. */
  fo: { x: number; y: number } | null;
}
export interface ArenaCanvasProps {
  /** Overrides the scene picked from the path (the Boot screen, tests). */
  scene?: ArenaScene;
}

export function ArenaCanvas({ scene: forced }: ArenaCanvasProps) {
  const pathname = usePathname() ?? '/';
  const { mapIdx, introAt, live: liveMatch, view } = useArena();
  const scene = forced ?? sceneForMatchView(sceneForScreen(screenOf(pathname)?.key), view.mode);
  const tilted = scene === 'tpv';
  const { reducedMotion } = usePreferences();
  const canvas = useRef<HTMLCanvasElement>(null);
  const dim = useRef<HTMLDivElement>(null);
  const redraw = useRef<(() => void) | null>(null);
  // Live values the frame loop reads without restarting.
  const live = useRef({
    scene,
    mapIdx,
    reducedMotion,
    intro: 0,
    introAt,
    cam: null as Camera | null,
    match: null as ArenaSnapshotLive,
    prevState: null as ArenaState | null,
    view,
    layer: null as MatchLayer | null,
  });
  live.current.scene = scene;
  live.current.view = view;
  live.current.mapIdx = mapIdx;
  live.current.reducedMotion = reducedMotion;
  if (live.current.match?.at !== liveMatch?.at) {
    // A new live frame: tween from the last one (only within the same match).
    live.current.prevState = live.current.match && liveMatch ? live.current.match.arena.state : null;
    live.current.match = liveMatch;
    if (!liveMatch) live.current.layer = null;
  }
  if (live.current.introAt !== introAt) {
    live.current.introAt = introAt;
    live.current.intro = 0;
  }

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return; // no canvas support (tests, very old browsers): the screens still work
    let raf = 0;
    let last = performance.now();
    const t0 = last;
    let vw = 0;
    let vh = 0;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      vw = window.innerWidth;
      vh = window.innerHeight;
      cv.width = vw * dpr;
      cv.height = vh * dpr;
    };
    resize();

    const draw = (now: number) => {
      const L = live.current;
      const still = L.reducedMotion;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const time = still ? 0 : (now - t0) / 1000;
      L.intro = still ? 9 : L.intro + dt;
      const target = cameraFor(L.scene, vw < 820);
      L.cam = !L.cam || still ? target : stepCamera(L.cam, target, dt, easeRateFor(L.scene));
      const cam = L.cam;
      if (dim.current) dim.current.style.opacity = cam.dim.toFixed(3);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#05080d';
      ctx.fillRect(0, 0, vw, vh);
      const inMatch = L.scene === 'match' || L.scene === 'follow' || L.scene === 'intro' || L.scene === 'tpv';
      const lm = inMatch || L.scene === 'result' ? L.match : null;
      const m = (lm ? mapById(lm.look) : null) ?? MAPS[L.mapIdx] ?? MAPS[0]!;
      const A = lm ? lm.arena.A : m.A;
      const box = fitBox(L.scene, vw, vh);
      const T = proto.fitT(A, box.w, box.h) * cam.zoom;
      const fx = cam.fx * vw;
      const fy = cam.fy * vh;
      const cxm = (A.w - 1) / 2;
      const cym = (A.h - 1) / 2;
      let ox = fx - ((cxm - cym) * T) / 2;
      let oy = fy - ((cxm + cym) * T) / 4;
      const onAtlas = L.scene === 'maps';
      let opts: Record<string, unknown> = {
        intro: lm ? 9 : L.intro,
        sides: onAtlas,
        lanes: onAtlas ? proto.laneSetOf(A) : null,
        drops: onAtlas ? A.drops : null,
        still,
      };
      // Live frames ease from the previous one over 400 ms; the map at rest does not move.
      const alpha = lm && L.prevState && !still ? Math.min(1, (Date.now() - lm.at) / 400) : 1;
      let prev: ArenaState | null = null;
      if (lm) {
        const k = still ? 1 : 1 - Math.exp(-dt * 4.2);
        const layer = matchLayer(L, lm.arena, lm.look);
        const cur = lm.arena.state;
        prev = L.prevState ? alignPrev(L.prevState, cur) : null;
        const fxs = liveFx();
        const nowMs = Date.now();
        // The intro's cues: hazards rise in over 1.5 s, the crews drop in over 1.4 s (at once with reduced motion).
        const cue = (at: number | null, ms: number) => (at != null ? (still ? 1 : Math.min(1, (nowMs - at) / ms)) : fxs.intro ? 0 : 1);
        const reveal = cue(fxs.revealAt, 1500);
        const deploy = cue(fxs.deployAt, 1400);
        const tpv = L.scene === 'tpv';
        opts = {
          intro: 9,
          // Agent poses: one-shots (a fall, a celebration) play from the frame's arrival.
          age: (nowMs - lm.at) / 1000,
          still,
          reveal,
          deploy,
          revealSet: revealSetOf(m),
          tags: inMatch && deploy >= 1,
          barks: inMatch && !tpv ? barksAt(lm.arena, time, (nowMs - lm.at) / 1000) : null,
          focus: L.view.focus,
          light: inMatch ? softFog(layer, lm.arena, dt, still) : null,
          agFade: rivalFade(layer, lm.arena, dt, still),
          lanes: inMatch && reveal > 0.7 ? proto.laneSetOf(A) : null,
          drops: inMatch && reveal > 0.7 ? A.drops.filter((d) => (lm.arena.tick ?? 0) < d[2]) : null,
        };
        // Following an agent (or third person): ease the board so the agent sits at the camera's focus.
        const f = inMatch && L.view.focus && L.view.mode !== 'overview' ? cur.agents.find((a) => a.id === L.view.focus) : null;
        if (f) {
          const tx = fx - ((f.x - f.y) * T) / 2;
          const ty = fy - ((f.x + f.y) * T) / 4;
          layer.fo = layer.fo && !still ? { x: layer.fo.x + (tx - layer.fo.x) * k, y: layer.fo.y + (ty - layer.fo.y) * k } : { x: tx, y: ty };
          ox = layer.fo.x;
          oy = layer.fo.y;
        } else layer.fo = { x: ox, y: oy };
        const shake = fxs.shakeAt != null && !still ? Math.max(0, 1 - (nowMs - fxs.shakeAt) / 700) : 0;
        if (shake > 0) {
          ox += (Math.random() - 0.5) * shake * 22;
          oy += (Math.random() - 0.5) * shake * 14;
        }
      }
      // Hybrid control's click-to-move reads where the flat board was drawn (never the tilted third person).
      setArenaProjection(lm && inMatch && L.scene !== 'tpv' ? { ox, oy, T, slab: T * 0.13, w: A.w, h: A.h } : null);
      if (lm && !opts.focus && lm.arena.controlled) opts.focus = lm.arena.controlled;
      if (!proto.drawScenery(ctx, m, A, T, ox, oy, time, vw, vh)) drawBackdrop(ctx, time, vw, vh);
      const drawn = proto.renderArena(ctx, A, (m as unknown as { pal2: unknown }).pal2, prev, lm ? lm.arena.state : restingState(m), alpha, T, ox, oy, time, opts);
      if (lm && inMatch && opts.tags) drawEmotes(ctx, drawn, lm.arena, { T, ox, oy, now: Date.now(), still, placed: opts._placed as number[][] | undefined });
      const gear = lm?.arena.state.gear;
      if (gear) drawGear2D(ctx, gear, T, ox, oy, time, opts.light as number[] | null | undefined, A.w);
      // Equipped cosmetics (skin pattern, trails, nameplates): one call into ./cosmetics.
      if (lm?.arena.cosmetics) drawCosmetics2D(ctx, lm.arena, prev, alpha, T, ox, oy, { ...opts, still } as CosmeticDrawOpts);
      proto.drawWeather(ctx, m, time, vw, vh);
    };

    const loop = (now: number) => {
      draw(now);
      if (!live.current.reducedMotion) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    redraw.current = () => draw(performance.now());
    const onResize = () => {
      resize();
      if (live.current.reducedMotion) draw(performance.now());
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      redraw.current = null;
      window.removeEventListener('resize', onResize);
    };
  }, [reducedMotion]);

  // With reduced motion nothing animates, so a scene or map change draws one new frame.
  useEffect(() => {
    if (reducedMotion) redraw.current?.();
  }, [reducedMotion, scene, mapIdx, liveMatch]);

  return (
    <>
      <canvas
        ref={canvas}
        className="app-arena"
        aria-hidden="true"
        data-testid="arena-canvas"
        data-scene={scene}
        style={reducedMotion ? (tilted ? TILT : undefined) : { ...TILT_EASE, ...(tilted ? TILT : null) }}
      />
      <div ref={dim} className="app-arena-dim" aria-hidden="true" />
      {tilted ? <div className="app-arena-dim" aria-hidden="true" style={TPV_FOG} /> : null}
    </>
  );
}

/** 2D third person: the board tilted back and pulled in (the prototype's #app.tpv #world). */
const TILT_EASE = { transformOrigin: '50% 64%', transition: 'transform 1.1s cubic-bezier(.2,.8,.2,1)' } as const;
const TILT = { transformOrigin: '50% 64%', transform: 'perspective(1100px) rotateX(28deg) scale(1.42)' } as const;
/** The dark sky and vignette over the tilted board (the prototype's #tpfog). */
const TPV_FOG = {
  opacity: 1,
  background:
    'linear-gradient(180deg,rgba(5,8,13,.97) 0%,rgba(5,8,13,.72) 20%,transparent 44%),radial-gradient(85% 70% at 50% 64%,transparent 42%,rgba(3,6,10,.86))',
} as const;

export function matchLayer(L: { layer: MatchLayer | null }, arena: LiveArena, look: string): MatchLayer {
  const n = arena.A.w * arena.A.h;
  const key = `${look}:${arena.A.w}x${arena.A.h}`;
  if (!L.layer || L.layer.key !== key)
    L.layer = { key, target: null, from: null, L: new Float32Array(n), E: new Float32Array(n), fade: {}, fo: null };
  return L.layer;
}

/**
 * The prototype's fog light: each tile eases toward this frame's soft light, and a tile once seen
 * keeps a quarter of its brightest light (explored ground stays dimly visible). Null: no fog.
 */
export function softFog(layer: MatchLayer, arena: LiveArena, dt: number, still: boolean): number[] | null {
  const t = arena.light;
  if (!t) return null;
  const first = !layer.target;
  if (layer.from !== arena) {
    layer.from = arena;
    layer.target = t;
    for (let i = 0; i < t.length; i++) if (t[i]! > layer.E[i]!) layer.E[i] = t[i]!;
  }
  const k = still || first ? 1 : 1 - Math.exp(-dt * 3.2);
  const out = new Array<number>(t.length);
  for (let i = 0; i < t.length; i++) {
    layer.L[i] = layer.L[i]! + (t[i]! - layer.L[i]!) * k;
    out[i] = 0.1 + 0.9 * Math.max(layer.L[i]!, layer.E[i]! * 0.26);
  }
  return out;
}

/** Rivals fade in as they come into sight (and out on a tile this crew cannot see); your crew never fades. */
export function rivalFade(layer: MatchLayer, arena: LiveArena, dt: number, still: boolean): Record<string, number> {
  const k = still ? 1 : 1 - Math.exp(-dt * 6);
  const w = arena.A.w;
  const fd = layer.fade;
  for (const a of arena.state.agents) {
    const rival = arena.team ? a.team !== arena.team : false;
    const target = rival && arena.vis && !arena.vis[a.y * w + a.x] ? 0 : 1;
    const from = fd[a.id] ?? (rival ? 0 : 1);
    fd[a.id] = from + (target - from) * k;
  }
  return fd;
}

/** The previous frame's agents in the current frame's order (rivals come and go from sight). */
export function alignPrev(prev: ArenaState, cur: ArenaState): ArenaState {
  const byId = new Map(prev.agents.map((a) => [a.id, a]));
  return { grid: prev.grid, agents: cur.agents.map((a) => byId.get(a.id) ?? a) };
}

/** This frame's talk as the renderer's barks, timed from when the frame arrived. */
export function barksAt(arena: LiveArena, time: number, age: number) {
  if (!arena.barks) return null;
  const out: Record<string, { text: string; t: number; ch: string; heard?: string }> = {};
  for (const [id, b] of Object.entries(arena.barks)) out[id] = { ...b, t: time - age };
  return out;
}

/** Tiles the intro raises in at the hazard cue: the hazards and switches, or the obstacles on a map without one. */
const revealSets = new Map<string, Set<string>>();
function revealSetOf(m: V2Map): Set<string> {
  let s = revealSets.get(m.id);
  if (!s) {
    s = new Set(Object.keys(m.ev).length ? ['water', 'lava', 'fire', 'valve'] : ['crate', 'dirt', 'valve']);
    revealSets.set(m.id, s);
  }
  return s;
}

/** Slow diagonal grid for maps without scenery (the prototype's drawBackdrop). */
function drawBackdrop(c: CanvasRenderingContext2D, time: number, vw: number, vh: number) {
  const g = 44;
  const off = (time * 6) % g;
  c.strokeStyle = 'rgba(120,170,200,.05)';
  c.lineWidth = 1;
  c.beginPath();
  for (let i = -vh; i < vw + vh; i += g) {
    c.moveTo(i + off, 0);
    c.lineTo(i + off - vh * 2, vh);
    c.moveTo(i - off, 0);
    c.lineTo(i - off + vh * 2, vh);
  }
  c.stroke();
}
