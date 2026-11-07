import { ALWAYS_TRIGGER } from '@skirm/shared';
import { MAPS_V2, createMatch, frameFor, type FrameAgent } from '@skirm/engine/v2';
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cameraFor, easeRateFor } from '@/features/arena/scene';
import { preferencesStore } from '@/lib/preferences';
import { FakeRealtime } from '@/test/fakeRealtime';
import { renderWithProviders } from '@/test/render';
import { v2StoreFor } from '../v2Store';
import { INTRO_MS, Intro, crewCards, rivalCards, type IntroProps } from './Intro';

const agent = (id: string, name: string, team: 'A' | 'B', role: FrameAgent['role'], skill?: string): FrameAgent => ({
  id,
  name,
  team,
  role,
  x: 1,
  y: 1,
  items: [],
  delivered: 0,
  down: false,
  out: false,
  tier: 'standard',
  ...(skill ? { skills: [{ name: skill, trigger: ALWAYS_TRIGGER, active: false }] } : {}),
});

const rook = agent('rook', 'Rook', 'A', 'Builder', 'Flood Warden');
const wick = agent('wick', 'Wick', 'A', 'Digger');
const wren = agent('wren', 'Wren', 'B', 'Scout');

const base: IntroProps = {
  mapId: 'copper-hollow',
  ranked: false,
  difficulty: 'normal',
  goal: 4,
  limit: 150,
  tickMs: 2000,
  you: 'ana',
  rivalHandle: null,
  crew: ['Rook', 'Wick'],
  rivalAgents: 2,
  agents: [rook, wick],
  rivals: [],
  onDone: () => {},
};

const later = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  act(() => preferencesStore().set({ reducedMotion: null }));
  vi.useRealTimers();
});

describe('intro name cards', () => {
  it('builds cards from what is known, never inventing a rival', () => {
    expect(crewCards(['Rook'], [rook])).toEqual([{ key: 'rook', name: 'Rook', role: 'Builder', skill: 'Flood Warden' }]);
    expect(crewCards(['Rook'], [])).toEqual([{ key: 'n0', name: 'Rook', role: null, skill: null }]);
    const r = rivalCards([wren], 3);
    expect(r.map((k) => [k.name, k.role, k.skill, !!k.unseen])).toEqual([
      ['Wren', 'Scout', null, false],
      ['Rival', null, null, true],
      ['Rival', null, null, true],
    ]);
    expect(rivalCards(null, null)).toEqual([]);
  });

  it('shows your crew and the rival crew as cards once the crews land, then hands over', () => {
    const onDone = vi.fn();
    renderWithProviders(<Intro {...base} rivals={[wren]} rivalHandle="ben" onDone={onDone} />);
    later(INTRO_MS.crews + 50);
    const cards = screen.getAllByTestId('v2-intro-card');
    expect(cards.map((c) => c.textContent)).toEqual(['RookBuilder · Flood Warden', 'WickDigger', 'WrenScout', 'Rivalunseen']);
    expect(screen.getByTestId('v2-intro-crews')).toHaveTextContent('Rival · ben');
    later(INTRO_MS.done - INTRO_MS.crews);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(INTRO_MS.done).toBeLessThanOrEqual(9300);
  });

  it('names the greedy bot in practice', () => {
    renderWithProviders(<Intro {...base} practice />);
    later(INTRO_MS.crews + 50);
    expect(screen.getByTestId('v2-intro-crews')).toHaveTextContent('Rival · Greedy bot');
  });

  it('sweeps the camera while it plays and stops on unmount', () => {
    const { unmount } = renderWithProviders(<Intro {...base} />);
    const t0 = Date.now();
    const start = cameraFor('intro', false, t0);
    expect(start.zoom).toBeGreaterThan(1);
    expect(cameraFor('intro', false, t0 + 2000).fx).toBeLessThan(start.fx);
    // Settled on the overview camera by the time the crews land.
    const settled = cameraFor('intro', false, t0 + INTRO_MS.crews + 100);
    const overview = cameraFor('match', false);
    expect(settled.fx).toBeCloseTo(overview.fx, 6);
    expect(settled.fy).toBeCloseTo(overview.fy, 6);
    expect(settled.zoom).toBeCloseTo(overview.zoom, 6);
    expect(easeRateFor('intro')).toBeGreaterThan(1);
    unmount();
    expect(cameraFor('intro', false).zoom).toBe(0.5);
  });

  it('with reduced motion: no sweep', () => {
    act(() => preferencesStore().set({ reducedMotion: true }));
    renderWithProviders(<Intro {...base} />);
    expect(cameraFor('intro', false).zoom).toBe(0.5);
    later(INTRO_MS.crews + 50);
    expect(screen.getAllByTestId('v2-intro-card')).toHaveLength(4);
  });

  it("reads roles from this tab's live view when the props leave them out", () => {
    const rt = new FakeRealtime();
    const map = MAPS_V2.find((m) => m.id === 'copper-hollow')!;
    const m = createMatch(map, { A: [{ id: 'rook', name: 'Rook', role: 'Builder', vision: 3, comms: 3, tier: 'standard' }], B: [{ id: 'wren', name: 'Wren', role: 'Scout', vision: 3, comms: 3, tier: 'standard' }] });
    v2StoreFor(rt).apply({ type: 'v2_found', matchId: 'mat_i', team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 10_000 });
    v2StoreFor(rt).apply({ type: 'v2_start', matchId: 'mat_i', team: 'A', rival: { handle: 'ben' }, tickMs: 2000, holdTicks: { A: 0, B: 0 } });
    v2StoreFor(rt).apply({ type: 'v2_frame', matchId: 'mat_i', frame: frameFor(m, 'A', []) });
    const { agents: _a, rivals: _r, ...props } = base;
    renderWithProviders(<Intro {...props} crew={['Rook']} rivalAgents={1} />, { realtime: rt });
    later(INTRO_MS.crews + 50);
    expect(screen.getAllByTestId('v2-intro-card')[0]).toHaveTextContent('RookBuilder');
  });
});
