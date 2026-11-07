'use client';
// Background music: an original loop synthesized live with Web Audio (no audio files to load or
// license), in two moods. The menus play a calm minor progression (pad, bass, a slow arpeggio);
// a match plays a faster, tenser one (pulsing bass, a 16th arpeggio, kick and hats). A mood change
// lands on the next bar. Browsers only allow audio after a user gesture, so the player starts on
// the first click or key press (MusicPlayer); the "Music" toggle in the top bar turns it off.
//
//   const m = musicEngine();
//   m.start('menu');  m.setMood('match');  m.stop();

export type MusicMood = 'menu' | 'match';

interface Song {
  bpm: number;
  /** One chord a bar: root (MIDI) and its triad as semitones above it. */
  bars: readonly (readonly [number, readonly number[]])[];
  /** Arpeggio notes per beat (2: 8ths, 4: 16ths). */
  arp: number;
  /** Bass hits per beat. */
  bass: number;
  drums: boolean;
}

/** The two moods. A minor; the match swaps in iv and a major V for tension. */
export const SONGS: Record<MusicMood, Song> = {
  menu: {
    bpm: 84,
    bars: [
      [45, [0, 3, 7]], // Am
      [41, [0, 4, 7]], // F
      [48, [0, 4, 7]], // C
      [43, [0, 4, 7]], // G
    ],
    arp: 2,
    bass: 0.5,
    drums: false,
  },
  match: {
    bpm: 112,
    bars: [
      [45, [0, 3, 7]], // Am
      [50, [0, 3, 7]], // Dm
      [41, [0, 4, 7]], // F
      [40, [0, 4, 7]], // E
    ],
    arp: 4,
    bass: 2,
    drums: true,
  },
};

export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** The arpeggio's note on a 16th step within a bar (pure, for the tests). */
export function arpNote(root: number, triad: readonly number[], i: number): number {
  const pattern = [0, 1, 2, 1, 0, 2, 1, 2];
  const k = pattern[i % pattern.length]!;
  const up = Math.floor(i / pattern.length) % 2 ? 12 : 0;
  return root + 24 + triad[k]! + up;
}

export interface MusicEngine {
  start(mood: MusicMood): void;
  setMood(mood: MusicMood): void;
  stop(): void;
  readonly playing: boolean;
}

const LOOKAHEAD_S = 0.15;
/** Overall music level: a bed about 5-9 LU under the UI cues (sfx LEVEL), audible on laptop speakers (0.08 was not). */
const MASTER = 0.45;

export function createMusic(makeContext: () => AudioContext | null = browserContext): MusicEngine {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let mood: MusicMood = 'menu';
  let next: MusicMood = 'menu';
  let step = 0; // 16th notes since the start
  let at = 0; // audio time of the next 16th
  let playing = false;
  const onVisible = () => {
    if (!ctx) return;
    if (document.visibilityState === 'visible') void ctx.resume();
    else void ctx.suspend();
  };

  const note = (f: number, t: number, d: number, type: OscillatorType, g: number, cutoff?: number, attack = 0.01) => {
    if (!ctx || !master) return;
    const o = ctx.createOscillator();
    const v = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    v.gain.setValueAtTime(0.0001, t);
    v.gain.exponentialRampToValueAtTime(g, t + attack);
    v.gain.exponentialRampToValueAtTime(0.0001, t + d);
    let out: AudioNode = v;
    if (cutoff) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cutoff;
      v.connect(lp);
      out = lp;
    }
    o.connect(v);
    out.connect(master);
    o.start(t);
    o.stop(t + d + 0.05);
  };

  const kick = (t: number) => {
    if (!ctx || !master) return;
    const o = ctx.createOscillator();
    const v = ctx.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
    // 0.3: at 0.5 the kick alone was louder than the menu song and set the match song's peak.
    v.gain.setValueAtTime(0.3, t);
    v.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(v).connect(master);
    o.start(t);
    o.stop(t + 0.25);
  };

  const hat = (t: number, g: number) => {
    if (!ctx || !master || !noise) return;
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const v = ctx.createGain();
    v.gain.setValueAtTime(g, t);
    v.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    s.connect(hp).connect(v).connect(master);
    s.start(t);
    s.stop(t + 0.05);
  };

  /** Schedules the 16th at `t` (step `i` of the current song). */
  const schedule = (i: number, t: number) => {
    // Mood changes land on a bar line.
    if (i % 16 === 0) mood = next;
    const song = SONGS[mood];
    const sixteenth = 60 / song.bpm / 4;
    const bar = Math.floor(i / 16) % song.bars.length;
    const [root, triad] = song.bars[bar]!;
    const inBar = i % 16;
    if (inBar === 0) {
      // Pad: the chord an octave up, slow attack, the whole bar.
      for (const s of triad) {
        note(hz(root + 12 + s) * 0.997, t, sixteenth * 16, 'sawtooth', 0.05, 900, 0.5);
        note(hz(root + 12 + s) * 1.003, t, sixteenth * 16, 'sawtooth', 0.05, 900, 0.5);
      }
    }
    const bassEvery = Math.round(4 / song.bass);
    if (inBar % bassEvery === 0) note(hz(root), t, sixteenth * bassEvery * 0.9, mood === 'match' ? 'sawtooth' : 'triangle', 0.22, mood === 'match' ? 500 : undefined);
    const arpEvery = 4 / song.arp;
    if (inBar % arpEvery === 0) note(hz(arpNote(root, triad, inBar / arpEvery)), t, sixteenth * arpEvery * 1.6, 'triangle', 0.07, 2600);
    if (song.drums) {
      if (inBar % 8 === 0) kick(t);
      if (inBar % 4 === 2) hat(t, 0.08);
      else if (inBar % 2 === 1) hat(t, 0.03);
    }
    return sixteenth;
  };

  const pump = () => {
    if (!ctx) return;
    while (at < ctx.currentTime + LOOKAHEAD_S) {
      at += schedule(step, at);
      step++;
    }
  };

  return {
    get playing() {
      return playing;
    },
    start(m) {
      next = m;
      if (playing) return;
      try {
        ctx ??= makeContext();
        if (!ctx) return;
        void ctx.resume();
        master = ctx.createGain();
        master.gain.setValueAtTime(0.0001, ctx.currentTime);
        master.gain.exponentialRampToValueAtTime(MASTER, ctx.currentTime + 2);
        master.connect(ctx.destination);
        if (!noise) {
          noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.05), ctx.sampleRate);
          const d = noise.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        mood = m;
        step = 0;
        at = ctx.currentTime + 0.05;
        timer = setInterval(pump, 25);
        document.addEventListener('visibilitychange', onVisible);
        playing = true;
      } catch {
        // Music is a nicety: no audio, no music.
      }
    },
    setMood(m) {
      next = m;
    },
    stop() {
      if (!playing) return;
      playing = false;
      if (timer) clearInterval(timer);
      timer = null;
      document.removeEventListener('visibilitychange', onVisible);
      const c = ctx;
      const g = master;
      master = null;
      if (c && g) {
        g.gain.cancelScheduledValues(c.currentTime);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.6);
        setTimeout(() => g.disconnect(), 800);
      }
    },
  };
}

function browserContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

let shared: MusicEngine | null = null;
/** The tab-wide music player. */
export function musicEngine(): MusicEngine {
  return (shared ??= createMusic());
}
