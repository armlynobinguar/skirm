import { describe, expect, it } from 'vitest';
import { HIGHLIGHTS_MAX, MAPS_V2, createMatch, detectHighlights, frameFor, stepMatch, type FrameAgent, type MatchEvent, type V2Frame } from '../src/v2';

const agent = (id: string, team: 'A' | 'B', x: number, y: number): FrameAgent => ({ id, name: id[0]!.toUpperCase() + id.slice(1), team, role: 'Builder', x, y, items: [], delivered: 0, down: false, out: false, tier: 'standard' });

function frame(tick: number, score: [number, number], events: MatchEvent[] = [], agents: FrameAgent[] = [agent('rook', 'A', 1, 1), agent('wren', 'B', 20, 1)], extra: Partial<V2Frame> = {}): V2Frame {
  return { view: 'watch', mapId: 'copper-hollow', tick, limit: 150, rows: [], agents, score: { A: score[0], B: score[1] }, goal: 3, holdTicks: { A: 0, B: 0 }, blocks: { A: 0, B: 0 }, events, comms: [], result: null, ...extra };
}

describe('v2 highlights', () => {
  it('finds deliveries, a comeback lead change and the winning goal', () => {
    const fs: V2Frame[] = [];
    for (let t = 1; t <= 40; t++) {
      const ev: MatchEvent[] = [];
      let s: [number, number] = [0, 0];
      if (t >= 5) s = [1, 0];
      if (t >= 8) s = [2, 0];
      if (t >= 20) s = [2, 1];
      if (t >= 25) s = [2, 2];
      if (t >= 30) s = [2, 3];
      if (t === 5 || t === 8) ev.push({ kind: 'delivered', agent: 'rook', team: 'A', count: 1, score: s[0] });
      if (t === 20 || t === 25 || t === 30) ev.push({ kind: 'delivered', agent: 'wren', team: 'B', count: 1, score: s[1] });
      fs.push(frame(t, s, ev, undefined, t === 30 ? { result: { winner: 'B', reason: 'goal', decidedBy: 'goal', score: { A: 2, B: 3 }, ticks: 30 } } : {}));
    }
    // Frames past the end are not part of a real match; stop at 30.
    const hl = detectHighlights(fs.slice(0, 30), { crews: { A: 'ana', B: 'ben' } });
    expect(hl.map((h) => h.tick)).toEqual([5, 8, 20, 25, 30]);
    const last = hl.at(-1)!;
    expect(last.kind).toBe('goal');
    expect(last.title).toBe('Wren delivers the goal');
    // The comeback rides along on the winning tick.
    expect(last.facts).toContain('wins the match');
    expect(last.facts).toContain('comes back from 2 down');
    expect(last.start).toBe(24);
    expect(last.end).toBe(30);
    expect(hl.every((h) => h.start <= h.tick && h.tick <= h.end)).toBe(true);
  });

  it('marks a plain lead change without a comeback', () => {
    const fs = [frame(1, [1, 0]), frame(2, [1, 1]), frame(3, [1, 2], [{ kind: 'delivered', agent: 'wren', team: 'B', count: 1, score: 2 }])];
    const [h] = detectHighlights(fs);
    expect(h).toMatchObject({ kind: 'lead_change', tick: 3, team: 'B', title: 'Crew B takes the lead' });
  });

  it('finds a switch flood and counts the agents it knocked down', () => {
    const fs = [
      frame(10, [0, 0], [{ kind: 'switch', agent: 'rook', name: 'Sluice', floods: 'B', until: 14 }]),
      frame(11, [0, 0], [{ kind: 'knocked_down', agent: 'wren', by: 'switch', dropped: 1 }]),
      frame(12, [0, 0]),
    ];
    const [h] = detectHighlights(fs, { crews: { A: 'ana', B: 'ben' } });
    expect(h).toMatchObject({ kind: 'switch_flood', tick: 10, team: 'A', title: "Rook floods ben's lane", weight: 6 });
    expect(h!.facts).toContain('knocking down 1');
  });

  it('finds a fight over a supply drop only when both crews reach it', () => {
    const drop: MatchEvent = { kind: 'supply_drop', at: [10, 5] };
    const far = detectHighlights([frame(3, [0, 0], [drop]), frame(4, [0, 0])]);
    expect(far).toEqual([]);
    const fs = [
      frame(3, [0, 0], [drop]),
      frame(6, [0, 0], [{ kind: 'stunned', agent: 'wren', by: 'rook' }], [agent('rook', 'A', 9, 5), agent('wren', 'B', 11, 5)]),
      frame(7, [0, 0], [{ kind: 'picked', agent: 'rook', at: [10, 5], stolen: false, origin: 'drop' }], [agent('rook', 'A', 10, 5), agent('wren', 'B', 11, 5)]),
    ];
    const [h] = detectHighlights(fs);
    expect(h).toMatchObject({ kind: 'drop_fight', tick: 6, team: 'A', title: 'Rook wins the drop fight' });
    expect(h!.facts).toContain('1 stun');
  });

  it('keeps the strongest few and ignores fogged crew views', () => {
    const fs: V2Frame[] = [];
    let a = 0;
    let b = 0;
    for (let t = 1; t <= 30; t++) {
      const ev: MatchEvent[] = [];
      if (t % 2) {
        a++;
        ev.push({ kind: 'delivered', agent: 'rook', team: 'A', count: 1, score: a });
      } else {
        b++;
        ev.push({ kind: 'delivered', agent: 'wren', team: 'B', count: 1, score: b });
      }
      fs.push(frame(t, [a, b], ev));
    }
    const hl = detectHighlights(fs);
    expect(hl).toHaveLength(HIGHLIGHTS_MAX);
    expect(hl.map((h) => h.tick)).toEqual([...hl.map((h) => h.tick)].sort((x, y) => x - y));
    expect(detectHighlights(fs.map((f) => ({ ...f, view: 'A' as const })))).toEqual([]);
  });

  it('reads real engine frames without throwing', () => {
    const map = MAPS_V2.find((m) => m.id === 'copper-hollow')!;
    const s = createMatch(map, { A: [{ id: 'rook', name: 'Rook', role: 'Builder', vision: 3, comms: 3, tier: 'standard' }], B: [{ id: 'wren', name: 'Wren', role: 'Digger', vision: 3, comms: 3, tier: 'standard' }] });
    const fs: V2Frame[] = [];
    for (let i = 0; i < 20 && !s.result; i++) fs.push(frameFor(s, 'watch', stepMatch(s, { actions: {}, says: [] })));
    expect(Array.isArray(detectHighlights(fs))).toBe(true);
  });
});
