// The debrief's tallies (verbs used, pickups, talk sent and overheard), the MVP rule and the credits
// line, and the replay frame store on the instance's key-value connection.
import { MAPS_V2, createMatch, frameFor, type AgentSpec, type MatchEvent } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { MemoryPubSub } from '../src/pubsub';
import { DebriefTally, agentsOf, buildDebrief, mvpOf } from '../src/v2/debrief';
import { PubSubV2FrameStore, v2FramesKey } from '../src/v2/replay';

const map = MAPS_V2.find((m) => m.id === 'copper-hollow')!;
const spec = (id: string, role: AgentSpec['role']): AgentSpec => ({ id, name: id, role, vision: 3, comms: 3, tier: 'open' });
const crews = { A: [spec('wick', 'Builder'), spec('moss', 'Digger')], B: [spec('wren', 'Scout')] };
const team = (id: string) => (crews.A.some((a) => a.id === id) ? 'A' : crews.B.some((a) => a.id === id) ? 'B' : undefined);

describe('v2 debrief', () => {
  it('counts talk per crew from events (rival team talk caught counts as overheard); agent lines come from the engine', () => {
    const t = new DebriefTally(team);
    const ev: MatchEvent[] = [
      { kind: 'verb', agent: 'wick', verb: 'shore', effect: 'add_solid', at: [1, 1] },
      { kind: 'verb', agent: 'wick', verb: 'shore', effect: 'add_solid', at: [1, 2] },
      { kind: 'picked', agent: 'moss', at: [2, 2], stolen: false, origin: 'own' },
      { kind: 'said', agent: 'wick', channel: 'team', text: 'go', heardBy: ['moss'], overheardBy: ['wren'] },
      { kind: 'said', agent: 'moss', channel: 'team', text: 'ok', heardBy: ['wick'], overheardBy: [] },
      { kind: 'said', agent: 'wren', channel: 'say', text: 'hi', heardBy: ['wick'], overheardBy: [] },
    ];
    t.add(ev);
    expect(t.talk).toEqual({ A: { sent: 2, overheard: 0 }, B: { sent: 1, overheard: 1 } });
    const s = createMatch(map, crews);
    const moss = s.agents.find((a) => a.id === 'moss')!;
    moss.delivered = 1;
    moss.picks = 1;
    s.agents.find((a) => a.id === 'wick')!.used = 2;
    expect(agentsOf(s, 'A')).toEqual([
      { agentId: 'wick', name: 'wick', delivered: 0, used: 2, picks: 0 },
      { agentId: 'moss', name: 'moss', delivered: 1, used: 0, picks: 1 },
    ]);
  });

  it('MVP is delivered × 3 + used + picks, the earlier slot on a tie', () => {
    const a = (agentId: string, delivered: number, used: number, picks: number) => ({ agentId, name: agentId, delivered, used, picks });
    expect(mvpOf([a('x', 1, 0, 1), a('y', 0, 3, 0)])).toBe('x');
    expect(mvpOf([a('x', 0, 2, 0), a('y', 0, 1, 1)])).toBe('x');
    expect(mvpOf([a('x', 0, 0, 0), a('y', 1, 0, 0)])).toBe('y');
    expect(mvpOf([])).toBeNull();
  });

  it('returns what was not charged; a void returns every credit', () => {
    const s = createMatch(map, crews);
    const base = { state: s, team: 'A' as const, difficulty: 'hard' as const, tally: new DebriefTally(team), held: 81, charged: 27, eloDelta: null, registry: null };
    expect(buildDebrief({ ...base, void: false }).credits).toEqual({ held: 81, used: 27, returned: 54 });
    expect(buildDebrief({ ...base, void: true }).credits).toEqual({ held: 81, used: 0, returned: 81 });
    expect(buildDebrief({ ...base, state: null, void: true })).toMatchObject({ agents: [], mvp: null, goals: [], difficulty: 'hard' });
  });

  it('reports each crew’s bluffs from the engine’s tallies, and none before the match went live', () => {
    const s = createMatch(map, crews);
    Object.assign(s.tally.A, { lies: 3, believed: 1 });
    Object.assign(s.tally.B, { lies: 2, believed: 0 });
    const base = { state: s, difficulty: 'normal' as const, tally: new DebriefTally(team), held: 0, charged: 0, void: false, eloDelta: null, registry: null };
    expect(buildDebrief({ ...base, team: 'A' }).bluffs).toEqual({ told: 3, believed: 1, heard: 2, seenThrough: 2 });
    expect(buildDebrief({ ...base, team: 'B' }).bluffs).toEqual({ told: 2, believed: 0, heard: 3, seenThrough: 2 });
    expect(buildDebrief({ ...base, team: 'A', state: null }).bluffs).toBeUndefined();
  });
});

describe('v2 replay frames', () => {
  it('stores and reads each view under its own key; missing or broken entries read as null', async () => {
    const kv = new MemoryPubSub();
    const store = new PubSubV2FrameStore(kv);
    const s = createMatch(map, crews);
    await store.put('mat_r', 'A', [frameFor(s, 'A', [])]);
    expect((await store.get('mat_r', 'A'))!.map((f) => f.view)).toEqual(['A']);
    expect(await store.get('mat_r', 'watch')).toBeNull();
    kv.kv.set(v2FramesKey('mat_r', 'B'), '{not json');
    expect(await store.get('mat_r', 'B')).toBeNull();
  });
});
