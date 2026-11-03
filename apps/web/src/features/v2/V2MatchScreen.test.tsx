import { MAPS_V2, createMatch, frameFor, stepMatch, type AgentSpec, type FrameAgent, type V2Frame } from '@skirm/engine/v2';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveFx } from '@/features/arena/live';
import { OVERVIEW, arenaStore } from '@/features/arena/store';
import { FakeRealtime } from '@/test/fakeRealtime';
import { v2DebriefFixture, v2FrameFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { V2MatchScreen } from './V2MatchScreen';
import { MAX_COMMS, linesOf, reduceV2, v2StoreFor } from './v2Store';

const map = MAPS_V2.find((m) => m.id === 'copper-hollow')!;
const spec = (id: string, role: AgentSpec['role']): AgentSpec => ({ id, name: id, role, vision: 3, comms: 3, tier: 'standard' });
const wren: FrameAgent = { id: 'wren', name: 'Wren', team: 'B', role: 'Scout', x: 30, y: 1, items: [], delivered: 0, down: false, out: false, tier: 'standard' };

function setup(matchId = 'mat_v2') {
  const rt = new FakeRealtime();
  v2StoreFor(rt).queued = [{ agentId: 'agt_1', name: 'Wick', tier: 'standard' }];
  const r = renderWithProviders(<V2MatchScreen matchId={matchId} />, { realtime: rt, handle: 'ana', path: `/matches/${matchId}`, search: '' });
  return { ...r, rt };
}

/** Found, accepted, locked and started as crew A, casual unless said. */
function startMatch(rt: FakeRealtime, matchId: string, ranked = false) {
  act(() => {
    rt.emit({ type: 'v2_found', matchId, team: 'A', mapId: 'copper-hollow', ranked, acceptMs: 10_000 });
    rt.emit({ type: 'v2_lockin', matchId, lockMs: 30_000, rival: { agents: 2 } });
    rt.emit({ type: 'v2_start', matchId, team: 'A', rival: { handle: 'ben' }, tickMs: 2000, holdTicks: { A: 0, B: 0 } });
  });
}

const key = (k: string) => act(() => void fireEvent.keyDown(window, { key: k }));
const later = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  arenaStore().setLive(null);
  arenaStore().setView(OVERVIEW);
  vi.useRealTimers();
  window.location.hash = '';
});

