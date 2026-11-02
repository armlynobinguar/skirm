import { describe, expect, it } from 'vitest';
import {
  BLUFF_AVOID_TICKS,
  BLUFF_CAP,
  MAPS_V2,
  believeChance,
  bluffLine,
  bluffRoll,
  botCrew,
  checkGoal,
  createMatch,
  evaluateGoals,
  mapV2,
  observe,
  stepMatch,
  type AgentSpec,
  type MatchEvent,
  type MatchOptions,
  type MatchState,
  type TalkTier,
} from '../src/v2';

const at = (s: MatchState, i: number) => ({ x: i % s.map.w, y: (i / s.map.w) | 0 });
const dist = (s: MatchState, i: number, j: number) => Math.abs(at(s, i).x - at(s, j).x) + Math.abs(at(s, i).y - at(s, j).y);

/**
 * One agent a side, A (the target) one step from a middle item and B (the liar) in voice range of
 * it. A never bluffs back unless asked (lieCap A 0), so every bluff is B's.
 */
function setup(mapId: string, opts: { liarId?: string; liarTier?: TalkTier; vision?: number; match?: MatchOptions } = {}) {
  const crew = (id: string, tier: TalkTier, vision = 3): AgentSpec[] => [{ ...botCrew(1, 'x')[0]!, id, name: id, tier, vision }];
  const s = createMatch(mapV2(mapId)!, { A: crew('target', 'standard', opts.vision), B: crew(opts.liarId ?? 'liar', opts.liarTier ?? 'standard') }, { lieCap: { A: 0 }, ...opts.match });
  const tile = s.middle[0]!;
  const open = s.grid.map((t, i) => (t === null ? i : -1)).filter((i) => i >= 0);
  const targetAt = open.find((i) => dist(s, i, tile) === 1)!;
  const liarAt = open.find((i) => i !== targetAt && dist(s, i, targetAt) === 2)!;
  const [target, liar] = s.agents;
  Object.assign(target!, at(s, targetAt));
  Object.assign(liar!, at(s, liarAt));
  s.holdTicks = { A: 0, B: 0 };
  return { s, tile, target: target!, liar: liar! };
}

const bluffs = (ev: MatchEvent[]) => ev.filter((e) => e.kind === 'bluff');
const noFogMap = MAPS_V2.find((m) => !m.fog && mapV2(m.id) && createMatch(m, { A: botCrew(1, 'a'), B: botCrew(1, 'b') }).middle.length)!.id;

/** A liar id whose first-tick roll lands under `p` (believed) or not. */
function liarIdFor(believed: boolean, p: number): string {
  for (let k = 0; k < 1000; k++) if (bluffRoll(1, `liar${k}`, 'target') < p === believed) return `liar${k}`;
  throw new Error('no id');
}

