import {
  BLUFF_AVOID_TICKS,
  type FrameAgent,
  type MatchEvent,
  type Team,
  type V2Frame,
} from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { v2FrameFixture } from '@/test/fixtures';
import { linesOf, type V2CommsLine } from '../v2/v2Store';
import { subtitlesFor, inFilter } from '../v2/hud/model';
import { EMOTE_MS, drawEmotes, emoteAnim, emotesOf, liveEmotesOf, pendingBluffs } from './emotes';
import { composeV2Arena } from './live';

const ag = (
  id: string,
  team: Team,
  x: number,
  y: number,
  o: Partial<FrameAgent> = {},
): FrameAgent => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  team,
  role: 'Builder',
  x,
  y,
  items: [],
  delivered: 0,
  down: false,
  out: false,
  tier: 'standard',
  ...o,
});

const WICK = ag('wick', 'A', 3, 3);
const MOSS = ag('moss', 'A', 5, 3);
const WREN = ag('wren', 'B', 4, 3);

function frame(
  tick: number,
  events: MatchEvent[],
  agents: FrameAgent[] = [WICK, MOSS, WREN],
  o: Partial<V2Frame> = {},
): V2Frame {
  return v2FrameFixture({ tick, events, agents, comms: [], ...o });
}

const kinds = (f: V2Frame, prev: V2Frame | null = null) =>
  emotesOf(f, prev).map((e) => `${e.agent}:${e.kind}`);

describe('emotes from frame events', () => {
  it('delivering shows "+N", knocked down and swept out show on the agent', () => {
    const f = frame(5, [
      { kind: 'delivered', agent: 'wick', team: 'A', count: 2, score: 2 },
      { kind: 'knocked_down', agent: 'moss', by: 'water', dropped: 1 },
    ]);
    const em = emotesOf(f, null);
    expect(em.map((e) => [e.agent, e.kind, e.glyph])).toEqual([
      ['wick', 'delivered', '+2'],
      ['moss', 'knocked', 'x_x'],
    ]);
    expect(em[1]!.text).toBe('Knocked down by the water, dropped 1');
    expect(kinds(frame(5, [{ kind: 'eliminated', agent: 'wren', by: 'lava' }]))).toEqual([
      'wren:out',
    ]);
  });

  it('a stun shows on the stunned agent and as "saved" on the stunner\'s teammates close by', () => {
    // Moss stuns Wren right next to Wick: Wick was saved.
    const f = frame(6, [{ kind: 'stunned', agent: 'wren', by: 'moss' }]);
    const em = emotesOf(f, null);
    expect(em.map((e) => `${e.agent}:${e.kind}`)).toEqual(['wren:stunned', 'wick:saved']);
    expect(em[0]!.text).toBe('Stunned by Moss');
    expect(em[1]!.text).toBe('Saved by Moss: Wren stunned');
    // A teammate far away was not saved.
    expect(
      kinds(
        frame(
          6,
          [{ kind: 'stunned', agent: 'wren', by: 'moss' }],
          [ag('wick', 'A', 20, 9), MOSS, WREN],
        ),
      ),
    ).toEqual(['wren:stunned']);
  });

  it('putting a fire out shows on the firefighter and saves a teammate next to the fire', () => {
    const f = frame(7, [
      { kind: 'verb', agent: 'moss', verb: 'douse', effect: 'extinguish', at: [4, 4] },
    ]);
    expect(kinds(f)).toEqual(['moss:extinguished', 'wick:saved']);
    // Other verbs are not reactions.
    expect(
      kinds(
        frame(7, [
          { kind: 'verb', agent: 'moss', verb: 'dig', effect: 'remove_solid', at: [4, 4] },
        ]),
      ),
    ).toEqual([]);
  });

  it('a contested pickup of a middle item or drop is a race won and lost; an uncontested one is nothing', () => {
    const pick: MatchEvent = {
      kind: 'picked',
      agent: 'wick',
      at: [4, 4],
      stolen: false,
      origin: 'middle',
    };
    const em = emotesOf(frame(8, [pick]), null);
    expect(em.map((e) => `${e.agent}:${e.kind}`)).toEqual(['wick:won_race', 'wren:lost_race']);
    expect(em[0]!.text).toMatch(/^Won the race to the middle /);
    expect(em[1]!.text).toMatch(/to Wick$/);
    const far = [WICK, MOSS, ag('wren', 'B', 15, 8)];
    expect(kinds(frame(8, [pick], far))).toEqual([]);
    // The rival was close last tick (it was racing) even if it stepped away now.
    expect(kinds(frame(8, [pick], far), frame(7, [], [WICK, MOSS, ag('wren', 'B', 5, 4)]))).toEqual(
      ['wick:won_race', 'wren:lost_race'],
    );
    // A drop: same, named as the supply drop. Own-half items are no race.
    expect(emotesOf(frame(8, [{ ...pick, origin: 'drop' }]), null)[0]!.text).toBe(
      'Won the race to the supply drop',
    );
    expect(kinds(frame(8, [{ ...pick, origin: 'own' }]))).toEqual([]);
  });

  it('a landed bluff is a smirk on the liar; a doubted one shows on its target', () => {
    expect(
      kinds(
        frame(9, [{ kind: 'bluff', agent: 'wren', victim: 'wick', at: [6, 2], believed: true }]),
      ),
    ).toEqual(['wren:bluffed']);
    expect(
      kinds(
        frame(9, [{ kind: 'bluff', agent: 'wren', victim: 'wick', at: [6, 2], believed: false }]),
      ),
    ).toEqual(['wick:not_fooled']);
  });

  it('one emote per agent per tick: the strongest', () => {
    const f = frame(10, [
      { kind: 'delivered', agent: 'wick', team: 'A', count: 1, score: 1 },
      { kind: 'knocked_down', agent: 'wick', by: 'fire', dropped: 0 },
    ]);
    expect(kinds(f)).toEqual(['wick:knocked']);
  });
});

