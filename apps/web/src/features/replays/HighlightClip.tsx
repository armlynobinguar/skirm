'use client';
// The debrief's highlight clip: the match's single best moment (clip.ts pickClipMoment) played as a
// ~6 s loop on its own canvas, shot like the home showreel (letterbox, a push-in toward the moment,
// a flash and a ring on the beat), with its caption ("Bluff · Moth fooled Vex") and a link to the
// full replay. Frames come from v2_replay (a player's own crew view, a spectator's whole board),
// highlights from GET /v2/matches/:id/highlights, so it shows nothing this viewer could not see.
// It renders nothing until both are in, or when there is no moment; with reduced motion it shows
// the moment's frame, still. It only animates while on screen.
import { Button } from '@skirm/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ButtonLink } from '@/components/ButtonLink';
import { alignPrev, barksAt } from '@/features/arena/ArenaCanvas';
import { composeV2Arena, walkMs, type LiveArena } from '@/features/arena/live';
import * as proto from '@/features/arena/proto/world';
import { mapById } from '@/features/arena/world';
import { qk } from '@/lib/api/queries';
import { usePreferences } from '@/lib/preferences';
import type { V2Frame } from '@/lib/realtime/protocol';
import { useApi, useRealtime } from '@/lib/services';
import { useV2Match } from '../v2/v2Store';
import { tickClock } from './Highlights';
import { clipCaption, clipDurations, clipFocus, clipWindow, pickClipMoment, type ClipMoment } from './clip';
import c from './highlightClip.module.css';

type Team = 'A' | 'B';

export interface HighlightClipProps {
  matchId: string;
  /** The viewer's crew (a spectator: 'A', with `watch`). */
  team: Team;
  watch: boolean;
  handles: Record<Team, string | null>;
  onReplay?: () => void;
  replayHref?: string;
}

export function HighlightClip({ matchId, team, watch, handles, onReplay, replayHref }: HighlightClipProps) {
  const api = useApi();
  const rt = useRealtime();
  const view = useV2Match(matchId);
  const highlights = useQuery({
    queryKey: qk.matches.highlights(matchId),
    queryFn: () => api.v2Highlights(matchId),
    staleTime: 60_000,
    retry: false,
  });
  const kept = !!highlights.data?.framesKept;
  const frames = view?.replay ?? null;
  // Ask for the stored frames once they are kept (the Replay screen reuses them from the store).
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!kept || frames || asked.current === matchId) return;
    asked.current = matchId;
    rt.send({ type: 'v2_replay', matchId });
  }, [kept, frames, rt, matchId]);

  // Keyed on the handles' values: the debrief rebuilds its data (and this object) on every render.
  const hA = handles.A;
  const hB = handles.B;
  const clip = useMemo(() => {
    if (!frames?.length || !highlights.data) return null;
    const fs = frames.slice().sort((a, b) => a.tick - b.tick);
    const moment = pickClipMoment(highlights.data.highlights, fs, { team: watch ? null : team, crews: { A: hA, B: hB } });
    if (!moment) return null;
    const w = clipWindow(fs, moment.tick);
    if (!w) return null;
    return { moment, frames: fs.slice(w.from, w.to + 1), before: fs[w.from - 1] ?? null, at: w.moment - w.from };
  }, [frames, highlights.data, team, watch, hA, hB]);

  if (!clip) return null;
  return <ClipPlayer key={clip.moment.id} {...clip} team={team} watch={watch} handles={handles} onReplay={onReplay} replayHref={replayHref} />;
}

interface PlayerProps {
  moment: ClipMoment;
  frames: V2Frame[];
  before: V2Frame | null;
  at: number;
  team: Team;
  watch: boolean;
  handles: Record<Team, string | null>;
  onReplay?: () => void;
  replayHref?: string;
}

/** The ring and flash on the moment's beat last this long. */
const BEAT_FX_MS = 900;
/** The black dip when the loop starts over. */
const CUT_MS = 260;

