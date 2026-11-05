import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tileAtPoint } from '@/features/arena/pick';
import { composeV2Arena } from '@/features/arena/live';
import { OVERVIEW, arenaStore } from '@/features/arena/store';
import { FakeRealtime } from '@/test/fakeRealtime';
import { v2FrameFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { V2MatchScreen } from '../V2MatchScreen';
import { v2StoreFor } from '../v2Store';
import { controlledOf, standingText } from './Control';

function setup(ranked = false, matchId = 'mat_ctl') {
  const rt = new FakeRealtime();
  v2StoreFor(rt).queued = [{ agentId: 'wick', name: 'Wick', tier: 'standard' }];
  const r = renderWithProviders(<V2MatchScreen matchId={matchId} />, { realtime: rt, handle: 'ana', path: `/matches/${matchId}`, search: '' });
  act(() => {
    rt.emit({ type: 'v2_found', matchId, team: 'A', mapId: 'copper-hollow', ranked, acceptMs: 10_000 });
    rt.emit({ type: 'v2_lockin', matchId, lockMs: 30_000, rival: { agents: 1 } });
    rt.emit({ type: 'v2_start', matchId, team: 'A', rival: { handle: 'ben' }, tickMs: 2000, holdTicks: { A: 0, B: 0 } });
  });
  // Skip the intro (it takes the keys while it plays).
  fireEvent.keyDown(window, { key: 'Enter' });
  return { ...r, rt };
}

const steered = (tick: number) => {
  const f = v2FrameFixture({ tick });
  return { ...f, agents: f.agents.map((a) => (a.id === 'wick' ? { ...a, controlled: true as const } : a)), steer: { agentId: 'wick', standing: null } };
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  arenaStore().setLive(null);
  arenaStore().setView(OVERVIEW);
  vi.useRealTimers();
});

describe('hybrid control: state', () => {
  it('reads who is steered from the ack until the next frame, then from the frame', () => {
    expect(controlledOf(null, null)).toBeNull();
    expect(controlledOf(v2FrameFixture({ tick: 4 }), { agentId: 'wick', tick: 4 })).toBe('wick');
    expect(controlledOf(v2FrameFixture({ tick: 5 }), { agentId: 'wick', tick: 4 })).toBeNull();
    expect(controlledOf(steered(5), { agentId: null, tick: 5 })).toBeNull();
    expect(controlledOf(steered(6), { agentId: null, tick: 5 })).toBe('wick');
    expect(standingText({ kind: 'deliver' })).toBe('Heading to deliver');
    expect(standingText({ kind: 'goto', to: [3, 4] })).toBe('Walking to 3, 4');
    expect(standingText(null)).toBeNull();
  });

  it('rings the steered agent on the board and maps a click back to its tile', () => {
    expect(composeV2Arena(steered(3))!.controlled).toBe('wick');
    expect(composeV2Arena(v2FrameFixture({ tick: 3 }))!.controlled).toBeUndefined();
    const p = { ox: 400, oy: 100, T: 40, slab: 5.2, w: 12, h: 9 };
    // Tile (5, 3) is drawn at ox + (5 − 3)·T/2, oy + (5 + 3)·T/4, its top `slab` higher.
    expect(tileAtPoint(400 + 2 * 20, 100 + 8 * 10 - 5.2, p)).toEqual([5, 3]);
    expect(tileAtPoint(400 + 2 * 20 + 6, 100 + 8 * 10 - 5.2 + 3, p)).toEqual([5, 3]);
    expect(tileAtPoint(-500, -500, p)).toBeNull();
    expect(tileAtPoint(10, 10, null)).toBeNull();
  });
});

describe('hybrid control: the HUD', () => {
  it('takes control from a card, steers with keys, shows the hints and hands back on Esc', async () => {
    const { rt, user } = setup();
    act(() => rt.emit({ type: 'v2_frame', matchId: 'mat_ctl', frame: v2FrameFixture({ tick: 3 }) }));
    expect(screen.queryByTestId('v2-control')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('v2-take-control-wick'));
    expect(rt.sent).toContainEqual({ type: 'v2_control', matchId: 'mat_ctl', agentId: 'wick' });

    act(() => rt.emit({ type: 'v2_control_ok', matchId: 'mat_ctl', agentId: 'wick' }));
    expect(screen.getByTestId('v2-control')).toHaveTextContent('Steering Wick');
    expect(screen.getByTestId('v2-control-keys')).toHaveTextContent('WASD');
    expect(screen.getByTestId('v2-take-control-wick')).toHaveAttribute('aria-pressed', 'true');

    act(() => rt.emit({ type: 'v2_frame', matchId: 'mat_ctl', frame: { ...steered(4), steer: { agentId: 'wick', standing: { kind: 'deliver' } } } }));
    expect(screen.getByTestId('v2-steered-wick')).toHaveTextContent('You');
    expect(screen.getByTestId('v2-control-order')).toHaveTextContent('Heading to deliver');

    fireEvent.keyDown(window, { key: 'd' });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    fireEvent.keyDown(window, { key: 'e' });
    fireEvent.keyDown(window, { key: 't' });
    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 'x' });
    const steers = rt.sent.filter((m) => m.type === 'v2_steer').map((m) => (m as { input: unknown }).input);
    expect(steers).toEqual([
      { kind: 'move', dir: 'E' },
      { kind: 'move', dir: 'N' },
      { kind: 'use', dir: 'N' },
      { kind: 'take' },
      { kind: 'deliver' },
      { kind: 'stop' },
    ]);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(rt.sent.at(-1)).toEqual({ type: 'v2_control', matchId: 'mat_ctl', agentId: null });
    act(() => rt.emit({ type: 'v2_control_ok', matchId: 'mat_ctl', agentId: null }));
    expect(screen.queryByTestId('v2-control')).not.toBeInTheDocument();
  });

  it('offers no control in ranked', () => {
    const { rt } = setup(true, 'mat_rk');
    act(() => rt.emit({ type: 'v2_frame', matchId: 'mat_rk', frame: v2FrameFixture({ tick: 3 }) }));
    expect(screen.queryByTestId('v2-take-control-wick')).not.toBeInTheDocument();
  });
});
