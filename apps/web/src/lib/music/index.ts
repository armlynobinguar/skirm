'use client';
// Background music: an original track synthesized live with Web Audio (no audio files to load or
// license), in two moods. The menus play a calm A-minor song (pad, bass, a slow arpeggio and a
// lead tune); a match plays a faster, tenser one (pulsing bass, a 16th arpeggio, a driving lead,
// kick, snare and hats, with a fill every 8 bars). Each song is 8 chords long and runs a 32-bar
// arrangement (intro, groove, hook, breakdown) so the layers come and go instead of one loop
// repeating. A small mix bus adds a plate-style reverb, a dotted-8th echo, kick ducking on the
// pad and bass, a little stereo and a glue compressor. A mood change lands on the next bar and
// starts the new song from its top. Browsers only allow audio after a user gesture, so the player
// starts on the first click or key press (MusicPlayer); the "Music" toggle in the top bar turns
// it off.
//
//   const m = musicEngine();
//   m.start('menu');  m.setMood('match');  m.stop();

export type MusicMood = 'menu' | 'match';

/** One lead note: the 16th step within the bar it starts on, its MIDI note and length in 16ths. */
export type LeadNote = readonly [step: number, midi: number, len: number];

interface Song {
  bpm: number;
  /** One chord a bar: root (MIDI) and its triad as semitones above it. */
  bars: readonly (readonly [number, readonly number[]])[];
  /** The lead tune, one list of notes per bar (as long as `bars`). */
  lead: readonly (readonly LeadNote[])[];
  /** Arpeggio notes per beat (2: 8ths, 4: 16ths). */
  arp: number;
  /** Bass hits per beat. */
  bass: number;
  drums: boolean;
}

/** The two moods, both in A minor; the match leans on iv and a major V for tension. */
export const SONGS: Record<MusicMood, Song> = {
  menu: {
    bpm: 84,
    bars: [
      [45, [0, 3, 7]], // Am
      [41, [0, 4, 7]], // F
      [48, [0, 4, 7]], // C
      [43, [0, 4, 7]], // G
      [45, [0, 3, 7]], // Am
      [41, [0, 4, 7]], // F
      [50, [0, 3, 7]], // Dm
      [40, [0, 4, 7]], // E
    ],
    lead: [
      [[0, 76, 6], [6, 72, 2], [8, 74, 4], [12, 76, 4]],
      [[0, 77, 8], [8, 76, 4], [12, 72, 4]],
      [[0, 79, 6], [6, 76, 2], [8, 74, 4], [12, 72, 4]],
      [[0, 74, 12], [12, 71, 4]],
      [[0, 76, 4], [4, 81, 4], [8, 79, 4], [12, 76, 4]],
      [[0, 77, 6], [6, 76, 2], [8, 72, 8]],
      [[0, 74, 4], [4, 77, 4], [8, 81, 4], [12, 77, 4]],
      [[0, 80, 8], [8, 76, 8]],
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
      [45, [0, 3, 7]], // Am
      [41, [0, 4, 7]], // F
      [43, [0, 4, 7]], // G
      [40, [0, 4, 7]], // E
    ],
    lead: [
      [[0, 69, 2], [3, 69, 1], [4, 72, 2], [6, 76, 2], [8, 74, 2], [10, 72, 2], [12, 76, 4]],
      [[0, 77, 3], [3, 76, 1], [4, 74, 4], [8, 69, 4], [12, 74, 4]],
      [[0, 72, 2], [2, 77, 2], [4, 81, 4], [8, 79, 2], [10, 77, 2], [12, 76, 4]],
      [[0, 80, 6], [6, 76, 2], [8, 71, 4], [12, 68, 4]],
      [[0, 81, 2], [3, 81, 1], [4, 79, 2], [6, 76, 2], [8, 72, 4], [12, 76, 4]],
      [[0, 77, 4], [4, 81, 4], [8, 84, 8]],
      [[0, 83, 4], [4, 79, 4], [8, 74, 4], [12, 71, 4]],
      [[0, 76, 2], [2, 80, 2], [4, 83, 4], [8, 80, 8]],
    ],
    arp: 4,
    bass: 2,
    drums: true,
  },
};

/** What plays in a bar of the 32-bar arrangement (pure, for the tests). */
export interface Layers {
  pad: boolean;
  arp: boolean;
  bass: boolean;
  lead: boolean;
  kick: boolean;
  snare: boolean;
  hats: boolean;
  /** A snare roll on the last beat (the 8th bar of a section, before the next one comes in). */
  fill: boolean;
}

