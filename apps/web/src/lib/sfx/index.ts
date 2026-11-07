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

type AudioCtx = Pick<AudioContext, 'currentTime' | 'destination' | 'createOscillator' | 'createGain' | 'state' | 'resume'> &
  Partial<Pick<AudioContext, 'createBuffer' | 'createBufferSource' | 'createBiquadFilter' | 'sampleRate'>>;

/** Match sounds made per agent (pitch per voice, so crewmates sound different). */
export type AgentSound =
  /** A burst of babble syllables while it talks; `seed` varies the melody, `pitch` the voice. */
  | { kind: 'voice'; syllables: number; pitch: number; seed: number }
  /** One soft footfall. */
  | { kind: 'step'; pitch: number }
  /** A cough in gas. */
  | { kind: 'cough' }
  /** A slide on ice. */
  | { kind: 'slide' }
  /** A bluff that landed: a sly rising pair for the liar's crew. */
  | { kind: 'scheme' }
  /** Fooled by a bluff: a falling "boing". */
  | { kind: 'fooled' };

export interface SfxEngine {
  play(cue: SfxCue): void;
  /** Agent sounds in a live match (optional: test fakes may leave it out). */
  agent?(s: AgentSound): void;
}

/** Tones for an agent sound (noise-based ones return none: they use `noiseOf`). */
export function agentTones(s: AgentSound): Tone[] {
  switch (s.kind) {
    case 'voice': {
      // Babble: short square syllables on a small pentatonic melody, a step apart, per voice.
      const scale = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];
      const out: Tone[] = [];
      let r = s.seed * 9301 + 49297;
      for (let i = 0; i < Math.max(1, Math.min(7, s.syllables)); i++) {
        r = (r * 9301 + 49297) % 233280;
        const f = 300 * s.pitch * scale[r % scale.length]!;
        out.push({ f, d: 0.055, type: 'square', g: 0.012, at: i * 0.075, to: f * 0.92 });
      }
      return out;
    }
    case 'step':
      return [{ f: 120 * s.pitch, d: 0.045, type: 'triangle', g: 0.02, to: 70 * s.pitch }];
    case 'scheme':
      return [
        { f: 392, d: 0.09, type: 'triangle', g: 0.03 },
        { f: 587, d: 0.14, type: 'triangle', g: 0.03, at: 0.08 },
      ];
    case 'fooled':
      return [{ f: 520, d: 0.32, type: 'sine', g: 0.035, to: 180 }];
    default:
      return [];
  }
}

/** Filtered noise for the breathy sounds: [filter type, centre Hz, seconds, gain]. */
function noiseOf(s: AgentSound): [BiquadFilterType, number, number, number] | null {
  if (s.kind === 'cough') return ['bandpass', 900, 0.16, 0.05];
  if (s.kind === 'slide') return ['highpass', 2500, 0.3, 0.025];
  return null;
}

/** A player over an AudioContext factory (tests pass a fake; null means no audio support). */
export function createSfx(makeContext: () => AudioCtx | null = browserContext): SfxEngine {
  let ctx: AudioCtx | null | undefined;
  const ready = (): AudioCtx | null => {
    if (ctx === undefined) {
      try {
        ctx = makeContext();
      } catch {
        ctx = null;
      }
    }
    if (ctx && ctx.state === 'suspended') void ctx.resume();
    return ctx ?? null;
  };
  const tones = (c: AudioCtx, list: readonly Tone[]) => {
    for (const t of list) {
      const start = c.currentTime + (t.at ?? 0);
      const o = c.createOscillator();
      const v = c.createGain();
      o.type = t.type;
      o.frequency.setValueAtTime(t.f, start);
      if (t.to) o.frequency.exponentialRampToValueAtTime(t.to, start + t.d);
      v.gain.setValueAtTime(t.g, start);
      v.gain.exponentialRampToValueAtTime(0.0001, start + t.d);
      o.connect(v).connect(c.destination);
      o.start(start);
      o.stop(start + t.d + 0.02);
    }
  };
  return {
    agent(s) {
      const c = ready();
      if (!c) return;
      try {
        const n = noiseOf(s);
        if (n && c.createBuffer && c.createBufferSource && c.createBiquadFilter && c.sampleRate) {
          const [type, hz, d, g] = n;
          const buf = c.createBuffer(1, Math.ceil(c.sampleRate * d), c.sampleRate);
          const data = buf.getChannelData(0);
          for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
          const src = c.createBufferSource();
          src.buffer = buf;
          const f = c.createBiquadFilter();
          f.type = type;
          f.frequency.value = hz;
          const v = c.createGain();
          v.gain.value = g;
          src.connect(f).connect(v).connect(c.destination);
          src.start();
          return;
        }
        tones(c, agentTones(s));
      } catch {
        // Audio is a nicety.
      }
    },
    play(cue) {
      const c = ready();
      if (!c) return;
      try {
        tones(c, CUES[cue]);
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
  return useMemo(
    () => ({
      play: (cue: SfxCue) => (on ? engine.play(cue) : undefined),
      agent: (a: AgentSound) => (on ? engine.agent?.(a) : undefined),
    }),
    [on, engine],
  );
}
