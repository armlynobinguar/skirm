import { describe, expect, it } from 'vitest';
import {
  DOWN_TICKS,
  PUZZLES,
  PUZZLE_MEDALS,
  SURVIVE_DELIVERY_BONUS,
  botCrew,
  createMatch,
  legalActions,
  parseMapV2,
  puzzleById,
  puzzleGoal,
  puzzleMap,
  puzzleMatchOptions,
  puzzleMedal,
  puzzleResult,
  puzzleRivals,
  puzzleScore,
  puzzleStatus,
  stepMatch,
  type PuzzleDef,
} from '../src/v2';

const match = (p: PuzzleDef, size = 1) => createMatch(puzzleMap(p), { A: botCrew(size as 1 | 2 | 3, 'me'), B: puzzleRivals(size) }, puzzleMatchOptions(p));

describe('puzzle boards', () => {
  it('has about six puzzles with unique ids in order', () => {
    expect(PUZZLES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(PUZZLES.map((p) => p.id)).size).toBe(PUZZLES.length);
    PUZZLES.forEach((p, i) => expect(p.n).toBe(i + 1));
    expect(puzzleById('pz-1')).toBe(PUZZLES[0]);
    expect(puzzleById('nope')).toBeUndefined();
  });

  it('parses every board as a v2 map with a start per agent and the rival sealed in rock', () => {
    for (const p of PUZZLES) {
      const parsed = parseMapV2(puzzleMap(p));
      const { w, grid, def } = parsed;
      expect(def.starts.A.length, p.id).toBeGreaterThanOrEqual(p.crewSize);
      expect(w, p.id).toBe(p.layout[0]!.length * 2 - 1);
      // Every rival start is sealed: walls (or another rival start) on all four sides.
      const rival = (x: number, y: number) => def.starts.B.some(([bx, by]) => bx === x && by === y);
      for (const [x, y] of def.starts.B)
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const)
          if (!rival(x + dx, y + dy)) expect(grid[(y + dy) * w + x + dx], `${p.id} ${x},${y}`).toBe('wall');
      // The rival's half is rock apart from its pockets.
      for (let i = 0; i < grid.length; i++) {
        const x = i % w;
        const y = (i / w) | 0;
        if (x <= (w - 1) / 2 || def.starts.B.some(([bx, by]) => bx === x && by === y)) continue;
        expect(grid[i], `${p.id} ${x},${y}`).toBe('wall');
      }
    }
  });

  it('reads each goal off the definition, with a reach tile on open floor', () => {
    for (const p of PUZZLES) {
      const g = puzzleGoal(p);
      expect(g.kind).toBe(p.kind);
      const def = puzzleMap(p);
      if (g.kind === 'reach') expect(def.rows[g.at[1]]![g.at[0]], p.id).toBe('.');
      if (g.kind === 'deliver') {
        expect(def.goal).toBe(g.count);
        expect(def.rows.join('').split('*').length - 1, p.id).toBeGreaterThanOrEqual(g.count);
      } else expect(def.goal).toBeGreaterThan(def.rows.join('').split('*').length - 1);
      if (g.kind === 'survive') expect(g.ticks).toBeLessThanOrEqual(p.cap);
    }
  });

  it('keeps medal thresholds in order and within the cap (plus hold-out penalties)', () => {
    for (const p of PUZZLES) {
      expect(p.medals.gold, p.id).toBeLessThan(p.medals.silver);
      expect(p.medals.silver, p.id).toBeLessThan(p.medals.bronze);
      expect(p.medals.gold, p.id).toBeGreaterThan(0);
      if (p.kind !== 'survive') expect(p.medals.bronze, p.id).toBeLessThanOrEqual(p.cap);
    }
  });
});

describe('puzzle rules', () => {
  it('keeps the rock crew still and silent: it holds the whole run and may tell no bluffs', () => {
    const p = puzzleById('pz-6')!;
    const s = match(p, 3);
    expect(s.holdTicks.B).toBeGreaterThanOrEqual(p.cap);
    expect(s.holdTicks.A).toBe(0);
    expect(s.lieCap.B).toBe(0);
    expect(s.limit).toBe(p.cap);
    for (const r of s.agents.filter((a) => a.team === 'B')) expect(legalActions(s, r.id)).toEqual([{ type: 'wait' }]);
  });

  it('fails a run on the tick cap and solves a reach puzzle when an agent stands on the tile', () => {
    const p = puzzleById('pz-2')!;
    const s = match(p);
    expect(puzzleStatus(p, s)).toBeNull();
    const g = puzzleGoal(p);
    if (g.kind !== 'reach') throw new Error('pz-2 is a reach puzzle');
    const me = s.agents.find((a) => a.team === 'A')!;
    [me.x, me.y] = g.at;
    expect(puzzleStatus(p, s)).toBe('solved');
    expect(puzzleResult(p, s)).toMatchObject({ winner: 'A', reason: 'goal' });
    me.down = 2;
    expect(puzzleStatus(p, s)).toBeNull();
    me.down = 0;
    me.x = 1;
    s.tick = p.cap;
    expect(puzzleStatus(p, s)).toBe('failed');
    expect(puzzleResult(p, s)).toMatchObject({ winner: 'draw', reason: 'time' });
  });

  it('fails when the whole crew is removed, and solves a hold-out on its last tick', () => {
    const p = puzzleById('pz-5')!;
    const s = match(p, 2);
    for (let i = 0; i < 5; i++) stepMatch(s, { actions: {} });
    expect(puzzleStatus(p, s)).toBeNull();
    s.tick = p.target! - 1;
    stepMatch(s, { actions: {} });
    expect(puzzleStatus(p, s)).toBe('solved');
    const t = match(p, 2);
    for (const a of t.agents) if (a.team === 'A') a.out = true;
    expect(puzzleStatus(p, t)).toBe('failed');
    expect(puzzleResult(p, t)).toMatchObject({ winner: 'draw', reason: 'eliminated' });
  });

  it('scores ticks, and a hold-out its length plus knock-downs less deliveries', () => {
    const deliver = puzzleById('pz-1')!;
    expect(puzzleScore(deliver, { ticks: 19, knockdowns: 3, delivered: 1 })).toBe(19);
    const hold = puzzleById('pz-5')!;
    expect(puzzleScore(hold, { ticks: 40, knockdowns: 1, delivered: 2 })).toBe(40 + DOWN_TICKS - 2 * SURVIVE_DELIVERY_BONUS);
    expect(puzzleScore(hold, { ticks: 40, knockdowns: 0, delivered: 50 })).toBe(1);
  });

  it('gives the best medal a score earns, none above bronze', () => {
    const p = { medals: { gold: 10, silver: 15, bronze: 20 } };
    expect(puzzleMedal(p, 3)).toBe('gold');
    expect(puzzleMedal(p, 10)).toBe('gold');
    expect(puzzleMedal(p, 11)).toBe('silver');
    expect(puzzleMedal(p, 15)).toBe('silver');
    expect(puzzleMedal(p, 20)).toBe('bronze');
    expect(puzzleMedal(p, 21)).toBeNull();
    expect(PUZZLE_MEDALS).toEqual(['gold', 'silver', 'bronze']);
  });
});