describe('fog of war', () => {
  it('a rival out of sight never gets an emote, and its name never leaks', () => {
    // Crew A's frame without Wren in sight: Wren's bluff on Wick landed (the engine tells A), but no smirk, no name.
    const blind = [WICK, MOSS];
    expect(
      kinds(
        frame(
          9,
          [{ kind: 'bluff', agent: 'wren', victim: 'wick', at: [6, 2], believed: true }],
          blind,
        ),
      ),
    ).toEqual([]);
    const seen = emotesOf(
      frame(
        9,
        [{ kind: 'bluff', agent: 'wren', victim: 'wick', at: [6, 2], believed: false }],
        blind,
      ),
      null,
    );
    expect(seen.map((e) => `${e.agent}:${e.kind}`)).toEqual(['wick:not_fooled']);
    expect(seen[0]!.text).toBe('Saw through a bluff');
    // Stunned by a rival out of sight: "a rival", and nobody is "saved" by an unseen stunner.
    const st = emotesOf(frame(6, [{ kind: 'stunned', agent: 'wick', by: 'wren' }], blind), null);
    expect(st.map((e) => e.text)).toEqual(['Stunned by a rival']);
  });

  it('the arena draws no emote for a rival on a tile this crew cannot see', () => {
    const f = frame(5, [{ kind: 'delivered', agent: 'wick', team: 'A', count: 1, score: 1 }]);
    const arena = composeV2Arena(f)!;
    const calls: string[] = [];
    const ctx = fakeCtx(calls);
    const now = 1_000_000;
    const emotes = [
      {
        id: '5|wick|delivered',
        agent: 'wick',
        team: 'A' as const,
        tick: 5,
        glyph: '+1',
        label: 'Delivered',
      },
      {
        id: '5|wren|stunned',
        agent: 'wren',
        team: 'B' as const,
        tick: 5,
        glyph: '@_@',
        label: 'Stunned',
      },
    ];
    const vis = new Array(arena.A.w * arena.A.h).fill(true);
    vis[WREN.y * arena.A.w + WREN.x] = false;
    drawEmotes(
      ctx,
      [],
      { ...arena, emotes, vis, team: 'A' },
      { T: 40, ox: 0, oy: 0, now, still: false },
    );
    expect(calls).toContain('+1');
    expect(calls).not.toContain('@_@');
    // In sight, it draws.
    calls.length = 0;
    drawEmotes(
      ctx,
      [],
      { ...arena, emotes: [{ ...emotes[1]!, id: 'x' }], vis: null, team: 'A' },
      { T: 40, ox: 0, oy: 0, now, still: false },
    );
    expect(calls).toContain('@_@');
  });
});

describe('fooled by a bluff', () => {
  it('waits on the landed bluff and shows "?!" when the item turns out to be there', () => {
    const bluff = frame(10, [
      { kind: 'bluff', agent: 'wren', victim: 'wick', at: [6, 2], believed: true },
    ]);
    let history: V2CommsLine[] = linesOf(bluff, null);
    const reply = history.find((l) => l.bluffReply)!;
    expect(reply).toMatchObject({ from: 'wick', bluff: 'landed', at: [6, 2] });
    expect(pendingBluffs(history, 11)).toEqual([{ victim: 'wick', at: [6, 2], tick: 10 }]);
    // Nothing yet a tick later.
    const quiet = frame(11, []);
    history = [...history, ...linesOf(quiet, bluff, history)];
    expect(history.some((l) => l.emote === 'fooled')).toBe(false);
    // Someone picks the item up: Wick finds out.
    const taken = frame(13, [
      { kind: 'picked', agent: 'moss', at: [6, 2], stolen: false, origin: 'own' },
    ]);
    const lines = linesOf(taken, quiet, history);
    const fooled = lines.find((l) => l.emote === 'fooled')!;
    expect(fooled).toMatchObject({ from: 'wick', channel: 'emote', glyph: '?!' });
    expect(fooled.text).toMatch(/^\?! Fooled: the .+ was there all along$/);
    // Once found out, it no longer waits.
    expect(pendingBluffs([...history, ...lines], 14)).toEqual([]);
  });

  it('also when the lie wears off and the item still lies there in sight', () => {
    const p = [{ victim: 'wick', at: [6, 2] as [number, number], tick: 10 }];
    const rows = (ch: string) => {
      const r = v2FrameFixture().rows.slice();
      r[2] = r[2]!.slice(0, 6) + ch + r[2]!.slice(7);
      return r;
    };
    expect(
      emotesOf(frame(10 + BLUFF_AVOID_TICKS - 1, [], undefined, { rows: rows('*') }), null, p),
    ).toEqual([]);
    expect(
      emotesOf(frame(10 + BLUFF_AVOID_TICKS, [], undefined, { rows: rows('*') }), null, p).map(
        (e) => e.kind,
      ),
    ).toEqual(['fooled']);
    // Not when the tile is fogged or empty, nor when the fooled agent is out of sight.
    expect(
      emotesOf(frame(10 + BLUFF_AVOID_TICKS, [], undefined, { rows: rows('?') }), null, p),
    ).toEqual([]);
    expect(
      emotesOf(frame(10 + BLUFF_AVOID_TICKS, [], [MOSS, WREN], { rows: rows('*') }), null, p),
    ).toEqual([]);
    // Past its window it is dropped.
    expect(
      pendingBluffs(
        [{ tick: 10, from: 'wick', channel: 'say', bluff: 'landed', bluffReply: true, at: [6, 2] }],
        10 + BLUFF_AVOID_TICKS + 9,
      ),
    ).toEqual([]);
  });
});

