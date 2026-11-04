import type { FrameCommands } from '@skirm/engine/v2';
import { DEFAULTS } from '@skirm/shared';
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OVERVIEW, arenaStore } from '@/features/arena/store';
import { FakeRealtime } from '@/test/fakeRealtime';
import { v2DebriefFixture, v2FrameFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { V2MatchScreen } from '../V2MatchScreen';
import { reduceV2, v2StoreFor } from '../v2Store';
import { commandState } from './Commands';
import { debriefOf } from './debrief';

const cd = DEFAULTS.commands.cooldownTicks;
const cmds = (left: number, log: FrameCommands['log'] = []): FrameCommands => ({ left, log });
const regroup = {
  tick: 6,
  until: 15,
  agents: ['wick', 'moss'],
  preset: 'regroup' as const,
  text: 'stay low',
};

function setup(matchId = 'mat_cmd') {
  const rt = new FakeRealtime();
  v2StoreFor(rt).queued = [{ agentId: 'wick', name: 'Wick', tier: 'standard' }];
  const r = renderWithProviders(<V2MatchScreen matchId={matchId} />, {
    realtime: rt,
    handle: 'ana',
    path: `/matches/${matchId}`,
    search: '',
  });
  act(() => {
    rt.emit({
      type: 'v2_found',
      matchId,
      team: 'A',
      mapId: 'copper-hollow',
      ranked: false,
      acceptMs: 10_000,
    });
    rt.emit({ type: 'v2_lockin', matchId, lockMs: 30_000, rival: { agents: 1 } });
    rt.emit({
      type: 'v2_start',
      matchId,
      team: 'A',
      rival: { handle: 'ben' },
      tickMs: 2000,
      holdTicks: { A: 0, B: 0 },
    });
  });
  return { ...r, rt };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  arenaStore().setLive(null);
  arenaStore().setView(OVERVIEW);
  vi.useRealTimers();
});

describe('live commands: state', () => {
  it('counts what is left, a command on its way and the cooldown', () => {
    const per = DEFAULTS.commands.perMatch;
    expect(commandState(null, null)).toEqual({ left: per, pending: false, cooldown: 0 });
    expect(commandState(v2FrameFixture({ tick: 4, commands: cmds(per) }), null)).toEqual({
      left: per,
      pending: false,
      cooldown: 0,
    });
    // Acked for tick 5 while the frame is still at 4: on its way, the ack's count wins.
    expect(
      commandState(v2FrameFixture({ tick: 4, commands: cmds(per) }), { tick: 5, left: per - 1 }),
    ).toMatchObject({ left: per - 1, pending: true });
    // Applied on 6 (sent on 5): ready again at 5 + cooldown.
    const applied = (tick: number) =>
      commandState(v2FrameFixture({ tick, commands: cmds(per - 1, [regroup]) }), {
        tick: 6,
        left: per - 1,
      });
    expect(applied(6)).toEqual({ left: per - 1, pending: false, cooldown: cd - 1 });
    expect(applied(5 + cd).cooldown).toBe(0);
  });

  it('turns a frame’s new commands into order lines for the feed and the transcript, never from a watch frame', () => {
    let v = reduceV2(
      undefined,
      {
        type: 'v2_found',
        matchId: 'm',
        team: 'A',
        mapId: 'copper-hollow',
        ranked: false,
        acceptMs: 1,
      },
      0,
    );
    v = reduceV2(
      v,
      { type: 'v2_frame', matchId: 'm', frame: v2FrameFixture({ tick: 5, commands: cmds(3) }) },
      1,
    );
    v = reduceV2(v, { type: 'v2_command_ok', matchId: 'm', tick: 6, left: 2 }, 2);
    expect(v!.commandAck).toEqual({ tick: 6, left: 2 });
    v = reduceV2(
      v,
      {
        type: 'v2_frame',
        matchId: 'm',
        frame: v2FrameFixture({ tick: 6, commands: cmds(2, [regroup]) }),
      },
      3,
    );
    v = reduceV2(
      v,
      {
        type: 'v2_frame',
        matchId: 'm',
        frame: v2FrameFixture({ tick: 7, commands: cmds(2, [regroup]) }),
      },
      4,
    );
    const orders = v!.comms.filter((l) => l.channel === 'order');
    expect(orders).toEqual([
      expect.objectContaining({
        tick: 6,
        fromName: 'You',
        text: 'Regroup · stay low',
        orderTo: 'Crew',
      }),
    ]);
    expect(v!.said.filter((l) => l.channel === 'order')).toHaveLength(1);
    const w = reduceV2(
      undefined,
      { type: 'v2_frame', matchId: 'w', frame: v2FrameFixture({ tick: 6 }, 'watch') },
      0,
    );
    expect(w!.comms.some((l) => l.channel === 'order')).toBe(false);
  });

  it('puts a stored debrief’s commands in the transcript when the tab never saw the match', () => {
    const debrief = v2DebriefFixture({
      commands: [
        { tick: 9, agents: [{ id: 'moss', name: 'Moss' }], preset: 'go_drop', text: null },
      ],
    });
    const record = {
      id: 'm',
      mapId: 'copper-hollow',
      ranked: false,
      practice: false,
      status: 'ended',
      teams: { A: { handle: 'ana' }, B: { handle: 'ben' } },
      elo: [],
      registry: { status: 'none' },
      you: 'A',
      debrief,
    } as never;
    expect(debriefOf(undefined, record)!.comms).toEqual([
      expect.objectContaining({
        tick: 9,
        channel: 'order',
        text: 'Go for the drop',
        orderTo: 'Moss',
      }),
    ]);
  });
});