describe('v2 match screen', () => {
  it('walks accept, lock-in, the intro, live frames with comms, the banner and the debrief', async () => {
    const { rt, user, router } = setup();
    expect(screen.getByTestId('v2-waiting')).toBeInTheDocument();

    act(() => rt.emit({ type: 'v2_found', matchId: 'mat_v2', team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 10_000 }));
    expect(screen.getByTestId('v2-found')).toHaveTextContent('Copper Hollow');
    await user.click(screen.getByTestId('v2-accept'));
    expect(rt.sent).toContainEqual({ type: 'v2_accept', matchId: 'mat_v2' });

    act(() => {
      rt.emit({ type: 'v2_accepted', matchId: 'mat_v2', team: 'A' });
      rt.emit({ type: 'v2_accepted', matchId: 'mat_v2', team: 'B' });
      rt.emit({ type: 'v2_lockin', matchId: 'mat_v2', lockMs: 30_000, rival: { agents: 2 } });
    });
    expect(screen.getByTestId('v2-lockin')).toHaveTextContent('The rival brings 2 agents');
    expect(screen.getByTestId('v2-hold')).toHaveTextContent('Hold 30 credits · 0.20 per tick');
    await user.click(screen.getByRole('radio', { name: /Open/ }));
    expect(screen.getByTestId('v2-hold')).toHaveTextContent('Hold 60 credits · 0.40 per tick');
    await user.click(screen.getByTestId('v2-lock'));
    expect(rt.sent).toContainEqual({ type: 'v2_lock_in', matchId: 'mat_v2', tiers: ['open'] });

    // Real engine frames: crew A's view of a tick where both crews talked.
    const s = createMatch(map, { A: [spec('wick', 'Builder')], B: [spec('wren', 'Digger')] });
    const ev = stepMatch(s, { actions: {}, says: [{ agent: 'wick', channel: 'team', text: 'Taking the left tunnel.' }] });
    act(() => {
      rt.emit({ type: 'v2_start', matchId: 'mat_v2', team: 'A', rival: { handle: 'ben' }, tickMs: 2000, holdTicks: { A: 0, B: 0 } });
      rt.emit({ type: 'v2_frame', matchId: 'mat_v2', frame: frameFor(s, 'A', ev) });
    });
    // The intro plays first: the map, then the objective; the hazards stay hidden until their cue.
    expect(screen.getByTestId('v2-intro')).toBeInTheDocument();
    expect(arenaStore().get().view.mode).toBe('intro');
    later(300);
    expect(screen.getByTestId('v2-intro')).toHaveTextContent('Copper Hollow');
    later(2300);
    expect(screen.getByTestId('v2-intro')).toHaveTextContent('Deliver 4 lamps');
    expect(liveFx()).toMatchObject({ intro: true, revealAt: null });
    key('Enter');
    expect(screen.queryByTestId('v2-intro')).not.toBeInTheDocument();
    expect(liveFx()).toMatchObject({ intro: false, revealAt: expect.any(Number), deployAt: expect.any(Number) });
    expect(arenaStore().get().view).toEqual(OVERVIEW);

    expect(screen.getByTestId('v2-live')).toHaveTextContent('ben · B');
    expect(screen.getByTestId('v2-comms')).toHaveTextContent('Taking the left tunnel.');
    expect(screen.getByTestId('v2-clock')).toHaveTextContent('4:58');
    expect(screen.getByTestId('v2-hazard')).toHaveTextContent('Flood rising · next wave in 6 s');
    expect(screen.getByTestId('v2-goal')).toHaveTextContent('NormalShore the tunnels');
    const live = arenaStore().get().live;
    expect(live?.arena.state.agents.map((a) => a.name)).toContain('wick');
    // Soft fog: lit where the crew sees, dim beyond, a blurred edge between.
    const light = live?.arena.light ?? [];
    expect(Math.max(...light)).toBe(1);
    expect(Math.min(...light)).toBe(0);
    expect(light.some((x) => x > 0 && x < 1)).toBe(true);

    act(() =>
      rt.emit({
        type: 'v2_end',
        matchId: 'mat_v2',
        result: { winner: 'A', reason: 'goal', decidedBy: 'goal', score: { A: 4, B: 2 }, ticks: 90 },
        reason: 'goal',
        logHash: 'ab'.repeat(32),
        debrief: v2DebriefFixture({ eloDelta: null, registry: null }),
      }),
    );
    // VICTORY over the last frame, then the debrief.
    expect(screen.getByTestId('v2-live')).toBeInTheDocument();
    later(600);
    expect(screen.getByTestId('v2-banner')).toHaveTextContent('VICTORY');
    later(2200);
    expect(router.replace).toHaveBeenCalledWith('/matches/mat_v2/result');
    expect(screen.getByTestId('v2-verdict')).toHaveTextContent('Victory');
    expect(screen.getByTestId('v2-ended')).toHaveTextContent('4 – 2 after 90 ticks');
    expect(screen.getByTestId('v2-hash')).toHaveTextContent('abab');
    expect(screen.getByTestId('v2-mvp')).toHaveTextContent('Wick');
    expect(screen.getByTestId('v2-registry')).toHaveTextContent('Casual match · not written to the registry');
  });

  it('shows cards with origin slots, floats, the heard-by ear, the comms filter, follow and pause', async () => {
    const { rt } = setup('mat_hud');
    startMatch(rt, 'mat_hud');
    const base = v2FrameFixture({ mapId: 'copper-hollow', tick: 3 });
    const [wick, moss] = base.agents as [FrameAgent, FrameAgent];
    const f1: V2Frame = {
      ...base,
      agents: [{ ...wick, items: [{ kind: 'item', origin: 'middle', tick: 3 }], plan: 'Dig to the lamp, then the lift.' }, moss, wren],
      comms: [
        { tick: 3, from: 'wick', fromName: 'Wick', team: 'A', channel: 'team', text: 'Middle lamp is ours.', overheard: false, overheardBy: ['Wren'] },
        { tick: 3, from: 'wren', fromName: 'Wren', team: 'B', channel: 'team', text: 'Go left, they are slow.', overheard: true },
      ],
    };
    act(() => rt.emit({ type: 'v2_frame', matchId: 'mat_hud', frame: f1 }));
    key('Escape'); // skips the intro
    expect(screen.queryByTestId('v2-intro')).not.toBeInTheDocument();

    const card = screen.getByTestId('v2-card-wick');
    expect(within(card).getByTitle('Lamp oil · Middle')).toBeInTheDocument();
    expect(screen.getByTestId('v2-card-wren')).toHaveTextContent('Wren');
    expect(screen.getByLabelText('Rival agent not seen yet')).toBeInTheDocument(); // the rival brought 2
    expect(screen.getByTitle('Overheard by Wren')).toHaveTextContent('Wren');
    const comms = screen.getByTestId('v2-comms');
    expect(comms).toHaveTextContent('Go left, they are slow.');
    expect(comms).not.toHaveTextContent('Dig to the lamp'); // plans are under Mind
    fireEvent.click(within(screen.getByTestId('v2-comms-filter')).getByRole('button', { name: 'Overheard' }));
    expect(comms).toHaveTextContent('Go left, they are slow.');
    expect(comms).not.toHaveTextContent('Middle lamp is ours.');
    fireEvent.click(within(screen.getByTestId('v2-comms-filter')).getByRole('button', { name: 'Mind' }));
    expect(comms).toHaveTextContent('Dig to the lamp, then the lift.');

    // Another pickup floats over the card; a supply drop is called out.
    const f2: V2Frame = { ...f1, tick: 4, comms: [], events: [{ kind: 'supply_drop', at: [20, 12] }], agents: [{ ...f1.agents[0]!, items: [...f1.agents[0]!.items, { kind: 'item', origin: 'own', tick: 4 }] }, moss, wren] };
    act(() => rt.emit({ type: 'v2_frame', matchId: 'mat_hud', frame: f2 }));
    expect(screen.getByTestId('v2-float')).toHaveTextContent('+ Lamp oil');
    expect(screen.getByTestId('v2-callout')).toHaveTextContent('Supply drop · middle');
    later(1900);
    expect(screen.queryByTestId('v2-float')).not.toBeInTheDocument();

    // Click follows the agent; again stops.
    fireEvent.click(screen.getByTestId('v2-card-wick'));
    expect(screen.getByTestId('v2-card-wick')).toHaveAttribute('aria-pressed', 'true');
    expect(arenaStore().get().view).toEqual({ mode: 'follow', focus: 'wick' });
    fireEvent.click(screen.getByTestId('v2-card-wick'));
    expect(arenaStore().get().view).toEqual(OVERVIEW);

    // Pause freezes this view; the match goes on and resume jumps back to live.
    expect(screen.getByTestId('v2-clock')).toHaveTextContent('4:52');
    fireEvent.click(screen.getByTestId('v2-pause'));
    act(() => rt.emit({ type: 'v2_frame', matchId: 'mat_hud', frame: { ...f2, tick: 5, events: [] } }));
    expect(screen.getByTestId('v2-clock')).toHaveTextContent('4:52');
    expect(screen.getByTestId('v2-live')).toHaveTextContent('View paused · the match goes on');
    key(' ');
    expect(screen.getByTestId('v2-clock')).toHaveTextContent('4:50');
    expect(screen.queryByTestId('v2-speed')).not.toBeInTheDocument();
  });

  it('shows the bot’s mind on a rival in practice, where the server sends it', async () => {
    const { rt } = setup('mat_prac');
    startMatch(rt, 'mat_prac', false);
    const base = v2FrameFixture({ tick: 3 });
    const f: V2Frame = {
      ...base,
      agents: [...base.agents, { ...wren, plan: 'Take the nearest lamp oil.', planWhy: 'The nearest is 4 steps out.', thought: '4 steps to the nearest lamp oil. Going.' }],
    };
    act(() => rt.emit({ type: 'v2_frame', matchId: 'mat_prac', frame: f }));
    key('Enter');
    fireEvent.click(screen.getByTestId('v2-card-wren'));
    key('v');
    later(500);
    expect(screen.getByTestId('v2-mind-practice')).toHaveTextContent('Practice: you see the bot’s mind.');
    expect(screen.queryByTestId('v2-mind-private')).not.toBeInTheDocument();
    expect(screen.getByTestId('v2-plan')).toHaveTextContent('Take the nearest lamp oil.');
    expect(screen.getByTestId('v2-plan-why')).toHaveTextContent('The nearest is 4 steps out.');
    expect(screen.getByTestId('v2-thought')).toHaveTextContent('4 steps to the nearest lamp oil. Going.');
  });

  it('opens third person with your plan, hides a bought skill and a rival mind, and leaves on Esc', async () => {
    const { rt } = setup('mat_tpv');
    startMatch(rt, 'mat_tpv', true);
    const base = v2FrameFixture({ tick: 3 });
    const [wick, moss] = base.agents as [FrameAgent, FrameAgent];
    const f: V2Frame = {
      ...base,
      agents: [
        { ...wick, plan: 'Shore the tunnel, then the lamp.', planWhy: 'The pump floods our side first.', thought: 'Nobody at the lift. Go.' },
        { ...moss, planHidden: true },
        wren,
      ],
      comms: [{ tick: 3, from: 'moss', fromName: 'Moss', team: 'A', channel: 'team', text: 'Rubble ahead.', overheard: false }],
    };
    act(() => rt.emit({ type: 'v2_frame', matchId: 'mat_tpv', frame: f }));
    key('Enter');
    fireEvent.click(screen.getByTestId('v2-card-wick'));
    key('v');
    expect(screen.getByTestId('v2-tpv')).toHaveTextContent('Wick');
    expect(screen.getByTestId('v2-tpv-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(arenaStore().get().view).toEqual({ mode: 'tpv', focus: 'wick' });
    later(500);
    expect(screen.getByTestId('v2-plan')).toHaveTextContent('Shore the tunnel, then the lamp.');
    expect(screen.getByTestId('v2-plan-why')).toHaveTextContent('The pump floods our side first.');
    expect(screen.getByTestId('v2-thought')).toHaveTextContent('“Nobody at the lift. Go.”');
    expect(screen.getByTestId('v2-mind')).toHaveTextContent('Rubble ahead.');
    expect(screen.getByTestId('v2-subs')).toHaveTextContent('Wick · thinking');
    expect(await screen.findByTestId('chase-cam')).toBeInTheDocument();

    key('ArrowRight');
    expect(screen.getByTestId('v2-tpv')).toHaveTextContent('Moss');
    expect(screen.getByTestId('v2-plan-hidden')).toHaveTextContent('Plan hidden — bought skill');
    expect(screen.queryByTestId('v2-plan')).not.toBeInTheDocument();
    expect(screen.queryByTestId('v2-plan-why')).not.toBeInTheDocument();
    expect(screen.getByTestId('v2-thought')).toHaveTextContent('Kept to itself: bought skill.');

    key('ArrowRight');
    expect(screen.getByTestId('v2-tpv')).toHaveTextContent('rival crew');
    expect(screen.getByTestId('v2-mind-private')).toHaveTextContent('Private in ranked.');

    key('Escape');
    expect(screen.queryByTestId('v2-tpv')).not.toBeInTheDocument();
    expect(arenaStore().get().view).toEqual(OVERVIEW);
  });

  it('replays an ended match from its stored frames at another speed', () => {
    const { rt } = setup('mat_rep');
    act(() => {
      rt.emit({ type: 'v2_found', matchId: 'mat_rep', team: 'A', mapId: 'copper-hollow', ranked: true, acceptMs: 10_000 });
      rt.emit({ type: 'v2_end', matchId: 'mat_rep', result: { winner: 'B', reason: 'time', decidedBy: 'score', score: { A: 1, B: 2 }, ticks: 150 }, reason: 'time', logHash: null });
    });
    expect(screen.getByTestId('v2-verdict')).toHaveTextContent('Defeat');
    fireEvent.click(screen.getByTestId('v2-replay'));
    expect(rt.sent).toContainEqual({ type: 'v2_replay', matchId: 'mat_rep' });
    expect(screen.getByTestId('v2-replay-loading')).toHaveTextContent('Loading the replay');

    const frames = [0, 1, 2, 3].map((tick) => v2FrameFixture({ tick }));
    act(() => rt.emit({ type: 'v2_frames', matchId: 'mat_rep', frames }));
    expect(screen.queryByTestId('v2-intro')).not.toBeInTheDocument();
    expect(screen.getByTestId('v2-clock')).toHaveTextContent('5:00');
    later(2000);
    expect(screen.getByTestId('v2-clock')).toHaveTextContent('4:58');
    fireEvent.click(within(screen.getByTestId('v2-speed')).getByRole('button', { name: '4×' }));
    later(500);
    expect(screen.getByTestId('v2-clock')).toHaveTextContent('4:56');
    key('2');
    expect(within(screen.getByTestId('v2-speed')).getByRole('button', { name: '2×' })).toHaveAttribute('aria-pressed', 'true');
    later(1000);
    expect(screen.getByTestId('v2-live')).toHaveTextContent('Replay ended');
    fireEvent.click(screen.getByTestId('v2-replay-exit'));
    expect(screen.getByTestId('v2-verdict')).toHaveTextContent('Defeat');
  });

  it('opens a replay by URL in a tab that never saw the match', () => {
    window.location.hash = '#replay';
    const { rt } = setup('mat_url');
    expect(rt.sent).toContainEqual({ type: 'v2_replay', matchId: 'mat_url' });
    expect(screen.getByTestId('v2-waiting')).toHaveTextContent('Loading the replay');
    act(() => rt.emit({ type: 'v2_frames', matchId: 'mat_url', frames: [v2FrameFixture({ tick: 0 }), v2FrameFixture({ tick: 1 })] }));
    expect(screen.getByTestId('v2-speed')).toBeInTheDocument();
  });

  it('says why a replay cannot load instead of waiting forever', () => {
    window.location.hash = '#replay';
    const { rt } = setup('mat_gone');
    act(() => rt.emit({ type: 'error', code: 'not_found', message: 'no frames are kept for this match' }));
    expect(screen.getByTestId('v2-waiting')).toHaveTextContent('No replay: no frames are kept for this match');
  });

  it('shows a void and plays ranked at Standard', () => {
    const { rt } = setup();
    act(() => {
      rt.emit({ type: 'v2_found', matchId: 'mat_v2', team: 'B', mapId: 'copper-hollow', ranked: true, acceptMs: 10_000 });
      rt.emit({ type: 'v2_lockin', matchId: 'mat_v2', lockMs: 30_000, rival: { agents: 1 } });
    });
    expect(screen.getByTestId('v2-lockin')).toHaveTextContent('Ranked plays every agent at Standard');
    expect(screen.getByRole('radio', { name: /Open/ })).toBeDisabled();
    act(() => rt.emit({ type: 'v2_end', matchId: 'mat_v2', result: null, reason: 'declined', logHash: null }));
    expect(screen.getByTestId('v2-verdict')).toHaveTextContent('Void');
    expect(screen.getByTestId('v2-ended')).toHaveTextContent('A player declined');
  });
});

describe('v2 match screen: spectating and practice', () => {
  it("spectates a match this tab does not play: the whole board, both crews by letter, both crews' talk", () => {
    const { rt } = setup('mat_w');
    expect(rt.v2Watchers('mat_w')).toBe(1);
    expect(screen.getByTestId('v2-waiting')).toHaveTextContent('Connecting to the match');

    const s = createMatch(map, { A: [spec('wick', 'Builder')], B: [spec('wren', 'Digger')] });
    const ev = stepMatch(s, {
      actions: {},
      says: [
        { agent: 'wick', channel: 'team', text: 'Taking the left tunnel.' },
        { agent: 'wren', channel: 'team', text: 'Right side is clear.' },
      ],
    });
    act(() => rt.emit({ type: 'v2_frame', matchId: 'mat_w', frame: frameFor(s, 'watch', ev) }));
    expect(screen.queryByTestId('v2-intro')).not.toBeInTheDocument();
    expect(screen.getByTestId('v2-crew-label')).toHaveTextContent('Crew A');
    expect(screen.getByTestId('v2-rival-label')).toHaveTextContent('Crew B');
    expect(screen.getByTestId('v2-live')).not.toHaveTextContent('You');
    expect(screen.getByTestId('v2-live')).toHaveTextContent('watching');
    const comms = screen.getByTestId('v2-comms');
    expect(comms).toHaveTextContent('Taking the left tunnel.');
    expect(comms).toHaveTextContent('Right side is clear.');
    // Both crews' cards, and the arena draws every agent (no fog).
    expect(screen.getByTestId('v2-card-wick')).toBeInTheDocument();
    expect(screen.getByTestId('v2-card-wren')).toBeInTheDocument();
    expect(arenaStore().get().live?.arena.state.agents.map((a) => a.name).sort()).toEqual(['wick', 'wren']);

    act(() =>
      rt.emit({ type: 'v2_end', matchId: 'mat_w', result: { winner: 'B', reason: 'goal', decidedBy: 'goal', score: { A: 1, B: 4 }, ticks: 80 }, reason: 'goal', logHash: 'ef'.repeat(32) }),
    );
    // No banner of its own: the result by crew at once, and the watch is released.
    expect(screen.queryByTestId('v2-banner')).not.toBeInTheDocument();
    expect(screen.getByTestId('v2-verdict')).toHaveTextContent('Crew B wins');
    expect(screen.getByTestId('v2-ended')).toHaveTextContent('1 – 4 after 80 ticks');
    expect(screen.getByTestId('v2-ended')).toHaveTextContent('Crew A vs Crew B.');
    expect(screen.queryByTestId('v2-stars')).not.toBeInTheDocument();
    expect(screen.getByTestId('v2-again')).toHaveTextContent('Back to the hub');
    expect(screen.getByTestId('v2-again')).toHaveAttribute('href', '/pvp');
    expect(screen.getByTestId('v2-hash')).toHaveTextContent('efef');
    const transcript = screen.getByTestId('v2-transcript');
    expect(transcript).toHaveTextContent('both crews');
    expect(transcript).toHaveTextContent('Taking the left tunnel.');
    expect(transcript).toHaveTextContent('Right side is clear.');
    expect(rt.v2Watchers('mat_w')).toBe(0);
  });

  it("turns a spectating tab into a player's view when its crew's frame arrives, and stops watching", () => {
    const { rt } = setup('mat_own');
    const s = createMatch(map, { A: [spec('wick', 'Builder')], B: [spec('wren', 'Digger')] });
    const ev = stepMatch(s, { actions: {}, says: [{ agent: 'wren', channel: 'team', text: 'Right side is clear.' }] });
    // The whole-board frame came first (the socket was already signed in, so no resume ran before it).
    act(() => rt.emit({ type: 'v2_frame', matchId: 'mat_own', frame: frameFor(s, 'watch', ev) }));
    expect(screen.getByTestId('v2-crew-label')).toHaveTextContent('Crew A');
    expect(rt.v2Watchers('mat_own')).toBe(1);
    // Only crew B's player gets crew B's frames: this tab plays the match, on its own fogged view.
    act(() => rt.emit({ type: 'v2_frame', matchId: 'mat_own', frame: frameFor(s, 'B', ev) }));
    expect(v2StoreFor(rt).get('mat_own')).toMatchObject({ watch: false, team: 'B' });
    expect(screen.getByTestId('v2-crew-label')).toHaveTextContent('You');
    expect(screen.getByTestId('v2-crew-label')).toHaveTextContent('B');
    expect(rt.v2Watchers('mat_own')).toBe(0);
    // Another whole-board frame does not take the board back.
    act(() => rt.emit({ type: 'v2_frame', matchId: 'mat_own', frame: { ...frameFor(s, 'watch', []), tick: s.tick + 1 } }));
    expect(v2StoreFor(rt).get('mat_own')?.frame?.view).toBe('B');
  });

  it('keeps the talk of a replay opened by URL for the debrief transcript', () => {
    window.location.hash = '#replay';
    const { rt } = setup('mat_rtx');
    const said = (tick: number, text: string) => ({ tick, from: 'wick', fromName: 'Wick', team: 'A' as const, channel: 'team' as const, text, overheard: false });
    const frames = [
      v2FrameFixture({ tick: 0, comms: [said(0, 'Left tunnel is mine.')] }),
      v2FrameFixture({ tick: 1, comms: [said(1, 'Lamp delivered.')], result: { winner: 'A', reason: 'goal', decidedBy: 'goal', score: { A: 3, B: 0 }, ticks: 1 } }),
    ];
    act(() => rt.emit({ type: 'v2_frames', matchId: 'mat_rtx', frames }));
    fireEvent.click(screen.getByTestId('v2-replay-exit'));
    const transcript = screen.getByTestId('v2-transcript');
    expect(transcript).toHaveTextContent('Left tunnel is mine.');
    expect(transcript).toHaveTextContent('Lamp delivered.');
    expect(transcript).not.toHaveTextContent('Nobody spoke this match.');
  });

  it('says a match is not here after 10 s without a frame, and still shows one that arrives late', () => {
    const { rt } = setup('mat_none');
    later(9_900);
    expect(screen.getByTestId('v2-waiting')).toHaveTextContent('Connecting to the match');
    later(200);
    expect(screen.getByTestId('v2-waiting')).toHaveTextContent('Match not found or not live on this server');
    expect(screen.getByTestId('v2-lost-result')).toHaveAttribute('href', '/matches/mat_none/result');
    act(() => rt.emit({ type: 'v2_frame', matchId: 'mat_none', frame: v2FrameFixture({ tick: 12 }, 'watch') }));
    expect(screen.getByTestId('v2-live')).toBeInTheDocument();
  });

  it('says so at once when the server does not know the match', () => {
    const { rt } = setup('mat_gone');
    act(() => rt.emit({ type: 'error', code: 'not_found', message: 'match not found' }));
    expect(screen.getByTestId('v2-waiting')).toHaveTextContent('Match not found or not live on this server');
  });

  it('marks a practice: vs Greedy bot and Free practice through found, lock-in and the debrief', async () => {
    const { rt, user } = setup('mat_p');
    act(() =>
      rt.emit({ type: 'v2_found', matchId: 'mat_p', team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 10_000, difficulty: 'easy', practice: true, free: true, rivalHandle: 'Greedy bot' }),
    );
    // A player of the match: no spectating.
    expect(rt.v2Watchers('mat_p')).toBe(0);
    const found = screen.getByTestId('v2-found');
    expect(found).toHaveTextContent('Match found · Practice · Copper Hollow');
    expect(screen.getByTestId('v2-practice')).toHaveTextContent('vs Greedy bot');
    expect(screen.getByTestId('v2-free')).toHaveTextContent('Free practice');
    expect(found).toHaveTextContent('Greedy bot');
    await user.click(screen.getByTestId('v2-accept'));
    act(() => rt.emit({ type: 'v2_lockin', matchId: 'mat_p', lockMs: 30_000, rival: { agents: 1 }, free: true }));
    expect(screen.getByTestId('v2-lockin')).toHaveTextContent('practice');
    expect(screen.getByTestId('v2-practice')).toHaveTextContent('vs Greedy bot');
    expect(screen.getByTestId('v2-hold')).toHaveTextContent('Free practice · nothing is held or charged');

    act(() => rt.emit({ type: 'v2_end', matchId: 'mat_p', result: { winner: 'A', reason: 'goal', decidedBy: 'goal', score: { A: 3, B: 0 }, ticks: 50 }, reason: 'goal', logHash: 'aa'.repeat(32) }));
    expect(screen.getByTestId('v2-verdict')).toHaveTextContent('Victory');
    expect(screen.getByTestId('v2-ended')).toHaveTextContent('practice');
    expect(screen.getByTestId('v2-free')).toHaveTextContent('Free practice');
    expect(screen.getByTestId('v2-ended')).toHaveTextContent('Rival: Greedy bot.');
    expect(screen.getByTestId('v2-again')).toHaveTextContent('Practice again');
    expect(screen.getByTestId('v2-again')).toHaveAttribute('href', '/maps/copper-hollow/crew?d=easy&opponent=bot');
  });

  it('a practice with a model key holds credits: the badge without Free practice', () => {
    const { rt } = setup('mat_paid');
    act(() => {
      rt.emit({ type: 'v2_found', matchId: 'mat_paid', team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 10_000, practice: true, rivalHandle: 'Greedy bot' });
      rt.emit({ type: 'v2_lockin', matchId: 'mat_paid', lockMs: 30_000, rival: { agents: 1 } });
    });
    expect(screen.getByTestId('v2-practice')).toHaveTextContent('vs Greedy bot');
    expect(screen.queryByTestId('v2-free')).not.toBeInTheDocument();
    expect(screen.getByTestId('v2-hold')).toHaveTextContent('Hold 30 credits');
  });

  it("ends with your crew's Comms transcript: what was said and overheard, not verbs or plans", () => {
    const { rt } = setup('mat_tx');
    startMatch(rt, 'mat_tx');
    const base = v2FrameFixture({ mapId: 'copper-hollow', tick: 3 });
    const [wick, moss] = base.agents as [FrameAgent, FrameAgent];
    act(() =>
      rt.emit({
        type: 'v2_frame',
        matchId: 'mat_tx',
        frame: {
          ...base,
          agents: [{ ...wick, plan: 'Dig left.' }, moss, wren],
          events: [{ kind: 'verb', agent: 'wick', verb: 'dig_rubble', effect: 'remove_solid', at: [2, 2] }],
          comms: [
            { tick: 3, from: 'wick', fromName: 'Wick', team: 'A', channel: 'team', text: 'Middle lamp is ours.', overheard: false, overheardBy: ['Wren'] },
            { tick: 3, from: 'wren', fromName: 'Wren', team: 'B', channel: 'team', text: 'Go left, they are slow.', overheard: true },
            { tick: 3, from: 'moss', fromName: 'Moss', team: 'A', channel: 'say', text: 'Truce on the lift?', overheard: false },
          ],
        },
      }),
    );
    key('Escape');
    act(() =>
      rt.emit({ type: 'v2_end', matchId: 'mat_tx', result: { winner: 'A', reason: 'goal', decidedBy: 'goal', score: { A: 4, B: 1 }, ticks: 60 }, reason: 'goal', logHash: null, debrief: v2DebriefFixture() }),
    );
    later(2800); // the banner, then the debrief
    const transcript = screen.getByTestId('v2-transcript');
    const lines = within(transcript).getAllByRole('listitem').map((li) => li.textContent);
    expect(lines).toEqual([
      '0:06WickTeamMiddle lamp is ours.overheard by Wren',
      '0:06WrenOverheardGo left, they are slow.',
      '0:06MossSayTruce on the lift?',
    ]);
    expect(transcript).not.toHaveTextContent('Dig rubble');
    expect(transcript).not.toHaveTextContent('Dig left.');
  });

  it('says nobody spoke when the match had no talk', () => {
    const { rt } = setup('mat_quiet');
    startMatch(rt, 'mat_quiet');
    act(() => rt.emit({ type: 'v2_end', matchId: 'mat_quiet', result: { winner: 'draw', reason: 'time', decidedBy: 'draw', score: { A: 0, B: 0 }, ticks: 150 }, reason: 'time', logHash: null }));
    expect(screen.getByTestId('v2-transcript')).toHaveTextContent('Nobody spoke this match.');
  });
});

describe('v2 store', () => {
  it('drops stale frames and keeps the comms feed', () => {
    let v = reduceV2(undefined, { type: 'v2_found', matchId: 'm', team: 'A', mapId: 'x', ranked: false, acceptMs: 1000 }, 0)!;
    const frame = (tick: number, text?: string) => ({
      view: 'A' as const, mapId: 'x', tick, limit: 150, rows: [], agents: [], score: { A: 0, B: 0 }, goal: 3,
      holdTicks: { A: 0, B: 0 }, blocks: { A: 0, B: 0 }, events: [], result: null,
      comms: text ? [{ tick, from: 'a', fromName: 'A1', team: 'A' as const, channel: 'team' as const, text, overheard: false }] : [],
    });
    v = reduceV2(v, { type: 'v2_frame', matchId: 'm', frame: frame(2, 'hi') }, 1)!;
    expect(reduceV2(v, { type: 'v2_frame', matchId: 'm', frame: frame(1, 'old') }, 2)).toBe(v);
    v = reduceV2(v, { type: 'v2_frame', matchId: 'm', frame: frame(3) }, 3)!;
    expect(v.comms.map((c) => c.text)).toEqual(['hi']);
    expect(v.prevFrame?.tick).toBe(2);
    expect(v.phase).toBe('live');
    expect(reduceV2(v, { type: 'v2_accepted', matchId: 'other', team: 'B' }, 4)).toBe(v);
  });

  it('keeps every said line for the transcript past the feed cap, and the talk of stored frames', () => {
    let v = reduceV2(undefined, { type: 'v2_found', matchId: 'm', team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 1000 }, 0)!;
    const line = (tick: number) => ({ tick, from: 'wick', fromName: 'Wick', team: 'A' as const, channel: 'team' as const, text: `line ${tick}`, overheard: false });
    for (let tick = 1; tick <= MAX_COMMS + 50; tick++)
      v = reduceV2(v, { type: 'v2_frame', matchId: 'm', frame: v2FrameFixture({ tick, comms: [line(tick)], events: [{ kind: 'verb', agent: 'wick', verb: 'dig_rubble', effect: 'remove_solid', at: [2, 2] }] }) }, tick)!;
    expect(v.comms).toHaveLength(MAX_COMMS);
    expect(v.said).toHaveLength(MAX_COMMS + 50);
    expect(v.said[0]?.text).toBe('line 1');
    expect(v.said.every((l) => l.channel === 'team')).toBe(true);

    const replayed = reduceV2(undefined, { type: 'v2_frames', matchId: 'r', frames: [v2FrameFixture({ tick: 0, comms: [line(0)] }), v2FrameFixture({ tick: 1, comms: [line(1)] })] }, 0)!;
    expect(replayed.said.map((l) => l.text)).toEqual(['line 0', 'line 1']);
  });

  it('keeps the difficulty, the lock-in limits, the debrief and replay frames', () => {
    let v = reduceV2(undefined, { type: 'v2_found', matchId: 'm', team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 1000, difficulty: 'hard' }, 0)!;
    expect(v).toMatchObject({ difficulty: 'hard', crewLimit: null, replay: null });
    v = reduceV2(v, { type: 'v2_lockin', matchId: 'm', lockMs: 30_000, rival: { agents: 2 }, crewLimit: 3, headStartTicks: { A: 0, B: 5 } }, 1)!;
    expect(v).toMatchObject({ phase: 'lockin', crewLimit: 3, headStartTicks: { A: 0, B: 5 } });
    const debrief = v2DebriefFixture();
    v = reduceV2(v, { type: 'v2_end', matchId: 'm', result: null, reason: 'declined', logHash: null, debrief }, 2)!;
    expect(v.end?.debrief).toBe(debrief);
    expect(v.endAt).toBe(2);
    const frames = [v2FrameFixture()];
    expect(reduceV2(v, { type: 'v2_frames', matchId: 'm', frames }, 3)!.replay).toBe(frames);
  });

  it('adds verbs, supply drops and plan changes to the feed, and remembers rivals once seen', () => {
    const base = v2FrameFixture({ tick: 4 });
    const [wick] = base.agents as [FrameAgent];
    const f: V2Frame = {
      ...base,
      agents: [{ ...wick, plan: 'Dig left.' }, wren],
      events: [
        { kind: 'verb', agent: 'wick', verb: 'dig_rubble', effect: 'remove_solid', at: [2, 2] },
        { kind: 'supply_drop', at: [20, 12] },
      ],
    };
    expect(linesOf(f, null).map((l) => [l.channel, l.text])).toEqual([
      ['verb', 'Dig rubble'],
      ['arena', 'Supply drop is down. One lamp oil in the middle.'],
      ['mind', 'Dig left.'],
    ]);
    // The same plan next tick adds nothing.
    expect(linesOf({ ...f, tick: 5, events: [] }, f)).toEqual([]);

    let v = reduceV2(undefined, { type: 'v2_found', matchId: 'm', team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 1000 }, 0)!;
    v = reduceV2(v, { type: 'v2_frame', matchId: 'm', frame: f }, 1)!;
    v = reduceV2(v, { type: 'v2_frame', matchId: 'm', frame: { ...base, tick: 5 } }, 2)!;
    expect(v.rivals.map((a) => a.id)).toEqual(['wren']);
  });

  it('keeps the practice flags from v2_found and v2_lockin', () => {
    let v = reduceV2(undefined, { type: 'v2_found', matchId: 'm', team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 1000, practice: true, rivalHandle: 'Greedy bot' }, 0)!;
    expect(v).toMatchObject({ practice: true, free: false, watch: false, rivalHandle: 'Greedy bot' });
    v = reduceV2(v, { type: 'v2_lockin', matchId: 'm', lockMs: 30_000, rival: { agents: 1 }, free: true }, 1)!;
    expect(v).toMatchObject({ phase: 'lockin', practice: true, free: true, rivalHandle: 'Greedy bot' });
    const plain = reduceV2(undefined, { type: 'v2_found', matchId: 'n', team: 'B', mapId: 'copper-hollow', ranked: true, acceptMs: 1000 }, 0)!;
    expect(plain).toMatchObject({ practice: false, free: false, rivalHandle: null });
  });

  it('builds a watch view from a whole-board frame and a player view from a crew frame; a crew frame wins', () => {
    const watched = reduceV2(undefined, { type: 'v2_frame', matchId: 'm', frame: v2FrameFixture({ tick: 7 }, 'watch') }, 5)!;
    expect(watched).toMatchObject({ matchId: 'm', phase: 'live', watch: true, team: 'A', mapId: 'copper-hollow', frameAt: 5 });
    expect(watched.frame?.tick).toBe(7);
    expect(reduceV2(watched, { type: 'v2_frame', matchId: 'm', frame: v2FrameFixture({ tick: 8 }, 'watch') }, 6)!.frame?.tick).toBe(8);
    // A crew's frame reaches only that crew's player, even at the tick already shown whole-board.
    const mine = reduceV2(watched, { type: 'v2_frame', matchId: 'm', frame: v2FrameFixture({ tick: 7 }, 'B') }, 6)!;
    expect(mine).toMatchObject({ watch: false, team: 'B', phase: 'live', frameAt: 6 });
    expect(mine.frame?.view).toBe('B');

    // A player who reloaded mid-match: the server resumes them with their own frame.
    const resumed = reduceV2(undefined, { type: 'v2_frame', matchId: 'm', frame: v2FrameFixture({ tick: 7 }, 'B') }, 5)!;
    expect(resumed).toMatchObject({ watch: false, team: 'B', phase: 'live' });
    expect(reduceV2(resumed, { type: 'v2_frame', matchId: 'm', frame: v2FrameFixture({ tick: 8 }, 'watch') }, 6)).toBe(resumed);
    const found = reduceV2(undefined, { type: 'v2_found', matchId: 'm', team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 1000 }, 0)!;
    expect(reduceV2(found, { type: 'v2_frame', matchId: 'm', frame: v2FrameFixture({ tick: 1 }, 'watch') }, 1)).toBe(found);
  });

  it('builds an ended view from stored frames when the tab never saw the match', () => {
    const frames = [v2FrameFixture({ tick: 0 }), v2FrameFixture({ tick: 1 })];
    const v = reduceV2(undefined, { type: 'v2_frames', matchId: 'm', frames }, 0)!;
    expect(v).toMatchObject({ matchId: 'm', phase: 'ended', team: 'A', mapId: 'copper-hollow', replay: frames });
    expect(reduceV2(undefined, { type: 'v2_frames', matchId: 'm', frames: [] }, 0)).toBeUndefined();
  });
});