describe('feed and arena', () => {
  it('emote lines join the feed (All and Say), third person subtitles, and the arena for two ticks', () => {
    const f = frame(5, [{ kind: 'delivered', agent: 'wick', team: 'A', count: 1, score: 1 }]);
    const lines = linesOf(f, null);
    const em = lines.find((l) => l.channel === 'emote')!;
    expect(em).toMatchObject({
      from: 'wick',
      fromName: 'Wick',
      team: 'A',
      emote: 'delivered',
      glyph: '+1',
    });
    expect(inFilter(em, 'A', 'all')).toBe(true);
    expect(inFilter(em, 'A', 'say')).toBe(true);
    expect(inFilter(em, 'A', 'team')).toBe(false);
    expect(subtitlesFor(lines, WICK, 'A', false).map((s) => s.text)).toContain(em.text);
    expect(liveEmotesOf(lines, 5)).toEqual([
      {
        id: '5|wick|delivered',
        agent: 'wick',
        team: 'A',
        tick: 5,
        glyph: '+1',
        label: 'Delivered',
      },
    ]);
    expect(liveEmotesOf(lines, 6)).toHaveLength(1);
    expect(liveEmotesOf(lines, 7)).toEqual([]);
  });

  it('pops in, holds and fades out over EMOTE_MS; reduced motion holds still', () => {
    expect(emoteAnim(0, false)!.alpha).toBe(0);
    expect(emoteAnim(EMOTE_MS / 2, false)!.alpha).toBe(1);
    expect(emoteAnim(EMOTE_MS, false)).toBeNull();
    expect(emoteAnim(99_999, true)).toEqual({ alpha: 1, scale: 1, rise: 0 });
  });

  it('stacks clear of the name tag and of a speech bubble already drawn', () => {
    const f = frame(5, []);
    const arena = composeV2Arena(f)!;
    const at: number[] = [];
    const ctx = fakeCtx([], at);
    const item = {
      agent: { id: 'wick', name: 'Wick', team: 'A' },
      sx: 200,
      sy: 300,
      hop: 0,
      af: 1,
    };
    const T = 40;
    const tagTop = 300 - T * 1.05 - Math.max(10, T * 0.2);
    const bubble = [150, tagTop - 50, 250, tagTop - 4];
    const draw = (placed: number[][]) =>
      drawEmotes(
        ctx,
        [item],
        {
          ...arena,
          emotes: [
            { id: 's|wick', agent: 'wick', team: 'A', tick: 5, glyph: '+1', label: 'Delivered' },
          ],
        },
        { T, ox: 0, oy: 0, now: 5_000_000, still: true, placed },
      );
    // The pill is 1.5 × the bubble font tall and its glyph sits on its middle line.
    const half = (Math.max(11, T * 0.2) * 1.5) / 2;
    draw([]);
    expect(at[0]! + half).toBeLessThanOrEqual(tagTop);
    at.length = 0;
    draw([bubble]);
    const [top, bottom] = [at[0]! - half, at[0]! + half];
    expect(bottom <= bubble[1]! || top >= bubble[3]!).toBe(true);
    expect(bottom).toBeLessThanOrEqual(tagTop);
  });
});

/** A canvas context that records the text it fills (and, in `ys`, the y it fills it at). */
function fakeCtx(texts: string[], ys: number[] = []): CanvasRenderingContext2D {
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    measureText: (s: string) => ({ width: s.length * 8 }),
    fillText: (s: string, _x: number, y: number) => {
      texts.push(s);
      ys.push(y);
    },
    beginPath: () => {},
    moveTo: () => {},
    arcTo: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
  };
  return ctx as unknown as CanvasRenderingContext2D;
}