describe('live commands: the panel', () => {
  it('shows the counter, sends a preset to the crew or one agent with words, and waits for the ack', async () => {
    const { rt, user } = setup();
    act(() =>
      rt.emit({
        type: 'v2_frame',
        matchId: 'mat_cmd',
        frame: v2FrameFixture({ tick: 5, commands: cmds(3) }),
      }),
    );
    const panel = screen.getByTestId('v2-commands');
    // Collapsed until opened, so it never covers the map.
    expect(screen.queryByTestId('v2-command-target')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('v2-commands-toggle'));
    expect(screen.getByTestId('v2-commands-left')).toHaveAccessibleName('3 of 3 commands left');
    expect(panel).toHaveTextContent('Ready');

    await user.selectOptions(screen.getByTestId('v2-command-target'), 'moss');
    await user.type(screen.getByTestId('v2-command-text'), 'take it now');
    await user.click(screen.getByTestId('v2-command-go_drop'));
    expect(rt.sent).toContainEqual({
      type: 'v2_command',
      matchId: 'mat_cmd',
      agentId: 'moss',
      preset: 'go_drop',
      text: 'take it now',
    });
    expect(screen.getByTestId('v2-command-regroup')).toBeDisabled();

    act(() => rt.emit({ type: 'v2_command_ok', matchId: 'mat_cmd', tick: 6, left: 2 }));
    expect(screen.getByTestId('v2-commands-left')).toHaveAccessibleName('2 of 3 commands left');
    expect(panel).toHaveTextContent('On its way');

    act(() =>
      rt.emit({
        type: 'v2_frame',
        matchId: 'mat_cmd',
        frame: v2FrameFixture({
          tick: 6,
          commands: cmds(2, [
            { ...regroup, agents: ['moss'], preset: 'go_drop', text: 'take it now' },
          ]),
        }),
      }),
    );
    expect(panel).toHaveTextContent(`Ready in ${cd - 1}`);
    expect(screen.getByTestId('v2-comms')).toHaveTextContent(
      'Go for the drop · take it now → Moss',
    );

    act(() =>
      rt.emit({
        type: 'v2_frame',
        matchId: 'mat_cmd',
        frame: v2FrameFixture({
          tick: 5 + cd,
          commands: cmds(2, [{ ...regroup, agents: ['moss'] }]),
        }),
      }),
    );
    expect(screen.getByTestId('v2-command-regroup')).toBeEnabled();
    // Words alone go to the whole crew once the target is back on it.
    await user.selectOptions(screen.getByTestId('v2-command-target'), '');
    await user.type(screen.getByTestId('v2-command-text'), 'hold');
    await user.click(screen.getByTestId('v2-command-send'));
    expect(rt.sent).toContainEqual({ type: 'v2_command', matchId: 'mat_cmd', text: 'hold' });
    // A refusal ends the send with a toast and leaves the panel usable.
    act(() =>
      rt.emit({
        type: 'error',
        code: 'command_refused',
        message: 'the command was refused by the filter',
      }),
    );
    expect(screen.getByTestId('v2-command-regroup')).toBeEnabled();
  });

  it('locks the panel when no commands are left, and shows none to a spectator', () => {
    const { rt } = setup();
    act(() =>
      rt.emit({
        type: 'v2_frame',
        matchId: 'mat_cmd',
        frame: v2FrameFixture({ tick: 40, commands: cmds(0, [regroup]) }),
      }),
    );
    expect(screen.getByTestId('v2-commands')).toHaveTextContent('No commands left');
    act(() => screen.getByTestId('v2-commands-toggle').click());
    expect(screen.getByTestId('v2-command-hold_gate')).toBeDisabled();
  });

  it('has no panel for a spectator', () => {
    const rt = new FakeRealtime();
    renderWithProviders(<V2MatchScreen matchId="mat_w" />, {
      realtime: rt,
      path: '/matches/mat_w',
      search: '',
    });
    act(() =>
      rt.emit({ type: 'v2_frame', matchId: 'mat_w', frame: v2FrameFixture({ tick: 10 }, 'watch') }),
    );
    expect(screen.getByTestId('v2-live')).toBeInTheDocument();
    expect(screen.queryByTestId('v2-commands')).toBeNull();
  });
});
