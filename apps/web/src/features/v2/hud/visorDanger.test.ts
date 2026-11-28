import { describe, expect, it } from 'vitest';
import { dangerEdges, threatsNear, type DangerBoard } from './visorDanger';

/** A 9×9 open board. */
function board(o: Partial<DangerBoard> = {}): DangerBoard {
  return { w: 9, h: 9, grid: Array(81).fill(null), agents: [], ...o };
}

describe('visor danger edges', () => {
  it('finds hazard tiles, gas, live current and rivals in range, never its own crew', () => {
    const grid: (string | null)[] = Array(81).fill(null);
    grid[4 * 9 + 6] = 'water';
    grid[0] = 'lava'; // far corner, out of range
    const b = board({ grid, gas: [4 * 9 + 2], shock: [8 * 9 + 8], agents: [{ team: 'B', x: 4, y: 2 }, { team: 'A', x: 4, y: 5 }, { team: 'B', x: 5, y: 5, out: true }] });
    const t = threatsNear(b, { x: 4, y: 4 }, 'A', 3);
    expect(t).toEqual(
      expect.arrayContaining([
        { x: 6, y: 4, kind: 'hazard' },
        { x: 2, y: 4, kind: 'hazard' },
        { x: 4, y: 2, kind: 'rival' },
      ]),
    );
    expect(t).toHaveLength(3);
    // Watching a rival agent, your crew is its threat.
    expect(threatsNear(b, { x: 4, y: 4 }, 'B', 3).filter((x) => x.kind === 'rival')).toEqual([{ x: 4, y: 5, kind: 'rival' }]);
  });

  it('lights the edge facing each threat, brighter when closer', () => {
    // Facing +z (yaw 0): ahead is +z, the screen's right is -x.
    const e = dangerEdges({ x: 4, z: 4 }, 0, [
      { x: 4, y: 6, kind: 'hazard' },
      { x: 1, y: 4, kind: 'rival' },
      { x: 4, y: 1, kind: 'hazard' },
    ]);
    expect(e.top.level).toBeGreaterThan(0);
    expect(e.top.rival).toBe(false);
    expect(e.right.rival).toBe(true);
    expect(e.bottom.level).toBeGreaterThan(0);
    expect(e.left.level).toBe(0);
    expect(e.top.level).toBeGreaterThan(e.bottom.level);
  });

  it('turns with the view and lights everything when standing in it', () => {
    const rival = [{ x: 1, y: 4, kind: 'rival' as const }];
    // Turned to face -x: the rival is dead ahead.
    expect(dangerEdges({ x: 4, z: 4 }, -Math.PI / 2, rival).top.rival).toBe(true);
    const all = dangerEdges({ x: 4, z: 4 }, 0, [{ x: 4, y: 4, kind: 'hazard' }]);
    expect([all.top, all.right, all.bottom, all.left].every((g) => g.level > 0.8)).toBe(true);
    expect(dangerEdges({ x: 4, z: 4 }, 0, []).top.level).toBe(0);
  });
});