/** The layers for bar `bar` (counted from the song's top) of a mood. */
export function layers(mood: MusicMood, bar: number): Layers {
  const section = Math.floor(bar / 8) % 4; // 0 intro, 1 groove, 2 hook, 3 breakdown
  const last = bar % 8 === 7;
  if (mood === 'menu') {
    return {
      pad: true,
      arp: section !== 3,
      bass: section === 1 || section === 2,
      lead: section >= 2,
      kick: false,
      snare: false,
      hats: false,
      fill: false,
    };
  }
  return {
    pad: true,
    arp: true,
    bass: section !== 3,
    lead: section >= 2,
    kick: true,
    snare: section === 1 || section === 2,
    hats: section !== 3,
    fill: last && section !== 2,
  };
}

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

/** The mix: where each voice goes. */
interface Bus {
  /** Straight to the compressor. */
  dry: GainNode;
  /** Pad and bass: ducked on each kick. */
  duck: GainNode;
  reverb: GainNode;
  delay: GainNode;
  echo: DelayNode;
  /** Everything to disconnect on stop. */
  nodes: AudioNode[];
}

interface Voice {
  f: number;
  t: number;
  d: number;
  type: OscillatorType;
  g: number;
  cutoff?: number;
  attack?: number;
  /** -1 (left) to 1 (right). */
  pan?: number;
  /** Where the dry signal goes (default: the dry bus). */
  to?: AudioNode;
  reverb?: number;
  delay?: number;
}

