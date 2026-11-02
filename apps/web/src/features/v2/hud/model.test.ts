import type { FrameAgent } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { v2DebriefFixture, v2FrameFixture, v2MatchRecordFixture } from '@/test/fixtures';
import { BLUFF_REPLY, linesOf, type V2CommsLine } from '../v2Store';
import { debriefOf, mvpOf } from './debrief';
import { calloutOf, clockLine, feedTag, goalTag, heardBy, inFilter, invChange, plural, slotsOf, subtitlesFor } from './model';

const line = (o: Partial<V2CommsLine>): V2CommsLine => ({ tick: 3, from: 'wick', fromName: 'Wick', team: 'A', channel: 'team', text: 'hi', overheard: false, ...o });
const agent = (o: Partial<FrameAgent> = {}): FrameAgent => ({
  id: 'wick',
  name: 'Wick',
  team: 'A',
  role: 'Builder',
  x: 1,
  y: 1,
  items: [],
  delivered: 0,
  down: false,
  out: false,
  tier: 'standard',
  ...o,
});

describe('clock line', () => {
  it('counts the next wave, the next supply drop and the head start from the frame', () => {
    const f = v2FrameFixture({ tick: 1 });
    // Copper Hollow floods every 4 ticks (Normal); crew A waits 5 ticks for the smaller rival crew.
    // The engine sends switchReady, and the one switch is ready from the start.
    expect(clockLine(f, 'A', 'normal', 2000)).toEqual({
      left: 298,
      hazards: [{ kind: 'Flood', receding: false, nextIn: 6 }],
      switches: { ready: 1, total: 1 },
      dropIn: 78,
      holding: 8,
    });
    // Easy slows the hazard (×1.6 → every 6 ticks); B never waits.
    expect(clockLine(f, 'B', 'easy', 2000)).toMatchObject({ hazards: [{ nextIn: 10 }], holding: 0 });
  });

  it('reads receding hazards and ready switches when the server sends them, and no drop after the last', () => {
    const f = v2FrameFixture({ tick: 50, hazards: [{ kind: 'water', waves: 7, receding: true }], switchReady: [26] });
    expect(clockLine(f, 'A', 'normal', 2000)).toMatchObject({ hazards: [{ receding: true }], switches: { ready: 1, total: 1 }, dropIn: null });
  });

  it('names the difficulty goal', () => {
    expect(goalTag('copper-hollow', 'normal')).toMatchObject({ name: 'Normal', title: 'Shore the tunnels' });
  });
});

describe('callouts and inventory', () => {
  it('calls out supply drops, verbs, stolen and middle pickups for the side that did them', () => {
    const f = v2FrameFixture();
    const wren = agent({ id: 'wren', name: 'Wren', team: 'B', role: 'Scout' });
    expect(calloutOf({ ...f, events: [{ kind: 'supply_drop', at: [20, 12] }] }, 'A')).toEqual({ text: 'Supply drop · middle', side: 'arena' });
    expect(calloutOf({ ...f, events: [{ kind: 'verb', agent: 'wick', verb: 'dig_rubble', effect: 'remove_solid', at: [2, 2] }] }, 'A')).toEqual({ text: 'Wick · Dig rubble', side: 'you' });
    expect(calloutOf({ ...f, agents: [...f.agents, wren], events: [{ kind: 'picked', agent: 'wren', at: [20, 4], stolen: false, origin: 'middle' }] }, 'A')).toEqual({
      text: 'Wren took a middle lamp oil',
      side: 'rival',
    });
    expect(calloutOf({ ...f, events: [{ kind: 'picked', agent: 'wick', at: [3, 4], stolen: true, origin: 'stolen' }] }, 'A')?.text).toBe('Wick stole a dropped lamp oil');
    expect(calloutOf({ ...f, events: [{ kind: 'picked', agent: 'wick', at: [3, 4], stolen: false, origin: 'own' }] }, 'A')).toBeNull();
  });

  it('calls out a bluff that landed for the liar, and one seen through for the target', () => {
    const f = v2FrameFixture();
    const wren = agent({ id: 'wren', name: 'Wren', team: 'B', role: 'Scout' });
    const withWren = { ...f, agents: [...f.agents, wren] };
    expect(calloutOf({ ...withWren, events: [{ kind: 'bluff', agent: 'wren', victim: 'wick', at: [20, 4], believed: true }] }, 'A')).toEqual({ text: "Wren's bluff landed", side: 'rival' });
    expect(calloutOf({ ...withWren, events: [{ kind: 'bluff', agent: 'wren', victim: 'wick', at: [20, 4], believed: false }] }, 'A')).toEqual({ text: "Wick saw through Wren's bluff", side: 'you' });
    // The liar out of sight in fog: still a rival's bluff.
    expect(calloutOf({ ...f, events: [{ kind: 'bluff', agent: 'wren', victim: 'wick', at: [20, 4], believed: true }] }, 'A')).toEqual({ text: "A rival's bluff landed", side: 'rival' });
  });

  it('tags the lie in the feed and adds the target’s answer after it', () => {
    const f = v2FrameFixture();
    const wren = agent({ id: 'wren', name: 'Wren', team: 'B', role: 'Scout' });
    const lie = { tick: f.tick, from: 'wren', fromName: 'Wren', team: 'B' as const, channel: 'say' as const, text: 'The middle lamp oil is gone. I already have it.', overheard: false };
    const frame = { ...f, agents: [...f.agents, wren], comms: [lie], events: [{ kind: 'bluff' as const, agent: 'wren', victim: 'wick', at: [20, 4] as [number, number], believed: true }] };
    const lines = linesOf(frame, null).filter((l) => l.channel === 'say');
    expect(lines.map((l) => [l.fromName, l.text, l.bluff, l.bluffReply])).toEqual([
      ['Wren', lie.text, 'landed', undefined],
      ['Wick', BLUFF_REPLY.landed, 'landed', true],
    ]);
  });

  it('tells a pickup from a delivery from a drop', () => {
    const one = agent({ items: [{ kind: 'item', origin: 'own' }] });
    expect(invChange(undefined, one)).toBeNull();
    expect(invChange(agent(), one)).toEqual({ kind: 'picked', n: 1 });
    expect(invChange(one, agent({ delivered: 1 }))).toEqual({ kind: 'delivered', n: 1 });
    expect(invChange(one, agent())).toEqual({ kind: 'dropped', n: 1 });
    expect(invChange(one, one)).toBeNull();
  });

  it('lays out carry slots: full with origin, empty, or unknown out of sight', () => {
    const a = agent({ items: [{ kind: 'item', origin: 'middle', tick: 7 }] });
    expect(slotsOf(a, 2, true, 7)).toEqual([{ state: 'full', item: { kind: 'item', origin: 'middle', tick: 7 }, fresh: true }, { state: 'empty', n: 2 }]);
    expect(slotsOf(a, 3, false, 7)).toEqual([{ state: 'unknown' }, { state: 'unknown' }, { state: 'unknown' }]);
    expect(plural('Lamp oil', 2)).toBe('lamps');
    expect(plural('Flare', 2)).toBe('flares');
  });
});

