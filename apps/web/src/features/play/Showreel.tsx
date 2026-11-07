'use client';
// The showreel under the Command deck: real matches between two greedy-bot crews, played tick by tick
// in the browser (reels.ts) and shot like a trailer: letterbox bars, a slow push-in that drifts
// toward the action, a title card on every cut, the score and captions read off the engine's events.
// It only plays while it is on screen and the tab is visible; with reduced motion it shows one still
// frame per reel and changes reel only when asked.
import { DisplayHeading } from '@skirm/ui';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { alignPrev, barksAt } from '@/features/arena/ArenaCanvas';
import { composeV2Arena, type LiveArena } from '@/features/arena/live';
import * as proto from '@/features/arena/proto/world';
import { mapById, type ArenaState } from '@/features/arena/world';
import { usePreferences } from '@/lib/preferences';
import { routes } from '@/lib/routes';
import { CREW_NAMES, REEL_TICKS, captionsOf, reelMaps, startReel, stepReel, type Caption, type Reel } from './reels';
import r from './showreel.module.css';

/** Wall time per tick: a little slower than a live match reads, so each move lands. */
const TICK_MS = 420;
/** The title card over black at every cut. */
const CUT_MS = 1600;
/** The last frame holds this long before the cut. */
const HOLD_MS = 1500;

interface Hud {
  reel: number;
  score: { A: number; B: number };
  goal: number;
  progress: number;
  captions: Caption[];
  cut: boolean;
}

