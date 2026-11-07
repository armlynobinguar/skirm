import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { arenaStore } from '@/features/arena/store';
import type { ReplayHighlight } from '@/lib/api/types';
import type { V2Frame } from '@/lib/realtime/protocol';
import { FakeRealtime } from '@/test/fakeRealtime';
import { v2DebriefFixture, v2FrameFixture, v2MatchRecordFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { V2ResultScreen } from '../v2/Ended';
import { CLIP_BEAT_MS, CLIP_HOLD_MS, CLIP_MS, clipCaption, clipDurations, clipFocus, clipWindow, momentOfHighlight, momentsOfFrames, pickClipMoment } from './clip';

afterEach(() => arenaStore().setLive(null));

const hl = (o: Partial<ReplayHighlight> = {}): ReplayHighlight => ({
  id: 'goal-30',
  kind: 'goal',
  tick: 30,
  start: 24,
  end: 30,
  team: 'A',
  title: 'Wick delivers the goal',
  facts: 'Wick of ada delivers an item and wins the match.',
  weight: 10,
  score: { A: 4, B: 2 },
  line: 'Wick slams it home!',
  ...o,
});

type Ev = V2Frame['events'][number];
/** A match of `n` ticks seen by `view`; on `seen` ticks the rival (Wren) is in sight. */
const frames = (n: number, view: V2Frame['view'] = 'A', events: Record<number, Ev[]> = {}, seen: number[] = []) =>
  Array.from({ length: n }, (_, tick) =>
    v2FrameFixture({ tick, events: events[tick] ?? [], ...(seen.includes(tick) ? { agents: v2FrameFixture({}, 'watch').agents } : {}) }, view),
  );
const bluff = (o: Partial<Extract<Ev, { kind: 'bluff' }>> = {}): Ev => ({ kind: 'bluff', agent: 'wick', victim: 'wren', at: [3, 4], believed: true, ...o });
const steal = (agent = 'wick'): Ev => ({ kind: 'picked', agent, at: [5, 5], stolen: true, origin: 'stolen' });

describe('clip window', () => {
  const ticks = (n: number) => Array.from({ length: n }, (_, tick) => ({ tick }));

  it('spans the lead before the moment and the tail after it', () => {
    expect(clipWindow(ticks(40), 20)).toEqual({ from: 15, to: 23, moment: 20 });
  });

  it('slides at either end of the match to keep its length', () => {
    expect(clipWindow(ticks(40), 1)).toEqual({ from: 0, to: 8, moment: 1 });
    expect(clipWindow(ticks(40), 39)).toEqual({ from: 31, to: 39, moment: 39 });
  });

  it('fits a match shorter than the clip, and a tick past the frames', () => {
    expect(clipWindow(ticks(4), 2)).toEqual({ from: 0, to: 3, moment: 2 });
    expect(clipWindow(ticks(10), 99)).toEqual({ from: 1, to: 9, moment: 9 });
    expect(clipWindow([], 3)).toBeNull();
  });

  it('finds the moment among sparse ticks', () => {
    expect(clipWindow([{ tick: 2 }, { tick: 5 }, { tick: 9 }], 4)!.moment).toBe(1);
  });
});

describe('clip durations', () => {
  it('takes about six seconds, with a beat on the moment and a hold at the end', () => {
    const d = clipDurations(9, 5);
    const total = d.reduce((n, x) => n + x, 0);
    expect(Math.abs(total - CLIP_MS)).toBeLessThanOrEqual(9);
    expect(d[5]! - d[0]!).toBe(CLIP_BEAT_MS);
    expect(d[8]! - d[0]!).toBe(CLIP_HOLD_MS);
  });

  it('keeps each frame readable on a very short or long clip', () => {
    expect(clipDurations(2, 0)[1]).toBe(1100 + CLIP_HOLD_MS);
    expect(clipDurations(60, 30)[0]).toBe(280);
    expect(clipDurations(0, 0)).toEqual([]);
  });
});

describe('clip moment', () => {
  it('captions an api highlight', () => {
    expect(clipCaption(momentOfHighlight(hl()))).toBe('Winning delivery · Wick delivers the goal');
    expect(clipCaption(momentOfHighlight(hl({ kind: 'lead_change', title: 'Comeback: ada takes the lead' })))).toBe('Comeback · ada takes the lead');
    expect(momentOfHighlight(hl()).line).toBe('Wick slams it home!');
  });

  it("reads a landed bluff from the crew's own frames, never a spectator's", () => {
    const own = momentsOfFrames(frames(20, 'A', { 8: [bluff()], 9: [bluff({ believed: false, agent: 'moss' })] }, [8]));
    expect(own).toHaveLength(1);
    expect(clipCaption(own[0]!)).toBe('Bluff · Wick fooled Wren');
    expect(own[0]).toMatchObject({ tick: 8, team: 'A', agent: 'wick' });
    expect(momentsOfFrames(frames(20, 'watch', { 8: [bluff()] }))).toEqual([]);
    // A rival never seen keeps its name to itself.
    expect(clipCaption(momentsOfFrames(frames(20, 'A', { 8: [bluff()] }))[0]!)).toBe('Bluff · Wick fooled a rival');
  });

  it('reads a steal, named for the robbed crew', () => {
    const [m] = momentsOfFrames(frames(20, 'watch', { 6: [steal()] }), { crews: { A: 'ada', B: 'ben' } });
    expect(clipCaption(m!)).toBe('Steal · Wick robs ben');
  });

  it("picks the heaviest moment, the viewer's crew on a tie, inside the frames", () => {
    const fs = frames(31, 'A', { 12: [bluff()] });
    // The winning goal (10) beats a bluff (8).
    expect(pickClipMoment([hl()], fs, { team: 'A' })!.kind).toBe('goal');
    // A plain delivery (5) does not.
    expect(pickClipMoment([hl({ weight: 5, title: 'Wick delivers' })], fs, { team: 'A' })!.kind).toBe('bluff');
    // A tie goes to the viewer's crew.
    const tie = [hl({ id: 'a', team: 'B', weight: 6, tick: 20 }), hl({ id: 'b', team: 'A', weight: 6, tick: 10 })];
    expect(pickClipMoment(tie, frames(31), { team: 'A' })!.id).toBe('b');
    // A highlight outside the frames this viewer has is skipped; nothing at all gives null.
    expect(pickClipMoment([hl({ tick: 99 })], frames(31))).toBeNull();
    expect(pickClipMoment([hl()], [])).toBeNull();
  });

  it("aims at the moment's agent, else its tile, else the crews' middle", () => {
    const f = v2FrameFixture({ tick: 3 }, 'watch');
    const wick = f.agents.find((a) => a.id === 'wick')!;
    expect(clipFocus(f, { agent: 'wick' })).toEqual({ x: wick.x, y: wick.y });
    expect(clipFocus(f, { agent: 'ghost', at: [7, 2] })).toEqual({ x: 7, y: 2 });
    const live = f.agents.filter((a) => !a.out);
    expect(clipFocus(f, {})!.x).toBeCloseTo(live.reduce((n, a) => n + a.x, 0) / live.length);
  });
});

describe('debrief highlight clip', () => {
  it('asks for the frames once kept, then plays the best moment with a link to the full replay', async () => {
    const rt = new FakeRealtime();
    renderWithProviders(<V2ResultScreen matchId="mat_v2" />, {
      handle: 'ada',
      path: '/matches/mat_v2/result',
      search: '',
      realtime: rt,
      api: {
        v2Match: async () => v2MatchRecordFixture({ debrief: v2DebriefFixture() }),
        v2Highlights: async () => ({ matchId: 'mat_v2', highlights: [hl({ weight: 5, title: 'Wick delivers' })], caster: 'model', framesKept: true }),
      },
    });
    await screen.findByTestId('v2-highlights');
    expect(screen.queryByTestId('v2-highlight-clip')).toBeNull();
    expect(rt.sent.filter((m) => m.type === 'v2_replay')).toEqual([{ type: 'v2_replay', matchId: 'mat_v2' }]);
    act(() => rt.emit({ type: 'v2_frames', matchId: 'mat_v2', frames: frames(31, 'A', { 12: [bluff()] }, [12]) }));
    const clip = await screen.findByTestId('v2-highlight-clip');
    expect(clip).toHaveAttribute('data-kind', 'bluff');
    expect(screen.getByTestId('v2-highlight-caption')).toHaveTextContent('Bluff · Wick fooled Wren');
    expect(screen.getByTestId('v2-clip-replay')).toHaveAttribute('href', '/matches/mat_v2#replay');
    expect(rt.sent.filter((m) => m.type === 'v2_replay')).toHaveLength(1);
  });

  it('stays out of the debrief when the frames are no longer kept', async () => {
    const rt = new FakeRealtime();
    renderWithProviders(<V2ResultScreen matchId="mat_v2" />, {
      handle: 'ada',
      path: '/matches/mat_v2/result',
      search: '',
      realtime: rt,
      api: {
        v2Match: async () => v2MatchRecordFixture({ debrief: v2DebriefFixture() }),
        v2Highlights: async () => ({ matchId: 'mat_v2', highlights: [hl()], caster: 'template', framesKept: false }),
      },
    });
    await screen.findByTestId('v2-highlights');
    expect(screen.queryByTestId('v2-highlight-clip')).toBeNull();
    expect(rt.sent.some((m) => m.type === 'v2_replay')).toBe(false);
  });
});
