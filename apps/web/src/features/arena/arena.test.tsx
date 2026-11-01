import { DIFFICULTIES, MATCH_GOALS } from '@skirm/engine/v2';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { testRouter } from '@/test/router';
import { ArenaCanvas } from './ArenaCanvas';
import { cameraFor, easeRateFor, sceneForMatchView, sceneForScreen, stepCamera } from './scene';
import { OVERVIEW, arenaStore } from './store';
import { DIFFS, GOALS, MAPS, ROTATION_INDEX, diffIndex, goalOf, isStarter, mapById, restingState } from './world';

describe('v2 map roster', () => {
  it('has the 10 maps with codes, mirrored arenas sized by difficulty, and Copper Hollow in rotation', () => {
    expect(MAPS.map((m) => m.code)).toEqual(['SW-01', 'AO-02', 'FD-03', 'GR-04', 'CH-05', 'DB-06', 'MT-07', 'SM-08', 'BS-09', 'BH-10']);
    expect(MAPS[ROTATION_INDEX]!.id).toBe('copper-hollow');
    expect(MAPS.map((m) => `${m.A.w}x${m.A.h}`)).toEqual(['31x13', '35x15', '35x15', '41x19', '41x19', '41x19', '47x21', '47x21', '55x25', '55x25']);
    for (const m of MAPS) {
      const { A } = m;
      expect(A.grid).toHaveLength(A.w * A.h);
      expect(A.exit[0]).toBe((A.w - 1) / 2); // the shared delivery point sits on the centre column
      // Mirrored starts: same row, reflected column.
      A.starts.A.forEach(([x, y], i) => expect(A.starts.B[i]).toEqual([A.w - 1 - x, y]));
      expect(m.verbs.length).toBeGreaterThan(1);
    }
    expect(MAPS.filter(isStarter).map((m) => m.code)).toEqual(['SW-01', 'AO-02', 'FD-03', 'GR-04', 'CH-05']);
    expect(mapById('basalt-stair')?.A.night).toBe(true);
  });

  it('vendors the difficulty levels and goals the engine plays', () => {
    expect(DIFFS.map((d) => d.k)).toEqual([...DIFFICULTIES]);
    expect(diffIndex('normal')).toBe(1);
    for (const m of MAPS) expect(GOALS[m.id]!.map((g) => g[0])).toEqual(MATCH_GOALS[m.id]!.map((g) => g.title));
    expect(goalOf(mapById('copper-hollow')!, 1)).toEqual({ t: 'Shore the tunnels', d: 'Win and dig or shore 3 times on the way.', chk: ['verb', 3] });
    expect(mapById('ashfall-orchard')?.label).toBe('Starter');
  });

  it('puts two agents a side on their starts at rest', () => {
    const m = mapById('copper-hollow')!;
    const s = restingState(m);
    expect(s.agents.map((a) => a.team)).toEqual(['A', 'A', 'B', 'B']);
    expect(restingState(m)).toBe(s);
  });
});

describe('arena scene and camera', () => {
  it('maps screens to scenes', () => {
    expect(sceneForScreen('home')).toBe('lobby');
    expect(sceneForScreen('pvp')).toBe('hub');
    expect(sceneForScreen('match')).toBe('match');
    expect(sceneForScreen('match-result')).toBe('result');
    expect(sceneForScreen('market')).toBe('market');
    expect(sceneForScreen(null)).toBe('market');
    expect(sceneForScreen('agent')).toBe('agent');
  });

  it('lets the live match screen point the camera without changing the route', () => {
    expect(sceneForMatchView('match', 'overview')).toBe('match');
    expect(sceneForMatchView('match', 'tpv')).toBe('tpv');
    expect(sceneForMatchView('hub', 'follow')).toBe('hub');
    expect(cameraFor('follow', false).zoom).toBeGreaterThan(cameraFor('match', false).zoom);
    expect(cameraFor('intro', false).zoom).toBe(0.5);
    expect(easeRateFor('intro')).toBeLessThan(easeRateFor('match'));
    const s = arenaStore();
    act(() => s.setView({ mode: 'follow', focus: 'wick' }));
    expect(s.get().view).toEqual({ mode: 'follow', focus: 'wick' });
    act(() => s.setView(OVERVIEW));
    expect(s.get().view.mode).toBe('overview');
  });

  it('shows the arena undimmed in a match and eases the camera toward its target', () => {
    expect(cameraFor('match', false).dim).toBe(0);
    expect(cameraFor('lobby', true).fx).toBe(0.5);
    const from = cameraFor('market', false);
    const to = cameraFor('match', false);
    const mid = stepCamera(from, to, 0.1);
    expect(mid.dim).toBeLessThan(from.dim);
    expect(mid.dim).toBeGreaterThan(to.dim);
  });

  it('renders the canvas for the current screen even without canvas support', () => {
    testRouter.pathname = '/pvp';
    render(<ArenaCanvas />);
    expect(screen.getByTestId('arena-canvas')).toHaveAttribute('data-scene', 'hub');
  });

  it('the store changes the map and restarts the drop-in', () => {
    const s = arenaStore();
    const before = s.get();
    act(() => s.setMap(0));
    expect(s.get()).toMatchObject({ mapIdx: 0, introAt: before.introAt + 1 });
    act(() => s.setMap(0));
    expect(s.get().introAt).toBe(before.introAt + 1);
  });
});
