// Draft mode on the match screen: the ban phase between accept and lock-in (v2_draft / v2_ban), and
// the bans on the debrief.
import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { arenaStore } from '@/features/arena/store';
import type { V2DraftBan, V2DraftSkill } from '@/lib/realtime/protocol';
import { FakeRealtime } from '@/test/fakeRealtime';
import { meFixture, v2DebriefFixture, v2MatchRecordFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { V2ResultScreen } from './Ended';
import { V2MatchScreen } from './V2MatchScreen';
import { reduceV2 } from './v2Store';

afterEach(() => arenaStore().setLive(null));

const POOL: V2DraftSkill[] = [
  { skillId: 'skl_rush', name: 'Drop Rush', agents: 2 },
  { skillId: 'skl_dig', name: 'Wall Opener', agents: 1 },
];

function setup(team: 'A' | 'B' = 'A') {
  const rt = new FakeRealtime();
  const r = renderWithProviders(<V2MatchScreen matchId="mat_dr" />, {
    realtime: rt,
    handle: 'ada',
    path: '/matches/mat_dr',
    search: '',
    api: { me: async () => meFixture() },
  });
  act(() => {
    rt.emit({ type: 'v2_found', matchId: 'mat_dr', team, mapId: 'copper-hollow', ranked: false, acceptMs: 10_000, draft: true });
  });
  const draft = (turn: 'A' | 'B' | null, bans: V2DraftBan[] = [], pool = POOL) =>
    act(() => rt.emit({ type: 'v2_draft', matchId: 'mat_dr', turn, step: bans.length, steps: 2, stepMs: 15_000, pool, bans }));
  return { ...r, rt, draft };
}

describe('v2 draft mode', () => {
  it('says draft on the found card, then bans the picked rival skill on your step', async () => {
    const { rt, user, draft } = setup();
    expect(screen.getByTestId('v2-found')).toHaveTextContent('Draft');
    draft('A');
    const screenEl = screen.getByTestId('v2-draft');
    expect(screen.getByTestId('v2-draft-status')).toHaveTextContent('Your ban');
    expect(screenEl).toHaveTextContent('ban 1 of 2');
    expect(screen.getByRole('timer', { name: 'Seconds left for this ban' })).toHaveTextContent('15');
    const pool = screen.getByTestId('v2-draft-pool');
    expect(within(pool).getByText('Drop Rush')).toBeInTheDocument();
    expect(pool).toHaveTextContent('2 rival agents');

    await user.click(screen.getByTestId('v2-ban-skl_rush'));
    expect(rt.sentOf('v2_ban')).toEqual([{ type: 'v2_ban', matchId: 'mat_dr', skillId: 'skl_rush' }]);
    // One answer a step: the picks lock until the server moves on.
    expect(screen.getByTestId('v2-ban-skl_dig')).toBeDisabled();
    expect(screen.getByTestId('v2-draft-status')).toHaveTextContent('Ban sent');

    // The rival's step: nothing to press, the ban so far listed.
    draft('B', [{ team: 'A', step: 0, skillId: 'skl_rush', name: 'Drop Rush' }], POOL.slice(1));
    expect(screen.getByTestId('v2-draft-status')).toHaveTextContent('The rival is banning');
    expect(screen.queryByTestId('v2-ban-pass')).not.toBeInTheDocument();
    expect(screen.getByTestId('v2-bans')).toHaveTextContent('Youbanned Drop Rush');

    draft(null, [
      { team: 'A', step: 0, skillId: 'skl_rush', name: 'Drop Rush' },
      { team: 'B', step: 1, skillId: null, name: null, timedOut: true },
    ]);
    expect(screen.getByTestId('v2-draft-status')).toHaveTextContent('Draft over');
    expect(screen.getByTestId('v2-bans')).toHaveTextContent('Rivalran out of time · passed');

    // Lock-in follows.
    act(() => rt.emit({ type: 'v2_lockin', matchId: 'mat_dr', lockMs: 30_000, rival: { agents: 2 } }));
    expect(await screen.findByTestId('v2-lockin')).toBeInTheDocument();
  });

  it('passes on your step', async () => {
    const { rt, user, draft } = setup('B');
    draft('B', [{ team: 'A', step: 0, skillId: null, name: null }]);
    await user.click(screen.getByTestId('v2-ban-pass'));
    expect(rt.sentOf('v2_ban')).toEqual([{ type: 'v2_ban', matchId: 'mat_dr', skillId: null }]);
    expect(screen.getByTestId('v2-bans')).toHaveTextContent('Rivalpassed');
  });

  it('keeps the draft out of a non-draft match', () => {
    const v = reduceV2(undefined, { type: 'v2_found', matchId: 'm', team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 10_000 }, 0)!;
    expect(v.draft).toBeNull();
    const d = reduceV2(reduceV2(undefined, { type: 'v2_found', matchId: 'm', team: 'A', mapId: 'copper-hollow', ranked: false, acceptMs: 10_000, draft: true }, 0), { type: 'v2_draft', matchId: 'm', turn: 'A', step: 0, steps: 2, stepMs: 5000, pool: POOL, bans: [] }, 1000)!;
    expect(d).toMatchObject({ phase: 'draft', draft: { turn: 'A', by: 6000, pool: POOL, done: false } });
  });

  it('lists the bans on the debrief', async () => {
    const bans: V2DraftBan[] = [
      { team: 'A', step: 0, skillId: 'skl_rush', name: 'Drop Rush' },
      { team: 'B', step: 1, skillId: 'skl_seal', name: 'Seal Tunnel' },
    ];
    renderWithProviders(<V2ResultScreen matchId="mat_v2" />, {
      handle: 'ada',
      path: '/matches/mat_v2/result',
      search: '',
      api: { v2Match: async () => v2MatchRecordFixture({ ranked: false, debrief: v2DebriefFixture({ draft: { bans } }) }) },
    });
    const list = await screen.findByTestId('v2-bans');
    expect(list).toHaveTextContent('Youbanned Drop Rush');
    expect(list).toHaveTextContent('Rivalbanned Seal Tunnel');
    expect(screen.getByTestId('v2-ended')).toHaveTextContent('draft');
  });
});