describe('v2 bluffs', () => {
  it('speaks the bluff as an ordinary say that reaches the target and counts as a message', () => {
    const { s, liar, target } = setup('copper-hollow');
    const ev = stepMatch(s, { actions: {} });
    const said = ev.find((e) => e.kind === 'said' && e.agent === liar.id);
    expect(said).toMatchObject({ channel: 'say', text: bluffLine(s, 0) });
    expect(said?.kind === 'said' && said.heardBy).toContain(target.id);
    expect(target.inbox.map((m) => m.text)).toContain(bluffLine(s, 0));
    expect(bluffs(ev)).toHaveLength(1);
    expect(s.tally.B).toMatchObject({ lies: 1, sent: 1 });
  });

  it('is never believed about an item the target crew can see', () => {
    const { s, tile, target } = setup('copper-hollow', { vision: 1 });
    expect(s.map.def.fog).toBe(true);
    const ev = stepMatch(s, { actions: {} });
    expect(s.visible.A[tile]).toBe(true);
    expect(believeChance(s, target, tile)).toBe(0);
    expect(bluffs(ev)[0]).toMatchObject({ believed: false });
    expect(target.avoid).toBeNull();
    expect(checkGoal(s, 'A', { title: 'x', text: 'x', check: 'see', n: 1 })).toMatchObject({ available: true, progress: '1/1 seen through' });
  });

  it('fools the target for a few ticks when the roll lands: the item reads as floor and is walked over', () => {
    const probe = setup(noFogMap, { vision: 1 });
    const p = believeChance(probe.s, probe.target, probe.tile);
    expect(p).toBeCloseTo(0.59);
    // One bluff only, so a second one cannot extend the first.
    const { s, tile, target } = setup(noFogMap, { vision: 1, liarId: liarIdFor(true, p), match: { lieCap: { A: 0, B: 1 } } });
    expect(bluffs(stepMatch(s, { actions: {} }))[0]).toMatchObject({ believed: true });
    expect(s.tally.B).toMatchObject({ lies: 1, believed: 1 });
    expect(target.avoid).toEqual({ tile, until: 1 + BLUFF_AVOID_TICKS });
    const { x, y } = at(s, tile);
    expect(observe(s, target.id).rows[y]![x]).toBe('.');
    expect(observe(s, s.agents[1]!.id).rows[y]![x]).toBe('*');

    // Standing on it while fooled picks nothing up; once the bluff wears off it does.
    Object.assign(target, { x, y });
    while (s.tick < 1 + BLUFF_AVOID_TICKS - 1) stepMatch(s, { actions: {} });
    expect(target.carrying).toEqual([]);
    expect(s.grid[tile]).toBe('item');
    stepMatch(s, { actions: {} });
    expect(target.carrying).toEqual([tile]);
    expect(checkGoal(s, 'B', { title: 'x', text: 'x', check: 'bluff', n: 1 })).toMatchObject({ available: true, progress: '1/1 bluffs landed' });
  });

  it('is doubted when the roll misses', () => {
    const probe = setup(noFogMap, { vision: 1 });
    const { s, target } = setup(noFogMap, { vision: 1, liarId: liarIdFor(false, believeChance(probe.s, probe.target, probe.tile)) });
    expect(bluffs(stepMatch(s, { actions: {} }))[0]).toMatchObject({ believed: false });
    expect(target.avoid).toBeNull();
    expect(s.tally.B).toMatchObject({ lies: 1, believed: 0 });
  });

  it('keeps to the cap: BLUFF_CAP by default, the match’s own when set, and one a tick', () => {
    expect(BLUFF_CAP).toBe(3);
    const run = (match?: MatchOptions) => {
      const { s } = setup('copper-hollow', { liarTier: 'open', ...(match ? { match } : {}) });
      for (let t = 0; t < 12; t++) stepMatch(s, { actions: {} });
      return s.tally.B.lies;
    };
    expect(run()).toBe(BLUFF_CAP);
    expect(run({ lieCap: { A: 0, B: 1 } })).toBe(1);
    expect(run({ lieCap: { A: 0, B: 0 } })).toBe(0);
    expect(run({ lieCap: { A: 0, B: 20 } })).toBe(12);
  });

  it('respects talk: Quiet agents never bluff, Standard waits its turn, and an agent already speaking keeps its message', () => {
    const quiet = setup('copper-hollow', { liarTier: 'quiet' });
    for (let t = 0; t < 6; t++) stepMatch(quiet.s, { actions: {} });
    expect(quiet.s.tally.B.lies).toBe(0);

    const std = setup('copper-hollow');
    for (let t = 0; t < 6; t++) stepMatch(std.s, { actions: {} });
    expect(std.s.tally.B.lies).toBe(2); // ticks 1 and 6

    const busy = setup('copper-hollow');
    const ev = stepMatch(busy.s, { actions: {}, says: [{ agent: busy.liar.id, channel: 'team', text: 'Going middle.' }] });
    expect(bluffs(ev)).toEqual([]);
    expect(ev.find((e) => e.kind === 'said')).toMatchObject({ text: 'Going middle.' });
  });

  it('replays the same: the same inputs give the same bluffs and beliefs', () => {
    const play = () => {
      const { s } = setup(noFogMap, { vision: 2, liarTier: 'open', match: { lieCap: { A: 0, B: 9 } } });
      const out: MatchEvent[] = [];
      for (let t = 0; t < 20; t++) out.push(...bluffs(stepMatch(s, { actions: {} })));
      return out;
    };
    expect(play()).toEqual(play());
  });

  it('fills the result screen’s bluff stars', () => {
    const { s } = setup('copper-hollow', { vision: 1 });
    stepMatch(s, { actions: {} });
    s.result = { winner: 'A', reason: 'goal', decidedBy: 'goal', score: { A: 4, B: 0 }, ticks: 1 };
    const stars = evaluateGoals(s, 'A', 'normal');
    expect(stars.every((g) => g.available)).toBe(true);
    expect(stars.find((g) => g.check === 'see')).toMatchObject({ met: true, progress: '1 seen through' });
    expect(evaluateGoals(s, 'B', 'normal').find((g) => g.check === 'bluff')).toMatchObject({ met: false, progress: '0 landed' });
  });
});