export function createMusic(makeContext: () => AudioContext | null = browserContext): MusicEngine {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let bus: Bus | null = null;
  let noise: AudioBuffer | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let mood: MusicMood = 'menu';
  let next: MusicMood = 'menu';
  let step = 0; // 16th notes since the start
  let songStart = 0; // the step the current song started on
  let at = 0; // audio time of the next 16th
  let playing = false;
  const onVisible = () => {
    if (!ctx) return;
    if (document.visibilityState === 'visible') void ctx.resume();
    else void ctx.suspend();
  };

  /** A decaying stereo noise burst: the reverb's impulse response. */
  const impulse = (c: AudioContext, seconds: number): AudioBuffer => {
    const len = Math.ceil(c.sampleRate * seconds);
    const b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    return b;
  };

  const buildBus = (c: AudioContext, out: AudioNode): Bus => {
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.2;
    comp.connect(out);
    const dry = c.createGain();
    dry.connect(comp);
    const duck = c.createGain();
    duck.connect(comp);
    const reverb = c.createGain();
    const conv = c.createConvolver();
    conv.buffer = impulse(c, 2.4);
    const wet = c.createGain();
    wet.gain.value = 0.5;
    reverb.connect(conv).connect(wet).connect(comp);
    const delay = c.createGain();
    const echo = c.createDelay(2);
    const feedback = c.createGain();
    feedback.gain.value = 0.3;
    const tone = c.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    delay.connect(echo);
    echo.connect(tone).connect(feedback).connect(echo);
    tone.connect(comp);
    return { dry, duck, reverb, delay, echo, nodes: [comp, dry, duck, reverb, conv, wet, delay, echo, feedback, tone] };
  };

  const voice = ({ f, t, d, type, g, cutoff, attack = 0.01, pan, to, reverb = 0, delay = 0 }: Voice) => {
    if (!ctx || !bus) return;
    const o = ctx.createOscillator();
    const v = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    v.gain.setValueAtTime(0.0001, t);
    v.gain.exponentialRampToValueAtTime(g, t + attack);
    v.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(v);
    let out: AudioNode = v;
    if (cutoff) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cutoff;
      out = out.connect(lp);
    }
    if (pan && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      out = out.connect(p);
    }
    out.connect(to ?? bus.dry);
    if (reverb) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      out.connect(s).connect(bus.reverb);
    }
    if (delay) {
      const s = ctx.createGain();
      s.gain.value = delay;
      out.connect(s).connect(bus.delay);
    }
    o.start(t);
    o.stop(t + d + 0.05);
  };

  const kick = (t: number) => {
    if (!ctx || !bus) return;
    const o = ctx.createOscillator();
    const v = ctx.createGain();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
    // 0.3: at 0.5 the kick alone was louder than the menu song and set the match song's peak.
    v.gain.setValueAtTime(0.3, t);
    v.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(v).connect(bus.dry);
    o.start(t);
    o.stop(t + 0.25);
    // Duck the pad and bass under the kick so it punches through without being louder.
    bus.duck.gain.setValueAtTime(0.55, t);
    bus.duck.gain.linearRampToValueAtTime(1, t + 0.2);
  };

  const noiseHit = (t: number, g: number, d: number, type: BiquadFilterType, freq: number, pan = 0, reverb = 0) => {
    if (!ctx || !bus || !noise) return;
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const v = ctx.createGain();
    v.gain.setValueAtTime(g, t);
    v.gain.exponentialRampToValueAtTime(0.0001, t + d);
    let out: AudioNode = s.connect(f).connect(v);
    if (pan && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      out = out.connect(p);
    }
    out.connect(bus.dry);
    if (reverb) {
      const r = ctx.createGain();
      r.gain.value = reverb;
      out.connect(r).connect(bus.reverb);
    }
    s.start(t);
    s.stop(t + d + 0.02);
  };

  const hat = (t: number, g: number) => noiseHit(t, g, 0.04, 'highpass', 7000, 0.25);
  const snare = (t: number, g = 0.16) => {
    noiseHit(t, g, 0.16, 'bandpass', 1900, 0, 0.3);
    voice({ f: 190, t, d: 0.09, type: 'triangle', g: g * 0.6 });
  };

  /** Schedules the 16th at `t` (step `i` since the start). */
  const schedule = (i: number, t: number) => {
    // Mood changes land on a bar line, and the new song starts from its top.
    if (i % 16 === 0 && next !== mood) {
      mood = next;
      songStart = i;
    }
    const song = SONGS[mood];
    const sixteenth = 60 / song.bpm / 4;
    const songBar = Math.floor((i - songStart) / 16);
    const bar = songBar % song.bars.length;
    const [root, triad] = song.bars[bar]!;
    const inBar = i % 16;
    const on = layers(mood, songBar);
    if (inBar === 0) {
      // Echo on a dotted 8th of this song's tempo.
      bus?.echo.delayTime.setValueAtTime(sixteenth * 3, t);
      if (on.pad) {
        // Pad: the chord an octave up, slow attack, the whole bar, spread a little left and right.
        for (const s of triad) {
          const f = hz(root + 12 + s);
          voice({ f: f * 0.997, t, d: sixteenth * 16, type: 'sawtooth', g: 0.05, cutoff: 900, attack: 0.5, pan: -0.3, to: bus?.duck, reverb: 0.35 });
          voice({ f: f * 1.003, t, d: sixteenth * 16, type: 'sawtooth', g: 0.05, cutoff: 900, attack: 0.5, pan: 0.3, to: bus?.duck, reverb: 0.35 });
        }
      }
    }
    const bassEvery = Math.round(4 / song.bass);
    if (on.bass && inBar % bassEvery === 0) {
      const match = mood === 'match';
      voice({ f: hz(root), t, d: sixteenth * bassEvery * 0.9, type: match ? 'sawtooth' : 'triangle', g: 0.22, cutoff: match ? 500 : undefined, to: bus?.duck });
    }
    const arpEvery = 4 / song.arp;
    if (on.arp && inBar % arpEvery === 0) {
      const k = inBar / arpEvery;
      voice({ f: hz(arpNote(root, triad, k)), t, d: sixteenth * arpEvery * 1.6, type: 'triangle', g: 0.06, cutoff: 2600, pan: k % 2 ? 0.35 : -0.35, delay: 0.28 });
    }
    if (on.lead) {
      for (const [s, midi, len] of song.lead[bar] ?? []) {
        if (s !== inBar) continue;
        const d = sixteenth * len;
        if (mood === 'match') {
          voice({ f: hz(midi) * 0.996, t, d, type: 'square', g: 0.028, cutoff: 1900, attack: 0.008, pan: -0.1, reverb: 0.2, delay: 0.22 });
          voice({ f: hz(midi) * 1.004, t, d, type: 'square', g: 0.028, cutoff: 1900, attack: 0.008, pan: 0.1, reverb: 0.2, delay: 0.22 });
        } else {
          voice({ f: hz(midi), t, d: d * 1.1, type: 'sine', g: 0.07, attack: 0.04, reverb: 0.45, delay: 0.25 });
          voice({ f: hz(midi + 12), t, d: d * 0.8, type: 'triangle', g: 0.015, cutoff: 3200, attack: 0.04, reverb: 0.45 });
        }
      }
    }
    if (song.drums) {
      const fill = on.fill && inBar >= 12;
      if (on.kick && (inBar === 0 || inBar === 8 || (on.snare && inBar === 10))) kick(t);
      if (on.snare && !fill && (inBar === 4 || inBar === 12)) snare(t);
      if (fill) snare(t, 0.06 + (inBar - 12) * 0.03);
      if (on.hats) {
        if (inBar % 4 === 2) hat(t, 0.08);
        else if (inBar % 2 === 1) hat(t, 0.03);
      }
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
        bus = buildBus(ctx, master);
        if (!noise) {
          noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.3), ctx.sampleRate);
          const d = noise.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        mood = m;
        step = 0;
        songStart = 0;
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
      const b = bus;
      master = null;
      bus = null;
      if (c && g) {
        g.gain.cancelScheduledValues(c.currentTime);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.6);
        setTimeout(() => {
          g.disconnect();
          // The echo's feedback loop would keep itself alive: cut every bus node.
          for (const n of b?.nodes ?? []) n.disconnect();
        }, 800);
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
