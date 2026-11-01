'use client';
// An ended match played back from its stored frames (v2_replay → v2_frames) at ¼× to 4×, with the
// live HUD. The only place the speed control shows: a live match runs at the server's pace.
import { Button } from '@skirm/ui';
import { useEffect, useMemo, useState } from 'react';
import { useRealtime } from '@/lib/services';
import type { FrameAgent } from '@/lib/realtime/protocol';
import { MatchHud } from '../Live';
import v from '../v2.module.css';
import { linesOf, rivalsSeen, type V2CommsLine, type V2MatchView } from '../v2Store';

/** `error`: why the stored frames could not be had (the server's error while asking). */
export function Replay({ view, error = null, onExit }: { view: V2MatchView; error?: string | null; onExit: () => void }) {
  const rt = useRealtime();
  const frames = view.replay;
  const asked = !!frames;
  useEffect(() => {
    if (!asked) rt.send({ type: 'v2_replay', matchId: view.matchId });
  }, [rt, view.matchId, asked]);
  const [idx, setIdx] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(true);
  // Feed lines and rivals seen, built once for the whole match.
  const built = useMemo(() => {
    if (!frames) return null;
    const lines: V2CommsLine[] = [];
    const rivals: FrameAgent[][] = [];
    let seen: FrameAgent[] = [];
    frames.forEach((f, i) => {
      lines.push(...linesOf(f, frames[i - 1] ?? null));
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
  );
}