describe('comms filter and third person', () => {
  it('tags and filters the feed', () => {
    const rivalHeard = line({ from: 'wren', fromName: 'Wren', team: 'B', overheard: true });
    expect(feedTag(line({}), 'A')).toBe('team');
    expect(feedTag(rivalHeard, 'A')).toBe('heard');
    expect(feedTag(line({ team: 'B' }), 'A')).toBe('rteam');
    const mind = line({ channel: 'mind' });
    expect(inFilter(mind, 'A', 'all')).toBe(false);
    expect(inFilter(mind, 'A', 'mind')).toBe(true);
    expect(inFilter(rivalHeard, 'A', 'heard')).toBe(true);
    expect(inFilter(rivalHeard, 'A', 'team')).toBe(false);
    expect(inFilter(line({ channel: 'verb' }), 'A', 'say')).toBe(true);
  });

  it("subtitles your agent's thinking and talk, and keeps a ranked rival's team talk private", () => {
    const lines = [
      line({ channel: 'mind', text: 'Dig left.' }),
      line({ channel: 'verb', text: 'Dig rubble' }),
      line({ from: 'moss', fromName: 'Moss', text: 'On my way.' }),
      line({ from: 'wren', fromName: 'Wren', team: 'B', channel: 'team', text: 'Middle is mine.' }),
    ];
    expect(subtitlesFor(lines, agent(), 'A', true).map((s) => [s.kind, s.text])).toEqual([
      ['think', 'Dig left.'],
      ['verb', 'Dig rubble'],
      ['heard', 'On my way.'],
    ]);
    const wren = agent({ id: 'wren', name: 'Wren', team: 'B' });
    expect(subtitlesFor(lines, wren, 'A', true).map((s) => s.text)).toEqual(['··· private channel']);
    expect(subtitlesFor(lines, wren, 'A', false).map((s) => s.text)).toEqual(['Middle is mine.']);
    expect(subtitlesFor([line({ text: 'x'.repeat(200) })], agent(), 'A', false)[0]!.dur).toBe(6.5);
  });

  it('lists what an agent heard, and only what a rival said', () => {
    const lines = [line({ from: 'moss', fromName: 'Moss', text: 'a' }), line({ text: 'mine' }), line({ from: 'wren', fromName: 'Wren', team: 'B', channel: 'say', text: 'b' })];
    expect(heardBy(lines, agent(), 'A').map((l) => l.text)).toEqual(['b', 'a']);
    expect(heardBy(lines, agent({ id: 'wren', team: 'B' }), 'A').map((l) => l.text)).toEqual(['b']);
  });
});

describe('debrief data', () => {
  it('takes the stored record over the live view, with Elo and the registry', () => {
    const d = debriefOf(undefined, v2MatchRecordFixture({ registry: { status: 'recorded', txHash: 'tx1' } }))!;
    expect(d).toMatchObject({ team: 'A', ranked: true, difficulty: 'normal', eloDelta: 16, registry: 'written', txHash: 'tx1', rivalHandle: 'ben', goal: 4 });
    expect(d.result).toEqual({ winner: 'A', score: { A: 4, B: 2 }, ticks: 90, reason: 'goal', decidedBy: 'goal' });
    expect(debriefOf(undefined, undefined)).toBeNull();
  });

  it('marks casual matches off the registry and picks the MVP', () => {
    const d = debriefOf(undefined, v2MatchRecordFixture({ ranked: false, difficulty: 'agentic', elo: [], debrief: v2DebriefFixture({ registry: null, eloDelta: null }) }))!;
    expect(d).toMatchObject({ difficulty: 'agentic', eloDelta: null, registry: 'casual', goal: 5 });
    expect(mvpOf(v2DebriefFixture())?.name).toBe('Wick');
    expect(mvpOf(v2DebriefFixture({ mvp: null }))?.name).toBe('Wick');
  });

  it('reports a void match with its reason', () => {
    const d = debriefOf(undefined, v2MatchRecordFixture({ status: 'void', winner: null, score: null, reason: 'declined', debrief: null }))!;
    expect(d).toMatchObject({ status: 'void', result: null, voidReason: 'declined' });
  });
});
