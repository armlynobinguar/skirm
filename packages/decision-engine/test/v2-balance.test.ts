// The community-map balance check: greedy against greedy over a few seeds.
import { MAPS_V2, blankCommunityMap, type MapDefV2 } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { BALANCE_SEEDS, balanceCheck, judge, type BalanceRun } from '../src/v2';

const run = (winner: BalanceRun['winner'], score = { A: 1, B: 1 }, reason: BalanceRun['reason'] = 'goal'): BalanceRun => ({
  seed: 'normal:1v1',
  difficulty: 'normal',
  size: 1,
  swapped: false,
  side: winner === 'A' ? 'left' : winner === 'B' ? 'right' : 'draw',
  winner,
  reason,
  decidedBy: 'goal',
  score,
  ticks: 50,
});

describe('balance check', () => {
  it('judges fairness and playability from the runs', () => {
    expect(judge([run('A'), run('B'), run('draw'), run('A')]).ok).toBe(true);
    const lopsided = judge([run('A'), run('A'), run('A'), run('B')]);
    expect(lopsided).toMatchObject({ fair: false, ok: false, wins: { left: 3, right: 1, draw: 0 } });
    expect(lopsided.problems[0]).toContain('starting on the left won 3 of 4');
    const empty = judge([run('draw', { A: 0, B: 0 }), run('draw', { A: 0, B: 0 }), run('draw', { A: 0, B: 0 }), run('draw')]);
    expect(empty).toMatchObject({ fair: true, playable: false, ok: false });
    expect(judge([run('A', { A: 1, B: 0 }, 'eliminated'), run('B'), run('A'), run('B')]).playable).toBe(false);
  });


  it('flags a map whose items sit on one side only', async () => {
    const def: MapDefV2 = blankCommunityMap(31, 13);
    def.rows = def.rows.map((r) => r.replace(/\*/g, '.'));
    def.rows[6] = [...def.rows[6]!].map((c, x) => (x === 4 || x === 5 || x === 6 ? '*' : c)).join('');
    def.goal = 2;
    const r = await balanceCheck(def);
    expect(r.wins.left).toBeGreaterThan(r.wins.right + 2);
    expect(r.ok).toBe(false);
  });

  it('flags a map where nobody can reach an item', async () => {
    const def: MapDefV2 = blankCommunityMap(31, 13);
    // Wall the items in.
    def.rows = def.rows.map((r, y) => [...r].map((c, x) => ((x === 2 || x === 4 || x === 26 || x === 28) && y >= 5 && y <= 7) || ((x === 3 || x === 27) && (y === 5 || y === 7)) ? '#' : c).join(''));
    const r = await balanceCheck(def);
    expect(r.playable).toBe(false);
  });

  it('passes every official map (each seed both ways round)', async () => {
    for (const def of MAPS_V2) {
      const r = await balanceCheck(def);
      expect(r.runs, def.id).toHaveLength(BALANCE_SEEDS.length * 2);
      expect(r.problems, def.id).toEqual([]);
    }
  }, 120_000);
});
