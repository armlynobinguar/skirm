'use client';
// An ended match played back from its stored frames (v2_replay → v2_frames) at ¼× to 4×, with the
// live HUD. The only place the speed control shows: a live match runs at the server's pace.
// Highlights (GET /v2/matches/:id/highlights, or given by a shared link) show as jump buttons with
// the caster's line; `?t=<tick>` in the URL (a highlight's Watch link) starts the playback there.
import { Button } from '@skirm/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { qk } from '@/lib/api/queries';
import type { ReplayHighlight } from '@/lib/api/types';
import { useApi, useRealtime } from '@/lib/services';
import type { FrameAgent, V2Frame } from '@/lib/realtime/protocol';
import { HighlightStrip } from '../../replays/Highlights';
import { MatchHud } from '../Live';
import v from '../v2.module.css';
import { linesOf, rivalsSeen, type V2CommsLine, type V2MatchView } from '../v2Store';

/** The index of the first frame at or after `tick` (the last frame when none is). */
export function frameIndexAt(frames: readonly V2Frame[], tick: number): number {
  const i = frames.findIndex((f) => f.tick >= tick);
  return i < 0 ? Math.max(0, frames.length - 1) : i;
}

export interface ReplayProps {
  view: V2MatchView;
  /** Why the stored frames could not be had (the server's error while asking). */
  error?: string | null;
  onExit: () => void;
  /** Highlights already known (a shared link); otherwise asked for from the api. */
  highlights?: readonly ReplayHighlight[];
  caster?: 'model' | 'template' | null;
  /** The tick to start on (default: `?t=` in the URL, else the first frame). */
  startTick?: number;
}

export function Replay({ view, error = null, onExit, highlights, caster, startTick }: ReplayProps) {
  const rt = useRealtime();
  const api = useApi();
  const frames = view.replay;
  const asked = !!frames;
  useEffect(() => {
    if (!asked) rt.send({ type: 'v2_replay', matchId: view.matchId });
  }, [rt, view.matchId, asked]);
  const fetched = useQuery({
    queryKey: qk.matches.highlights(view.matchId),
    queryFn: () => api.v2Highlights(view.matchId),
    enabled: !highlights && !!frames?.length,
    staleTime: 60_000,
    retry: false,
  });
  const moments = highlights ?? fetched.data?.highlights ?? [];
  const [idx, setIdx] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(true);
  // Start where asked: the prop, else the URL's ?t= (once the frames are in).
  const hasFrames = !!frames?.length;
  useEffect(() => {
    if (!hasFrames || !frames) return;
    const fromUrl = Number(new URLSearchParams(window.location.search).get('t'));
    const t = startTick ?? (Number.isFinite(fromUrl) && fromUrl > 0 ? fromUrl : null);
    if (t !== null) setIdx(frameIndexAt(frames, t));
    // Once, when the frames arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFrames]);
  // Feed lines and rivals seen, built once for the whole match.
  const built = useMemo(() => {
    if (!frames) return null;
    const lines: V2CommsLine[] = [];
    const rivals: FrameAgent[][] = [];
    let seen: FrameAgent[] = [];
    frames.forEach((f, i) => {
      lines.push(...linesOf(f, frames[i - 1] ?? null, lines));
      seen = rivalsSeen(seen, f);
      rivals.push(seen);
    });
    return { lines, rivals };
  }, [frames]);
  const last = (frames?.length ?? 1) - 1;
  useEffect(() => {
    if (!frames || !playing || idx >= last) return;
    const t = setTimeout(() => setIdx((i) => Math.min(last, i + 1)), view.tickMs / speed);
    return () => clearTimeout(t);
  }, [frames, playing, idx, last, speed, view.tickMs]);

  if (!frames || !built || !frames.length)
    return (
      <div className={v.wait} data-testid="v2-replay-loading">
        <p className="sk-kick">{frames ? 'No stored frames for this match.' : error ? `No replay: ${error}` : 'Loading the replay…'}</p>
        <Button size="sm" variant="ghost" onClick={onExit}>
          Back to the debrief
        </Button>
      </div>
    );
  const frame = frames[idx]!;
  const source = {
    frame,
    prevFrame: frames[idx - 1] ?? null,
    comms: built.lines.filter((l) => l.tick <= frame.tick),
    rivals: built.rivals[idx] ?? [],
  };
  return (
    <>
      <MatchHud
        view={view}
        source={source}
        paused={!playing}
        onPause={() => {
          if (idx >= last) {
            setIdx(0);
            setPlaying(true);
          } else setPlaying((p) => !p);
        }}
        replay={{ speed, onSpeed: setSpeed, atEnd: idx >= last, onExit }}
      />
      <HighlightStrip
        highlights={moments}
        tick={frame.tick}
        caster={caster ?? fetched.data?.caster ?? null}
        onJump={(h) => {
          setIdx(frameIndexAt(frames, h.start));
          setPlaying(true);
        }}
      />
    </>
  );
}