function ClipPlayer({ moment, frames, before, at, team, watch, handles, onReplay, replayHref }: PlayerProps) {
  const { reducedMotion } = usePreferences();
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  // The frame showing and which pass of the loop (it re-keys the beat's flash).
  const [shown, setShown] = useState({ idx: reducedMotion ? at : 0, pass: 0 });

  // The arenas of the clip, each composed on the one before (stuns and reactions carry over).
  const arenas = useMemo(() => {
    let prev: LiveArena | null = before ? composeV2Arena(before) : null;
    return frames.map((f) => (prev = composeV2Arena(f, prev)));
  }, [frames, before]);
  const durations = useMemo(() => clipDurations(frames.length, at), [frames.length, at]);
  const focus = useMemo(() => clipFocus(frames[at]!, moment), [frames, at, moment]);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const still = reducedMotion;
    if (!still && !visible) return;
    const m = mapById(frames[0]!.mapId);
    if (!m) return;
    let raf = 0;
    let idx = still ? at : 0;
    let pass = 0;
    let frameAt = performance.now();
    let beatAt: number | null = still ? null : idx === at ? frameAt : null;
    const t0 = frameAt;
    const startOf = (i: number) => durations.slice(0, i).reduce((n, d) => n + d, 0);

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
      const arena = arenas[idx];
      if (!arena) return;
      const A = arena.A;
      const time = still ? 0 : (now - t0) / 1000;
      const since = now - frameAt;
      // The push-in: eases toward the moment over the build-up, then holds tight on it.
      const life = still ? 1 : Math.min(1, (startOf(idx) + Math.min(since, durations[idx] ?? 0)) / Math.max(1, startOf(at) + 1));
      const k = life * life * (3 - 2 * life);
      const zoom = 1.08 + 0.42 * k;
      const T = proto.fitT(A, w * 0.98, h * 0.98) * zoom;
      const cx = (A.w - 1) / 2;
      const cy = (A.h - 1) / 2;
      const fx = focus ? cx + (focus.x - cx) * (0.3 + 0.6 * k) : cx;
      const fy = focus ? cy + (focus.y - cy) * (0.3 + 0.6 * k) : cy;
      const ox = w / 2 - ((fx - fy) * T) / 2;
      const oy = h * 0.54 - ((fx + fy) * T) / 4;
      const prevArena = idx > 0 ? arenas[idx - 1] : null;
      const alpha = prevArena && !still ? Math.min(1, since / walkMs(durations[idx] ?? 500)) : 1;
      if (!proto.drawScenery(ctx, m, A, T, ox, oy, time, w, h)) {
        ctx.fillStyle = '#070c13';
        ctx.fillRect(0, 0, w, h);
      }
      const tick = arena.tick ?? 0;
      proto.renderArena(ctx, A, (m as unknown as { pal2: unknown }).pal2, prevArena ? alignPrev(prevArena.state, arena.state) : null, arena.state, alpha, T, ox, oy, time, {
        intro: 9,
        age: since / 1000,
        still,
        tags: true,
        barks: barksAt(arena, time, since / 1000),
        light: arena.light ?? null,
        lanes: proto.laneSetOf(A),
        drops: (A.drops as number[][]).filter((d) => tick < d[2]!),
      });
      proto.drawWeather(ctx, m, time, w, h);
      // The beat: a ring on the moment's spot (a fixed one in the still).
      const ring = still ? 0.35 : beatAt != null ? (now - beatAt) / BEAT_FX_MS : 2;
      if (focus && ring <= 1) {
        const sx = ox + ((focus.x - focus.y) * T) / 2;
        const sy = oy + ((focus.x + focus.y) * T) / 4 - T * 0.13;
        const rr = T * (0.5 + 1.6 * ring);
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - ring) * 0.9;
        ctx.strokeStyle = '#ffb547';
        ctx.lineWidth = Math.max(2, T / 10);
        ctx.beginPath();
        ctx.ellipse(sx, sy, rr, rr / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      // The loop's cut: a short dip from black.
      if (!still && pass > 0 && idx === 0 && since < CUT_MS) {
        ctx.fillStyle = `rgba(0,0,0,${1 - since / CUT_MS})`;
        ctx.fillRect(0, 0, w, h);
      }
    };

    const loop = (now: number) => {
      if (now - frameAt >= (durations[idx] ?? 500)) {
        idx = idx + 1 >= frames.length ? 0 : idx + 1;
        if (idx === 0) pass++;
        frameAt = now;
        if (idx === at) beatAt = now;
        setShown({ idx, pass });
      }
      draw(now);
      raf = requestAnimationFrame(loop);
    };

    const onResize = () => {
      dims = size();
      if (still) draw(performance.now());
    };
    window.addEventListener('resize', onResize);
    setShown({ idx, pass });
    if (still) draw(performance.now());
    else raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [visible, reducedMotion, arenas, durations, frames, at, focus]);

  const frame = frames[shown.idx] ?? frames[at]!;
  const beat = !reducedMotion && shown.idx >= at;
  const crew = (t: Team) => handles[t] ?? `Crew ${t}`;
  const tone = (t: Team | null) => (t === null ? 'n' : watch ? (t === 'A' ? 'you' : 'rival') : t === team ? 'you' : 'rival');
  const progress = frames.length > 1 ? shown.idx / (frames.length - 1) : 1;
  const caption = clipCaption(moment);
  return (
    <section className={c.clip} aria-label="Highlight of the match" data-testid="v2-highlight-clip" data-kind={moment.kind} data-still={reducedMotion || undefined}>
      <div className={c.screen} ref={box}>
        <canvas ref={canvas} className={c.canvas} role="img" aria-label={`${caption}. ${moment.line}`} />
        <div className={c.bars} aria-hidden="true" />
        <div className={c.vignette} aria-hidden="true" />
        {beat ? <div key={shown.pass} className={c.flash} aria-hidden="true" /> : null}

        <div className={c.top} aria-hidden="true">
          <span className={c.tag}>
            <i />
            Highlight
          </span>
          <span className={c.clock}>{tickClock(frame.tick)}</span>
          <span className={c.score}>
            <b data-tone={tone('A')}>{crew('A')}</b> {frame.score.A}
            <i>–</i>
            {frame.score.B} <b data-tone={tone('B')}>{crew('B')}</b>
          </span>
        </div>

        <div className={c.lower} data-tone={tone(moment.team)} data-beat={beat || undefined}>
          <p className={c.caption} data-testid="v2-highlight-caption">
            <span className={c.kind}>{moment.label}</span>{' '}
            <span className={c.dot}>·</span>{' '}
            <span className={c.what}>{moment.caption}</span>
          </p>
          <p className={c.line}>{moment.line}</p>
        </div>

        {reducedMotion ? null : (
          <div className={c.progress} aria-hidden="true">
            <span style={{ transform: `scaleX(${progress})` }} />
          </div>
        )}
      </div>
      <div className={c.foot}>
        <span className="sk-kick">
          <b>Best moment</b> · {tickClock(moment.tick)}
          {watch ? ' · the whole board' : ' · as your crew saw it'}
        </span>
        {onReplay ? (
          <Button size="sm" onClick={onReplay} data-testid="v2-clip-replay">
            Watch full replay ▸
          </Button>
        ) : replayHref ? (
          <ButtonLink size="sm" href={replayHref} data-testid="v2-clip-replay">
            Watch full replay ▸
          </ButtonLink>
        ) : null}
      </div>
    </section>
  );
}
