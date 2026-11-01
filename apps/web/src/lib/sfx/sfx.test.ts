import { describe, expect, it, vi } from 'vitest';
import { CUES, createSfx } from './index';

function fakeContext() {
  const oscillators: { type: string; start: number; stop: number }[] = [];
  const param = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const ctx = {
    currentTime: 10,
    state: 'suspended' as AudioContextState,
    destination: {} as AudioDestinationNode,
    resume: vi.fn(async () => undefined),
    createGain: () => ({ gain: param(), connect: (n: unknown) => n }),
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
  return { ctx, oscillators };
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

  it('stays silent without audio support or when the context throws', () => {
    expect(() => createSfx(() => null).play('wipe')).not.toThrow();
    expect(() =>
      createSfx(() => {
        throw new Error('blocked');
      }).play('wipe'),
    ).not.toThrow();
  });
});
