import { blankCommunityMap, validateCommunityMap } from '@skirm/engine/v2';
import { describe, expect, it } from 'vitest';
import { mapById } from '@/features/arena/world';
import { registerCommunityMap } from './convert';
import { commit, historyOf, mirrorHalf, paint, redo, resize, undo } from './editor';

const fresh = () => blankCommunityMap(31, 13);
const ok = (d: ReturnType<typeof fresh>) => validateCommunityMap(d).ok;

describe('map editor model', () => {
  it('paints with the mirror helper and keeps the map valid', () => {
    const d = paint(fresh(), 'wall', 5, 4, { mirror: true });
    expect(d.rows[4]![5]).toBe('#');
    expect(d.rows[4]![25]).toBe('#');
    expect(ok(d)).toBe(true);
    const lop = paint(fresh(), 'wall', 5, 4, { mirror: false });
    expect(lop.rows[4]![25]).toBe('.');
    expect(ok(lop)).toBe(false);
    expect(ok(mirrorHalf(lop, 'left'))).toBe(true);
    // The border never changes.
    expect(paint(fresh(), 'floor', 0, 3, { mirror: true }).rows[3]![0]).toBe('#');
  });

  it('adds a hazard with its first source tile and drops it with the last', () => {
    const wet = paint(fresh(), 'water', 2, 10, { mirror: true });
    expect(wet.hazards).toEqual([{ kind: 'water', every: 4, cap: 6 }]);
    expect(ok(wet)).toBe(true);
    expect(paint(wet, 'floor', 2, 10, { mirror: true }).hazards).toEqual([]);
  });

  it('moves the delivery point along the centre column only', () => {
    const d = paint(fresh(), 'exit', 15, 3, { mirror: true });
    expect(d.exit).toEqual([15, 3]);
    expect(d.rows.join('').split('E')).toHaveLength(2);
    expect(ok(d)).toBe(true);
    expect(paint(d, 'exit', 14, 3, { mirror: true })).toBe(d);
  });

  it('mirrors spawns, toggles switches with lanes, and drops', () => {
    let d = paint(fresh(), 'start', 2, 2, { mirror: false });
    expect(d.starts).toEqual({ A: [[1, 1], [2, 2]], B: [[29, 1], [28, 2]] });
    d = paint(d, 'start', 28, 2, { mirror: false });
    expect(d.starts.A).toEqual([[1, 1]]);
    d = paint(d, 'switch', 15, 2, { mirror: true });
    expect(d.switches).toHaveLength(1);
    expect(ok(d)).toBe(false); // a switch needs a lane
    d = paint(d, 'lane', 4, 9, { mirror: true, switchIndex: 0 });
    expect(d.switches[0]!.lanes).toEqual({ A: [9 * 31 + 4], B: [9 * 31 + 26] });
    d = paint(d, 'drop', 15, 9, { mirror: true });
    expect(d.drops).toEqual([{ at: [15, 9], tick: 40 }]);
    expect(validateCommunityMap(d)).toMatchObject({ ok: true });
    d = paint(d, 'switch', 15, 2, { mirror: true });
    expect(d.switches).toEqual([]);
    expect(d.rows[2]![15]).toBe('.');
  });

  it('resizes to a preset', () => {
    const d = resize({ ...fresh(), name: 'Mine' }, 41, 19);
    expect(d.rows).toHaveLength(19);
    expect(d.rows[0]).toHaveLength(41);
    expect(d.name).toBe('Mine');
    expect(ok(d)).toBe(true);
  });

  it('undoes and redoes, and a new change clears redo', () => {
    let h = historyOf(fresh());
    const first = h.present;
    h = commit(h, paint(h.present, 'wall', 3, 3, { mirror: true }));
    h = commit(h, paint(h.present, 'wall', 4, 3, { mirror: true }));
    expect(commit(h, h.present)).toBe(h);
    h = undo(undo(h));
    expect(h.present).toBe(first);
    expect(undo(h)).toBe(h);
    h = redo(h);
    expect(h.present.rows[3]![3]).toBe('#');
    h = commit(h, paint(h.present, 'item', 5, 5, { mirror: true }));
    expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
  });

  it('registers a community map so mapById finds it', () => {
    const def = { ...fresh(), id: 'cmp_01HZY3M5K2Q8V7R6T4W9X0ABCD', name: 'Test Yard' };
    const m = registerCommunityMap(def, 'copper-hollow');
    expect(mapById(def.id)).toBe(m);
    expect(m).toMatchObject({ name: 'Test Yard', label: 'Community' });
    expect(m.A).toMatchObject({ w: 31, h: 13, n: 1, exit: def.exit });
  });
});
