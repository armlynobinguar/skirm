// Gas, ice and live water on the HUD and the arena: the legend with its tooltips, the callouts, and
// the overlays the 2D and 3D arenas draw.
import { describe, expect, it } from 'vitest';
import { composeV2Arena } from '@/features/arena/live';
import { restingState, mapById } from '@/features/arena/world';
import { v2FrameFixture } from '@/test/fixtures';
import { calloutOf, fieldHazards } from './model';

describe('gas, ice and live water', () => {
  it('lists none on a map without them', () => {
    expect(fieldHazards(v2FrameFixture())).toEqual([]);
  });

  it('lists ice on Frostline Depot, and gas and live water on Sunken Metro, live when in sight', () => {
    expect(fieldHazards(v2FrameFixture({ mapId: 'frostline-depot' })).map((h) => h.key)).toEqual(['ice']);
    const quiet = fieldHazards(v2FrameFixture({ mapId: 'sunken-metro' }));
    expect(quiet.map((h) => [h.key, h.live])).toEqual([
      ['gas', false],
      ['shock', false],
    ]);
    expect(quiet[1]!.hint).toContain('West live rail and East live rail');
    const live = fieldHazards(v2FrameFixture({ mapId: 'sunken-metro', gas: [100], shock: [200] }));
    expect(live.every((h) => h.live)).toBe(true);
  });

  it('calls out a live rail and an agent it shocks', () => {
    const f = v2FrameFixture({ events: [{ kind: 'sparked', name: 'West live rail', at: [10, 13], until: 15, tiles: 9 }] });
    expect(calloutOf(f, 'A')).toEqual({ text: 'West live rail · the water is live', side: 'arena' });
    const g = v2FrameFixture();
    const a = g.agents[0]!;
    expect(calloutOf({ ...g, events: [{ kind: 'shocked', agent: a.id, by: 'West live rail' }] }, a.team)).toEqual({ text: `${a.name} shocked by live water`, side: 'you' });
  });

  it('draws ice from the rows, and gas and live water as overlays on the board', () => {
    const f = v2FrameFixture();
    const rows = f.rows.slice();
    const y = rows.findIndex((r) => r.includes('.'));
    const x = rows[y]!.indexOf('.');
    rows[y] = rows[y]!.slice(0, x) + '=' + rows[y]!.slice(x + 1);
    const a = composeV2Arena({ ...f, rows, gas: [5, 6], shock: [9] })!;
    expect(a.state.grid[y * a.A.w + x]).toBe('ice');
    expect(a.state.gas).toEqual([5, 6]);
    expect(a.state.shock).toEqual([9]);
    expect('gas' in composeV2Arena(f)!.state).toBe(false);
  });

  it("lays Frostline Depot's ice on the map at rest", () => {
    const m = mapById('frostline-depot')!;
    expect(restingState(m).grid.filter((t) => t === 'ice').length).toBeGreaterThan(0);
  });
});
