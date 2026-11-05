import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_MAP_LIMITS,
  MAPS_V2,
  MAP_SIZE_PRESETS,
  blankCommunityMap,
  createMatch,
  hazardSources,
  isCommunityMapId,
  mirrorMap,
  validateCommunityMap,
  type MapDefV2,
} from '../src/v2';

const copy = (d: MapDefV2): MapDefV2 => structuredClone(d);
const messages = (def: unknown) => {
  const r = validateCommunityMap(def);
  return r.ok ? [] : r.issues.map((i) => i.message);
};
const setTile = (d: MapDefV2, x: number, y: number, c: string) => {
  const r = [...d.rows[y]!];
  r[x] = c;
  d.rows[y] = r.join('');
};

describe('community map validation', () => {
  it('passes every official map (they keep the same rules)', () => {
    for (const def of MAPS_V2) expect(messages(def), def.id).toEqual([]);
  });

  it('passes a blank board of every size preset, and the engine plays it', () => {
    for (const p of MAP_SIZE_PRESETS) {
      const def = blankCommunityMap(p.w, p.h);
      expect(messages(def), p.id).toEqual([]);
      expect(p.w % 2).toBe(1);
      expect(() => createMatch(def, { A: [{ id: 'a', name: 'A', role: 'Builder', vision: 3, comms: 3, tier: 'standard' }], B: [{ id: 'b', name: 'B', role: 'Builder', vision: 3, comms: 3, tier: 'standard' }] })).not.toThrow();
    }
  });

  it('refuses a broken shape without throwing', () => {
    expect(messages(null)).toEqual(['the map must be an object']);
    expect(messages({ schema: 'skirm.map/v2' }).length).toBeGreaterThan(3);
    expect(messages({ ...blankCommunityMap(31, 13), rows: 'nope' })).toContain('rows must be a list of text rows');
  });

  it('points at the tiles that break the mirror and the border', () => {
    const def = blankCommunityMap(31, 13);
    setTile(def, 5, 5, '#');
    setTile(def, 0, 4, '.');
    const r = validateCommunityMap(def);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues).toContainEqual({ message: 'the two halves differ here (use the mirror tool)', at: [25, 5] });
    expect(r.issues).toContainEqual({ message: 'the border must be wall', at: [0, 4] });
    // The mirror tool fixes the halves.
    setTile(def, 0, 4, '#');
    expect(messages(mirrorMap(def))).toEqual([]);
  });

  it('checks the delivery point, starts, goal, hazards, switches and drops', () => {
    const base = blankCommunityMap(31, 13);
    const offCentre = copy(base);
    setTile(offCentre, 15, 6, '.');
    setTile(offCentre, 14, 6, 'E');
    setTile(offCentre, 16, 6, 'E');
    expect(messages(offCentre)).toContain('place exactly one delivery point (found 2)');

    const greedyGoal = { ...copy(base), goal: 5 };
    expect(messages(greedyGoal)).toContain('the goal needs 5 items but the map has 2 plus 0 supply drops');

    const noSource = { ...copy(base), hazards: [{ kind: 'water' as const, every: 4, cap: 6 }] };
    expect(messages(noSource)).toContain('water spreads but no water tile is on the map');
    const withSource = copy(noSource);
    setTile(withSource, 1, 11, '~');
    setTile(withSource, 29, 11, '~');
    expect(messages(withSource)).toEqual([]);
    expect(hazardSources(withSource)).toEqual(['water']);
    expect(messages({ ...withSource, hazards: [{ kind: 'water', every: 0, cap: 6 }] })).toContain('water must spread every 1 to 20 ticks');

    const sw = copy(base);
    setTile(sw, 15, 3, 'V');
    const w = 31;
    sw.switches = [{ at: [15, 3], name: 'Open the gate', kind: 'water', lanes: { A: [3 * w + 4], B: [3 * w + 26] } }];
    setTile(sw, 15, 3, 'V');
    expect(messages(sw)).toEqual([]);
    sw.switches[0]!.lanes.B = [3 * w + 27];
    expect(messages(sw)).toContain("a switch's two lanes must mirror each other");

    const drop = { ...copy(base), drops: [{ at: [15, 2] as [number, number], tick: 40 }] };
    expect(messages(drop)).toEqual([]);
    expect(messages({ ...drop, drops: [{ at: [14, 2], tick: 40 }] })).toContain('a supply drop must land on the centre column');
    expect(messages({ ...drop, drops: [{ at: [15, 2], tick: 400 }] })).toContainEqual(expect.stringMatching(/^a supply drop lands on tick 1 to \d+$/));

    const tooBig = blankCommunityMap(COMMUNITY_MAP_LIMITS.maxW + 2, 13);
    expect(messages(tooBig)).toContain('the board must be 11 to 55 wide and 9 to 25 tall');

    const crowd = copy(base);
    crowd.starts = { A: [[1, 1], [1, 1]], B: [[29, 1], [29, 1]] };
    expect(messages(crowd)).toContain('two starts on one tile');

    expect(messages({ ...copy(base), verbs: [{ id: 'X y', name: 'Bad', effect: 'grow' }] })).toContain('verb id "X y": lowercase letters, digits and _ only');
  });

  it('mirrors starts and switch lanes from either half', () => {
    const def = blankCommunityMap(31, 13);
    def.starts = { A: [[2, 2]], B: [[27, 3]] };
    expect(mirrorMap(def).starts).toEqual({ A: [[2, 2]], B: [[28, 2]] });
    expect(mirrorMap(def, 'right').starts).toEqual({ A: [[3, 3]], B: [[27, 3]] });
  });

  it('knows a community map id', () => {
    expect(isCommunityMapId('cmp_01HZY3M5K2Q8V7R6T4W9X0ABCD')).toBe(true);
    expect(isCommunityMapId('copper-hollow')).toBe(false);
  });
});