export function Showreel() {
  const maps = useMemo(() => reelMaps(), []);
  const { reducedMotion } = usePreferences();
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  // The reel picked from the list; the loop moves on by itself from there.
  const [picked, setPicked] = useState(0);
  const [hud, setHud] = useState<Hud>({ reel: 0, score: { A: 0, B: 0 }, goal: 0, progress: 0, captions: [], cut: true });

  // Plays only while on screen.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx || !visible) return;
    const still = reducedMotion;
    let raf = 0;
    let idx = picked % maps.length;
    let reel: Reel = startReel(maps[idx]!);
    let arena: LiveArena | null = composeV2Arena(reel.frame);
    let prev: ArenaState | null = null;
    let captions: Caption[] = [];
    let captionId = 0;
    let focus: { x: number; y: number } | null = null;
    // card: the title card over black; play: ticking; hold: the last frame before the cut.
    let phase: 'card' | 'play' | 'hold' = still ? 'play' : 'card';
    let phaseAt = performance.now();
    let frameAt = phaseAt;
    let lastTick = phaseAt;
    const t0 = phaseAt;

    const publish = () =>
      setHud({
        reel: idx,
        score: { A: reel.s.score.A, B: reel.s.score.B },
        goal: reel.goal,
        progress: reel.shown / REEL_TICKS,
        captions,
        cut: phase === 'card',
      });

    const load = (i: number, now: number) => {
      idx = i;
      reel = startReel(maps[idx]!);
      arena = composeV2Arena(reel.frame);
      prev = null;
      captions = [];
      focus = null;
      phase = 'card';
      phaseAt = now;
      frameAt = now;
      publish();
    };

    const size = () => {
      const rect = cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(rect.width * dpr));
      cv.height = Math.max(1, Math.round(rect.height * dpr));
      return { w: rect.width, h: rect.height, dpr };
    };
    let dims = size();

    const draw = (now: number) => {
      const { w, h, dpr } = dims;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#05080d';
      ctx.fillRect(0, 0, w, h);
      const m = mapById(reel.def.id);
      if (!arena || !m) return;
      const A = arena.A;
      const time = still ? 0 : (now - t0) / 1000;
      // The push-in: 1.0 to 1.3 over the reel while the camera drifts toward the crews' centre.
      const life = still ? 0.5 : phase === 'card' ? 0 : Math.min(1, (reel.shown + (now - frameAt) / TICK_MS) / REEL_TICKS);
      const zoom = 1 + 0.3 * life;
      const T = proto.fitT(A, w * 0.98, h * 0.98) * zoom;
      const live = arena.state.agents.filter((a) => !a.out);
      const cx = (A.w - 1) / 2;
      const cy = (A.h - 1) / 2;
      const tx = live.length ? live.reduce((n, a) => n + a.x, 0) / live.length : cx;
      const ty = live.length ? live.reduce((n, a) => n + a.y, 0) / live.length : cy;
      const want = { x: cx + (tx - cx) * 0.55 * life, y: cy + (ty - cy) * 0.55 * life };
      focus = !focus || still ? want : { x: focus.x + (want.x - focus.x) * 0.04, y: focus.y + (want.y - focus.y) * 0.04 };
      const ox = w / 2 - ((focus.x - focus.y) * T) / 2;
      const oy = h * 0.52 - ((focus.x + focus.y) * T) / 4;
      const age = (now - frameAt) / 1000;
      const alpha = prev && !still ? Math.min(1, (now - frameAt) / 400) : 1;
      if (!proto.drawScenery(ctx, m, A, T, ox, oy, time, w, h)) {
        ctx.fillStyle = '#070c13';
        ctx.fillRect(0, 0, w, h);
      }
      const tick = arena.tick ?? 0;
      proto.renderArena(ctx, A, (m as unknown as { pal2: unknown }).pal2, prev ? alignPrev(prev, arena.state) : null, arena.state, alpha, T, ox, oy, time, {
        intro: 9,
        age,
        still,
        tags: true,
        barks: barksAt(arena, time, age),
        lanes: proto.laneSetOf(A),
        drops: (A.drops as number[][]).filter((d) => tick < d[2]!),
      });
      proto.drawWeather(ctx, m, time, w, h);
    };

    const loop = (now: number) => {
      if (phase === 'card' && now - phaseAt >= CUT_MS) {
        phase = 'play';
        phaseAt = now;
        lastTick = now;
        publish();
      } else if (phase === 'play' && now - lastTick >= TICK_MS) {
        lastTick = now;
        prev = arena?.state ?? null;
        const ev = stepReel(reel);
        arena = composeV2Arena(reel.frame, arena);
        frameAt = now;
        for (const c of captionsOf(reel, ev)) captions = [...captions, { ...c, id: ++captionId }].slice(-3);
        if (reel.done) {
          phase = 'hold';
          phaseAt = now;
        }
        publish();
      } else if (phase === 'hold' && now - phaseAt >= HOLD_MS) load((idx + 1) % maps.length, now);
      draw(now);
      raf = requestAnimationFrame(loop);
    };

    const onResize = () => {
      dims = size();
      if (still) draw(performance.now());
    };
    window.addEventListener('resize', onResize);
    if (still) {
      // One still frame, mid-reel.
      for (let i = 0; i < REEL_TICKS / 2 && !reel.done; i++) stepReel(reel);
      arena = composeV2Arena(reel.frame);
      publish();
      draw(performance.now());
    } else {
      publish();
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [visible, reducedMotion, maps, picked]);

  const def = maps[hud.reel] ?? maps[0]!;
  // Picking the reel already showing starts it over.
  const pick = (i: number) => {
    setHud((h) => ({ ...h, reel: i }));
    setPicked((p) => (p === i ? i + maps.length : i));
  };

  return (
    <section className={r.section} aria-labelledby="showreel-title" data-testid="s02-showreel">
      <header className={r.head}>
        <span className="sk-kick">Showreel · two bot crews, played live in your browser</span>
        <DisplayHeading level={2} id="showreel-title" className={r.title}>
          From the arena
        </DisplayHeading>
      </header>

      <div className={r.screen} ref={box}>
        <canvas ref={canvas} className={r.canvas} aria-hidden="true" />
        <div className={r.bars} aria-hidden="true" />
        <div className={r.vignette} aria-hidden="true" />

        <div className={r.hudTop}>
          <span className={r.reelNo}>
            REEL {String(hud.reel + 1).padStart(2, '0')}
            <i> / {String(maps.length).padStart(2, '0')}</i>
          </span>
          <span className={r.mapName}>
            {def.code} · {def.name}
          </span>
          <span className={r.score} aria-live="off" data-testid="showreel-score">
            <b className={r.a}>{CREW_NAMES.A.split(' ')[0]}</b> {hud.score.A}
            <i>–</i>
            {hud.score.B} <b className={r.b}>{CREW_NAMES.B.split(' ')[0]}</b>
            {hud.goal ? <small> · to {hud.goal}</small> : null}
          </span>
        </div>

        <ol className={r.captions} aria-hidden="true">
          {hud.captions.map((c) => (
            <li key={c.id} className={c.team === 'A' ? r.capA : c.team === 'B' ? r.capB : r.capN}>
              {c.text}
            </li>
          ))}
        </ol>

        <div className={r.progress} aria-hidden="true">
          <span style={{ transform: `scaleX(${Math.min(1, hud.progress)})` }} />
        </div>

        <div className={r.card} data-on={hud.cut || undefined} aria-hidden="true">
          <span className="sk-kick">
            Reel {String(hud.reel + 1).padStart(2, '0')} · {def.region}
          </span>
          <span className={r.cardName}>{def.name}</span>
          <span className={r.cardSub}>
            {CREW_NAMES.A} vs {CREW_NAMES.B}
          </span>
        </div>
      </div>

      <div className={r.foot}>
        <nav className={r.reels} aria-label="Reels">
          {maps.map((m, i) => (
            <button
              key={m.id}
              type="button"
              className={r.reelBtn}
              aria-current={i === hud.reel || undefined}
              onClick={() => pick(i)}
              data-testid={`showreel-reel-${i}`}
            >
              <i>{String(i + 1).padStart(2, '0')}</i>
              {m.name}
            </button>
          ))}
        </nav>
        <div className={r.cta}>
          <Link href={routes.pvp()} className={r.ctaMain}>
            Queue ranked ▸
          </Link>
          <Link href={routes.atlas()} className={r.ctaGhost}>
            All maps
          </Link>
        </div>
      </div>
    </section>
  );
}
