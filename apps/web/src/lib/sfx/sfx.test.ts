import { describe, expect, it, vi } from 'vitest';
import { CUES, createSfx } from './index';

function fakeContext() {
  const oscillators: { type: string; start: number; stop: number }[] = [];
  const gains: { gain: { setValueAtTime: ReturnType<typeof vi.fn> } }[] = [];
  const panners: { pan: { value: number } }[] = [];
  const param = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const ctx = {
    currentTime: 10,
    state: 'suspended' as AudioContextState,
    destination: {} as AudioDestinationNode,
    resume: vi.fn(async () => undefined),
    createGain: () => {
      const g = { gain: param(), connect: (n: unknown) => n };
      gains.push(g);
      return g;
    },
    createStereoPanner: () => {
      const p = { pan: { value: 0 }, connect: (n: unknown) => n };
      panners.push(p);
      return p;
    },
    createOscillator: () => {
      const o = {
        type: 'sine',
        frequency: param(),
        connect: (n: unknown) => n,
        start: (t: number) => oscillators.push({ type: o.type, start: t, stop: NaN }),
        stop: (t: number) => (oscillators[oscillators.length - 1]!.stop = t),
      };
      return o;
    },
  };
  return { ctx, oscillators, gains, panners };
}

describe('sfx', () => {
  it('creates the context on first play, resumes it, and schedules every tone of the cue', () => {
    const { ctx, oscillators } = fakeContext();
    const make = vi.fn(() => ctx as never);
    const sfx = createSfx(make);
    expect(make).not.toHaveBeenCalled();
    sfx.play('click');
    sfx.play('good');
    expect(make).toHaveBeenCalledTimes(1);
    expect(ctx.resume).toHaveBeenCalled();
    expect(oscillators).toHaveLength(CUES.click.length + CUES.good.length);
    expect(oscillators[1]).toMatchObject({ type: 'triangle', start: 10.05 });
  });

  it('places an agent sound: panned to its side and quieter with distance; unplaced plays centred', () => {
    const { ctx, gains, panners } = fakeContext();
    const sfx = createSfx(() => ctx as never);
    sfx.agent!({ kind: 'step', pitch: 1 });
    expect(panners).toHaveLength(0);
    const full = gains[0]!.gain.setValueAtTime.mock.calls[0]![0] as number;
    sfx.agent!({ kind: 'step', pitch: 1 }, { pan: -2, gain: 0.5 });
    expect(panners).toHaveLength(1);
    expect(panners[0]!.pan.value).toBe(-1);
    expect(gains[1]!.gain.setValueAtTime.mock.calls[0]![0]).toBeCloseTo(full * 0.5);
    // Too far to hear: nothing scheduled.
    sfx.agent!({ kind: 'step', pitch: 1 }, { pan: 0, gain: 0 });
    expect(gains).toHaveLength(2);
    sfx.play('visorOn');
    expect(gains).toHaveLength(2 + CUES.visorOn.length);
  });

  it('stays silent without audio support or when the context throws', () => {
    expect(() => createSfx(() => null).play('wipe')).not.toThrow();
    expect(() =>
      createSfx(() => {
        throw new Error('blocked');
      }).play('wipe'),
    ).not.toThrow();
  });
});
