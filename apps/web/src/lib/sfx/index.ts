'use client';
// Interface sound effects for the v2 Arena look (Skirm Arena Deck prototype): short synthesized
// tones through Web Audio, so there are no audio files to load. Off when the player turns off the
// "Sound effects" preference. Browsers only allow audio after a user gesture, so the AudioContext is
// created lazily on the first play() (every cue comes from a click or key press, or follows one).
//
//   const sfx = useSfx();
//   sfx.play('click');
import { useMemo } from 'react';
import { usePreferences } from '@/lib/preferences';

export type SfxCue = 'hover' | 'click' | 'wipe' | 'tick' | 'good' | 'bad' | 'blip' | 'radio';

interface Tone {
  /** Start frequency in Hz. */
  f: number;
  /** Duration in seconds. */
  d: number;
  type: OscillatorType;
  /** Peak gain. */
  g: number;
  /** Start offset in seconds. */
  at?: number;
  /** End frequency for a slide. */
  to?: number;
}

/** The prototype's cues, tone by tone. */
export const CUES: Record<SfxCue, Tone[]> = {
  hover: [{ f: 1800, d: 0.03, type: 'sine', g: 0.012 }],
  click: [
    { f: 660, d: 0.07, type: 'triangle', g: 0.05 },
    { f: 990, d: 0.09, type: 'triangle', g: 0.04, at: 0.05 },
  ],
  wipe: [
    { f: 180, d: 0.45, type: 'sawtooth', g: 0.025, to: 900 },
    { f: 90, d: 0.5, type: 'sine', g: 0.05, at: 0.05, to: 60 },
  ],
  tick: [{ f: 260, d: 0.035, type: 'square', g: 0.012 }],
  good: [523, 659, 784, 1046].map((f, i) => ({ f, d: 0.22, type: 'triangle' as const, g: 0.05, at: i * 0.09 })),
  bad: [330, 262, 196].map((f, i) => ({ f, d: 0.25, type: 'sawtooth' as const, g: 0.03, at: i * 0.12 })),
  blip: [{ f: 1320, d: 0.08, type: 'sine', g: 0.035 }],
  radio: [
    { f: 900, d: 0.05, type: 'square', g: 0.012 },
    { f: 1200, d: 0.05, type: 'square', g: 0.012, at: 0.06 },
  ],
};

type AudioCtx = Pick<AudioContext, 'currentTime' | 'destination' | 'createOscillator' | 'createGain' | 'state' | 'resume'>;

export interface SfxEngine {
  play(cue: SfxCue): void;
}

/** A player over an AudioContext factory (tests pass a fake; null means no audio support). */
export function createSfx(makeContext: () => AudioCtx | null = browserContext): SfxEngine {
  let ctx: AudioCtx | null | undefined;
  return {
    play(cue) {
      if (ctx === undefined) {
        try {
          ctx = makeContext();
        } catch {
          ctx = null;
        }
      }
      if (!ctx) return;
      try {
        if (ctx.state === 'suspended') void ctx.resume();
        for (const t of CUES[cue]) {
          const start = ctx.currentTime + (t.at ?? 0);
          const o = ctx.createOscillator();
          const v = ctx.createGain();
          o.type = t.type;
          o.frequency.setValueAtTime(t.f, start);
          if (t.to) o.frequency.exponentialRampToValueAtTime(t.to, start + t.d);
          v.gain.setValueAtTime(t.g, start);
          v.gain.exponentialRampToValueAtTime(0.0001, start + t.d);
          o.connect(v).connect(ctx.destination);
          o.start(start);
          o.stop(start + t.d + 0.02);
        }
      } catch {
        // Audio is a nicety: a failing context never breaks the screen.
      }
    },
  };
}

function browserContext(): AudioCtx | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

let shared: SfxEngine | null = null;
/** The tab-wide player (one AudioContext per tab). */
export function sfxEngine(): SfxEngine {
  return (shared ??= createSfx());
}

/** Plays cues when the "Sound effects" preference is on; a no-op otherwise. */
export function useSfx(engine: SfxEngine = sfxEngine()): SfxEngine {
  const { prefs } = usePreferences();
  const on = prefs.sfx;
  return useMemo(() => ({ play: (cue: SfxCue) => (on ? engine.play(cue) : undefined) }), [on, engine]);
}
