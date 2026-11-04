import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { arenaStore } from '@/features/arena/store';
import { ApiError } from '@/lib/api/errors';
import type { ReplayHighlight, SharedReplay } from '@/lib/api/types';
import { config } from '@/lib/config';
import { routes } from '@/lib/routes';
import { v2DebriefFixture, v2FrameFixture, v2MatchRecordFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { V2ResultScreen } from '../v2/Ended';
import { SharedReplayScreen } from './SharedReplayScreen';
import { highlightAt } from './Highlights';
import { sharedSummary } from './summary';

afterEach(() => arenaStore().setLive(null));

const hl = (o: Partial<ReplayHighlight> = {}): ReplayHighlight => ({
  id: 'goal-30',
  kind: 'goal',
  tick: 30,
  start: 24,
  end: 30,
  team: 'A',
  title: 'Wick delivers the goal',
  facts: 'Wick of ada delivers an item and wins the match.',
  weight: 10,
  score: { A: 4, B: 2 },
  line: 'Wick slams it home!',
  ...o,
});

const watchFrames = (ticks: number[]) => ticks.map((tick) => v2FrameFixture({ tick }, 'watch'));

function shared(o: Partial<SharedReplay> = {}): SharedReplay {
  const record = v2MatchRecordFixture();
  const { you: _you, debrief: _d, ...match } = record;
  return {
    share: { id: 'rps_AAAAAAAAAAAAAAAA', matchId: 'mat_v2', clip: null, createdAt: '2026-10-25T12:05:00.000Z', path: '/replays/rps_AAAAAAAAAAAAAAAA', by: 'ada' },
    match,
    highlights: [hl({ id: 'lead_change-12', kind: 'lead_change', tick: 12, start: 6, end: 16, title: 'ada takes the lead', line: 'And the lead flips!', weight: 5 }), hl()],
    caster: 'model',
    framesKept: true,
    frames: watchFrames(Array.from({ length: 31 }, (_, i) => i)),
    ...o,
  };
}

describe('highlights', () => {
  it('the caster line follows the clip the playback is in', () => {
    const list = [hl({ id: 'a-5', tick: 5, start: 1, end: 9 }), hl({ id: 'b-8', tick: 8, start: 6, end: 12 })];
    expect(highlightAt(list, 0)).toBeNull();
    expect(highlightAt(list, 4)!.id).toBe('a-5');
    expect(highlightAt(list, 7)!.id).toBe('b-8');
    expect(highlightAt(list, 13)).toBeNull();
  });

  it('summarises a shared match in one line', () => {
    expect(sharedSummary(shared())).toBe('ada vs ben on Copper Hollow: 4–2, ada wins.');
  });
});

describe('debrief highlights and sharing', () => {
  it('lists the highlights with replay links and lets a player share the replay or a clip', async () => {
    const created = { id: 'rps_BBBBBBBBBBBBBBBB', matchId: 'mat_v2', clip: { start: 24, end: 30 }, createdAt: '2026-10-25T12:05:00.000Z', path: '/replays/rps_BBBBBBBBBBBBBBBB' };
    let shares: (typeof created)[] = [];
    const { api, user } = renderWithProviders(<V2ResultScreen matchId="mat_v2" />, {
      handle: 'ada',
      path: '/matches/mat_v2/result',
      search: '',
      api: {
        v2Match: async () => v2MatchRecordFixture({ debrief: v2DebriefFixture() }),
        v2Highlights: async () => ({ matchId: 'mat_v2', highlights: [hl()], caster: 'model', framesKept: true }),
        replayShares: async () => ({ shares }),
        createReplayShare: async () => {
          shares = [created];
          return { share: created };
        },
        revokeReplayShare: async () => ({ revoked: true }),
      },
    });
    const panel = await screen.findByTestId('v2-highlights');
    expect(panel).toHaveTextContent('Wick delivers the goal');
    expect(panel).toHaveTextContent('Wick slams it home!');
    expect(panel).toHaveTextContent('AI caster');
    expect(within(panel).getByTestId('highlight-watch-goal-30')).toHaveAttribute('href', routes.matchReplay('mat_v2', 24));

    // The clip preset is the highlight's own range.
    expect(screen.getByTestId('v2-share-start')).toHaveValue(24);
    expect(screen.getByTestId('v2-share-end')).toHaveValue(30);
    await user.click(screen.getByTestId('v2-share-clip'));
    expect(api.createReplayShare).toHaveBeenCalledWith('mat_v2', { start: 24, end: 30 });
    expect(await screen.findByTestId('v2-share-links')).toHaveTextContent(`${config.siteUrl}/replays/rps_BBBBBBBBBBBBBBBB`);

    await user.click(screen.getByTestId('v2-share-full'));
    expect(api.createReplayShare).toHaveBeenLastCalledWith('mat_v2', null);

    await user.click(screen.getByTestId('v2-share-revoke-rps_BBBBBBBBBBBBBBBB'));
    expect(api.revokeReplayShare).toHaveBeenCalledWith('rps_BBBBBBBBBBBBBBBB');
  });

  it('a spectator sees the highlights but cannot share', async () => {
    renderWithProviders(<V2ResultScreen matchId="mat_v2" />, {
      handle: 'cat',
      path: '/matches/mat_v2/result',
      search: '',
      api: {
        v2Match: async () => {
          const { you: _y, debrief: _d, ...r } = v2MatchRecordFixture();
          return r;
        },
        v2Highlights: async () => ({ matchId: 'mat_v2', highlights: [hl()], caster: 'template', framesKept: true }),
      },
    });
    expect(await screen.findByTestId('v2-highlights')).toHaveTextContent('house caster');
    expect(screen.queryByTestId('v2-share')).toBeNull();
  });
});

describe('shared replay screen', () => {
  it('shows the cover, then plays the whole board and jumps to a highlight', async () => {
    const { user } = renderWithProviders(<SharedReplayScreen shareId="rps_AAAAAAAAAAAAAAAA" />, {
      handle: null,
      path: '/replays/rps_AAAAAAAAAAAAAAAA',
      api: { sharedReplay: async () => shared() },
    });
    expect(await screen.findByTestId('shared-replay-title')).toHaveTextContent('ada vs ben on Copper Hollow: 4–2, ada wins.');
    expect(screen.getByTestId('shared-replay')).toHaveTextContent('shared by ada');
    expect(screen.getByTestId('highlight-list')).toHaveTextContent('And the lead flips!');

    await user.click(screen.getByTestId('highlight-watch-goal-30'));
    expect(await screen.findByTestId('v2-live')).toBeInTheDocument();
    const strip = screen.getByTestId('replay-highlights');
    expect(within(strip).getAllByRole('button')).toHaveLength(2);
    // Started at the goal's clip: its caster line is up.
    expect(screen.getByTestId('replay-cast')).toHaveTextContent('Wick slams it home!');
    act(() => void fireEvent.click(screen.getByTestId('replay-jump-lead_change-12')));
    expect(screen.getByTestId('replay-cast')).toHaveTextContent('And the lead flips!');
  });

  it('an old link shows the result and highlights without playback', async () => {
    renderWithProviders(<SharedReplayScreen shareId="rps_AAAAAAAAAAAAAAAA" />, {
      path: '/replays/rps_AAAAAAAAAAAAAAAA',
      api: { sharedReplay: async () => shared({ frames: null, framesKept: false }) },
    });
    expect(await screen.findByTestId('shared-replay-expired')).toBeInTheDocument();
    expect(screen.queryByTestId('shared-replay-play')).toBeNull();
    expect(screen.queryByTestId('highlight-watch-goal-30')).toBeNull();
  });

  it('an ended or unknown link says so', async () => {
    renderWithProviders(<SharedReplayScreen shareId="rps_AAAAAAAAAAAAAAAA" />, {
      path: '/replays/rps_AAAAAAAAAAAAAAAA',
      api: {
        sharedReplay: async () => {
          throw new ApiError(404, 'not_found', 'replay not found');
        },
      },
    });
    expect(await screen.findByText('This replay link is not available')).toBeInTheDocument();
  });
});
